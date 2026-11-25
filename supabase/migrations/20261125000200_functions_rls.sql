-- Resolve Aqui · funções, regras de negócio no banco e políticas RLS

-- ---------------------------------------------------------------------------
-- Papéis
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
$$;

-- ---------------------------------------------------------------------------
-- Disponibilidade: expiração à meia-noite do fuso da cidade
-- ---------------------------------------------------------------------------
create or replace function public.availability_expiry(p_timezone text, p_at timestamptz default now())
returns timestamptz language sql immutable set search_path = '' as $$
  select (((p_at at time zone p_timezone)::date + 1)::timestamp) at time zone p_timezone
$$;

-- ---------------------------------------------------------------------------
-- Busca: termos → serviços (nome, sem acento, sinônimos)
-- ---------------------------------------------------------------------------
create or replace function public.query_service_ids(p_q text)
returns table (service_id integer)
language sql stable set search_path = '' as $$
  with q as (select public.normalize_text(p_q) as qn)
  select s.id
    from public.services s, q
   where s.active and length(q.qn) >= 2
     and (s.name_norm like '%' || q.qn || '%'                                     -- "encana" → Encanador
          or (' ' || q.qn || ' ') like ('% ' || s.name_norm || '%'))               -- "encanadores no centro"
  union
  select ss.service_id
    from public.service_synonyms ss
    join public.services s on s.id = ss.service_id and s.active, q
   where length(q.qn) >= 2
     and ((' ' || q.qn || ' ') like ('% ' || ss.term_norm || '%')                  -- termo dentro da frase
          or (length(q.qn) >= 3 and ss.term_norm like q.qn || '%'))                -- começo do termo
$$;

-- Rótulo da área atendida (apenas região — nunca endereço).
create or replace function public.provider_area_label(p_provider uuid)
returns text language sql stable set search_path = '' as $$
  select concat_ws(' · ',
    case
      when p.serves_whole_city then 'Toda ' || c.name
      else (
        select case when count(*) = 0 then null
                    when count(*) <= 3 then string_agg(n.name, ', ' order by n.name)
                    else (array_agg(n.name order by n.name))[1] || ', ' || (array_agg(n.name order by n.name))[2]
                         || ' e mais ' || (count(*) - 2) || ' bairros'
               end
          from public.provider_areas pa join public.neighborhoods n on n.id = pa.neighborhood_id
         where pa.provider_id = p.id)
    end,
    case when p.serves_online then 'Atendimento online' end)
  from public.provider_profiles p left join public.cities c on c.id = p.city_id
  where p.id = p_provider
$$;

-- Busca geral (SECURITY INVOKER: obedece à RLS, só enxerga perfis publicados).
create or replace function public.search_providers(
  p_q text default null,
  p_service_slug text default null,
  p_city_slug text default null,
  p_neighborhood_slug text default null,
  p_online boolean default false,
  p_today boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid, slug text, display_name text, photo_path text, main_service text,
  area_label text, serves_online boolean, available_today boolean, total_count bigint
)
language sql stable set search_path = '' as $$
  with q as (select nullif(public.normalize_text(p_q), '') as qn),
  matched as (select m.service_id from public.query_service_ids(p_q) m),
  city as (select c.id from public.cities c where c.slug = p_city_slug),
  nb as (
    select n.id, n.city_id from public.neighborhoods n join public.cities c on c.id = n.city_id
     where n.slug = p_neighborhood_slug and (p_city_slug is null or c.slug = p_city_slug)
  ),
  svc as (select s.id from public.services s where s.slug = p_service_slug),
  base as (
    select p.*,
      exists (select 1 from public.availability_today a
               where a.provider_id = p.id and a.expires_at > now()) as avail
      from public.provider_profiles p
     where p.status = 'published'
       and (p_service_slug is null
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id = (select id from svc)))
       and ((select qn from q) is null
            or p.name_norm like '%' || (select qn from q) || '%'
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id in (select service_id from matched)))
       and (not coalesce(p_online, false) or p.serves_online)
       and (coalesce(p_online, false) or p_city_slug is null or p.city_id = (select id from city))
       and (coalesce(p_online, false) or p_neighborhood_slug is null
            or (p.serves_whole_city and p.city_id = (select city_id from nb))
            or exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = (select id from nb)))
       and (not coalesce(p_today, false) or exists (
              select 1 from public.availability_today a
               where a.provider_id = p.id and a.expires_at > now()
                 and (p_service_slug is null or (select id from svc) = any (a.service_ids))
                 and (p_neighborhood_slug is null or a.whole_city or (select id from nb) = any (a.neighborhood_ids))))
  )
  select b.id, b.slug, b.display_name, b.photo_path, ms.name,
         public.provider_area_label(b.id), b.serves_online, b.avail, count(*) over ()
    from base b left join public.services ms on ms.id = b.main_service_id
   order by b.avail desc, b.published_at desc nulls last, b.id
   limit least(coalesce(p_limit, 20), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Rótulo da área do "Atendo hoje".
create or replace function public.availability_area_label(p_provider uuid)
returns text language sql stable set search_path = '' as $$
  select case when a.whole_city then 'Toda ' || c.name
         else (select case when count(*) <= 3 then string_agg(n.name, ', ' order by n.name)
                      else (array_agg(n.name order by n.name))[1] || ', ' || (array_agg(n.name order by n.name))[2]
                           || ' e mais ' || (count(*) - 2) || ' bairros' end
                 from public.neighborhoods n where n.id = any (a.neighborhood_ids)) end
    from public.availability_today a join public.cities c on c.id = a.city_id
   where a.provider_id = p_provider
$$;

-- Núcleo da regra "Preciso para hoje": publicado + disponibilidade vigente
-- para o serviço (do piloto) e para o bairro (ou cidade inteira).
create or replace function public.urgent_match(p_provider uuid, p_service_id integer, p_neighborhood_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.provider_profiles p
      join public.availability_today a on a.provider_id = p.id
      join public.services s on s.id = p_service_id and s.urgent_pilot and s.active
      join public.neighborhoods n on n.id = p_neighborhood_id
      join public.cities c on c.id = n.city_id and c.is_pilot
     where p.id = p_provider
       and p.status = 'published'
       and a.expires_at > now()
       and p_service_id = any (a.service_ids)
       and exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id = p_service_id)
       and a.city_id = n.city_id and p.city_id = n.city_id
       and (a.whole_city or n.id = any (a.neighborhood_ids))
       and (p.serves_whole_city or exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = n.id))
  )
$$;

create or replace function public.urgent_search(p_service_slug text, p_neighborhood_id integer)
returns table (id uuid, slug text, display_name text, photo_path text, service_name text, area_label text)
language sql stable set search_path = '' as $$
  select p.id, p.slug, p.display_name, p.photo_path, s.name, public.availability_area_label(p.id)
    from public.provider_profiles p
    join public.availability_today a on a.provider_id = p.id
    join public.services s on s.slug = p_service_slug
   where public.urgent_match(p.id, s.id, p_neighborhood_id)
   order by a.started_at desc, p.id
   limit 50
$$;

-- Dados de contato: SOMENTE service_role (rota do servidor, com limite de frequência).
create or replace function public.contact_target_urgent(p_provider uuid, p_service_id integer, p_neighborhood_id integer)
returns table (whatsapp text, service_name text, neighborhood_name text, city_name text)
language sql stable security definer set search_path = '' as $$
  select pp.whatsapp, s.name, n.name, c.name
    from public.provider_private pp
    join public.services s on s.id = p_service_id
    join public.neighborhoods n on n.id = p_neighborhood_id
    join public.cities c on c.id = n.city_id
   where pp.provider_id = p_provider and pp.whatsapp is not null
     and public.urgent_match(p_provider, p_service_id, p_neighborhood_id)
$$;

create or replace function public.contact_target_general(p_provider uuid)
returns table (whatsapp text, display_name text)
language sql stable security definer set search_path = '' as $$
  select pp.whatsapp, p.display_name
    from public.provider_profiles p join public.provider_private pp on pp.provider_id = p.id
   where p.id = p_provider and p.status = 'published' and pp.whatsapp is not null
$$;

-- Limite de frequência genérico (true = permitido e registrado).
create or replace function public.rate_limit_hit(p_kind text, p_subject text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  select count(*) into n from public.rate_events
   where kind = p_kind and subject = p_subject and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then return false; end if;
  insert into public.rate_events(kind, subject) values (p_kind, p_subject);
  delete from public.rate_events where created_at < now() - interval '2 days' and random() < 0.01;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Publicação e estados do perfil
-- ---------------------------------------------------------------------------
create or replace function public.profile_missing_fields(p_provider uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  p public.provider_profiles;
  pv public.provider_private;
  missing text[] := '{}';
  cpf_on boolean;
begin
  if p_provider is distinct from auth.uid() and not public.is_admin() and auth.role() is distinct from 'service_role' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select * into p from public.provider_profiles where id = p_provider;
  if not found then return array['perfil']; end if;
  select * into pv from public.provider_private where provider_id = p_provider;
  select coalesce((value->>'enabled')::boolean, false) into cpf_on from public.app_settings where key = 'cpf_collection';

  if coalesce(trim(p.display_name), '') = '' then missing := missing || 'display_name'; end if;
  if p.photo_path is null then missing := missing || 'photo'; end if;
  if pv.phone is null then missing := missing || 'phone'; end if;
  if pv.whatsapp is null then missing := missing || 'whatsapp'; end if;
  if coalesce(cpf_on, false) and pv.cpf_ciphertext is null then missing := missing || 'cpf'; end if;
  if not exists (select 1 from public.provider_services where provider_id = p.id) then missing := missing || 'services'; end if;
  if p.main_service_id is null or not exists (select 1 from public.provider_services where provider_id = p.id and service_id = p.main_service_id) then
    missing := missing || 'main_service'; end if;
  if pv.ref_cep is null or pv.ref_street is null or pv.ref_number is null or pv.ref_neighborhood is null or pv.ref_city is null or pv.ref_uf is null then
    missing := missing || 'address'; end if;
  if p.city_id is null then missing := missing || 'city'; end if;
  if not (p.serves_whole_city
          or exists (select 1 from public.provider_areas where provider_id = p.id)
          or (p.serves_online and exists (select 1 from public.provider_services ps join public.services s on s.id = ps.service_id
                                           where ps.provider_id = p.id and s.mode in ('online', 'ambos')))) then
    missing := missing || 'area'; end if;
  return missing;
end $$;

create or replace function public.publish_my_profile()
returns public.provider_status language plpgsql security definer set search_path = '' as $$
declare st public.provider_status; missing text[];
begin
  select status into st from public.provider_profiles where id = auth.uid() for update;
  if not found then raise exception 'Perfil não encontrado' using errcode = 'P0002'; end if;
  if st = 'suspended' then raise exception 'Perfil suspenso pela moderação' using errcode = '42501'; end if;
  missing := public.profile_missing_fields(auth.uid());
  if cardinality(missing) > 0 then
    raise exception 'Perfil incompleto: %', array_to_string(missing, ',') using errcode = '23514';
  end if;
  update public.provider_profiles set status = 'published', published_at = coalesce(published_at, now()), draft_step = 3
   where id = auth.uid();
  return 'published';
end $$;

create or replace function public.set_my_profile_status(p_status public.provider_status)
returns public.provider_status language plpgsql security definer set search_path = '' as $$
declare st public.provider_status;
begin
  select status into st from public.provider_profiles where id = auth.uid() for update;
  if not found then raise exception 'Perfil não encontrado' using errcode = 'P0002'; end if;
  if st = 'suspended' then raise exception 'Perfil suspenso pela moderação' using errcode = '42501'; end if;
  if p_status = 'paused' and st = 'published' then
    update public.provider_profiles set status = 'paused' where id = auth.uid();
  elsif p_status = 'published' and st in ('paused', 'draft') then
    return public.publish_my_profile();
  elsif p_status = st then
    null;
  else
    raise exception 'Mudança de estado não permitida' using errcode = '42501';
  end if;
  return p_status;
end $$;

-- Sai de "publicado" → remove o "Atendo hoje".
create or replace function public.clear_availability_on_unpublish() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'published' then delete from public.availability_today where provider_id = new.id; end if;
  return new;
end $$;
create trigger provider_profiles_status_change after update of status on public.provider_profiles
  for each row when (old.status is distinct from new.status) execute function public.clear_availability_on_unpublish();

-- ---------------------------------------------------------------------------
-- "Atendo hoje"
-- ---------------------------------------------------------------------------
create or replace function public.set_available_today(
  p_service_ids integer[] default null,
  p_neighborhood_ids integer[] default null,
  p_whole_city boolean default null
)
returns public.availability_today language plpgsql security definer set search_path = '' as $$
declare
  p public.provider_profiles;
  tz text;
  eligible integer[];
  allowed_nb integer[];
  svc integer[];
  nbs integer[];
  whole boolean;
  result public.availability_today;
begin
  select * into p from public.provider_profiles where id = auth.uid();
  if not found then raise exception 'Perfil não encontrado' using errcode = 'P0002'; end if;
  if p.status <> 'published' then
    raise exception 'Publique seu perfil para ativar o Atendo hoje' using errcode = '42501';
  end if;
  select timezone into tz from public.cities where id = p.city_id;

  -- serviços presenciais cadastrados (padrão) ou subconjunto
  select coalesce(array_agg(s.id order by s.id), '{}') into eligible
    from public.provider_services ps join public.services s on s.id = ps.service_id
   where ps.provider_id = p.id and s.active and s.mode in ('presencial', 'ambos');
  if cardinality(eligible) = 0 then
    raise exception 'Nenhum serviço presencial cadastrado' using errcode = '23514';
  end if;
  if p_service_ids is null or cardinality(p_service_ids) = 0 then svc := eligible;
  elsif p_service_ids <@ eligible then svc := p_service_ids;
  else raise exception 'Serviço fora do seu perfil' using errcode = '23514';
  end if;

  -- área cadastrada (padrão) ou subconjunto
  if p.serves_whole_city then
    select coalesce(array_agg(id), '{}') into allowed_nb from public.neighborhoods where city_id = p.city_id;
  else
    select coalesce(array_agg(neighborhood_id), '{}') into allowed_nb from public.provider_areas where provider_id = p.id;
  end if;

  if coalesce(p_whole_city, false) then
    if not p.serves_whole_city then raise exception 'Seu perfil não atende a cidade inteira' using errcode = '23514'; end if;
    whole := true; nbs := '{}';
  elsif p_neighborhood_ids is null or cardinality(p_neighborhood_ids) = 0 then
    whole := p.serves_whole_city;
    nbs := case when p.serves_whole_city then '{}'::integer[] else allowed_nb end;
  elsif p_neighborhood_ids <@ allowed_nb then
    whole := false; nbs := p_neighborhood_ids;
  else
    raise exception 'Bairro fora da sua área de atendimento' using errcode = '23514';
  end if;
  if not whole and cardinality(nbs) = 0 then
    raise exception 'Cadastre bairros atendidos para ativar o Atendo hoje' using errcode = '23514';
  end if;

  insert into public.availability_today as a (provider_id, city_id, whole_city, service_ids, neighborhood_ids, started_at, expires_at)
  values (p.id, p.city_id, whole, svc, nbs, now(), public.availability_expiry(tz))
  on conflict (provider_id) do update
     set city_id = excluded.city_id, whole_city = excluded.whole_city, service_ids = excluded.service_ids,
         neighborhood_ids = excluded.neighborhood_ids, started_at = excluded.started_at, expires_at = excluded.expires_at
  returning * into result;
  return result;
end $$;

create or replace function public.clear_available_today()
returns void language sql security definer set search_path = '' as $$
  delete from public.availability_today where provider_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Moderação
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_provider_status(p_provider uuid, p_status public.provider_status, p_note text)
returns public.provider_status language plpgsql security definer set search_path = '' as $$
declare st public.provider_status; target public.provider_status := p_status;
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Informe o motivo' using errcode = '23514'; end if;
  select status into st from public.provider_profiles where id = p_provider for update;
  if not found then raise exception 'Perfil não encontrado' using errcode = 'P0002'; end if;
  if p_status not in ('suspended', 'published', 'paused') then raise exception 'Estado inválido' using errcode = '23514'; end if;
  -- reativar perfil incompleto volta para rascunho
  if p_status = 'published' and cardinality(public.profile_missing_fields(p_provider)) > 0 then target := 'draft'; end if;
  update public.provider_profiles set status = target where id = p_provider;
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), case when target = 'suspended' then 'suspender_perfil' else 'reativar_perfil' end, 'provider', p_provider::text,
          p_note || ' (de ' || st || ' para ' || target || ')');
  return target;
end $$;

create or replace function public.admin_resolve_report(p_report bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if p_status not in ('procedente', 'improcedente', 'aberta') then raise exception 'Estado inválido' using errcode = '23514'; end if;
  update public.reports set status = p_status, resolution_note = p_note, resolved_by = auth.uid(),
         resolved_at = case when p_status = 'aberta' then null else now() end
   where id = p_report;
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'avaliar_denuncia', 'report', p_report::text, p_status || coalesce(': ' || p_note, ''));
end $$;

-- Histórico automático de mudanças no catálogo.
create or replace function public.log_catalog_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec jsonb := to_jsonb(coalesce(new, old));
begin
  if auth.uid() is not null then
    insert into public.moderation_log(actor_id, action, target_type, target_id, note)
    values (auth.uid(), lower(tg_op), tg_table_name, rec->>'id',
            coalesce(rec->>'name', rec->>'term', rec->>'key', '') ||
            case when tg_op = 'UPDATE' and (to_jsonb(old)->>'active') is distinct from (to_jsonb(new)->>'active')
                 then ' (ativo: ' || (to_jsonb(new)->>'active') || ')' else '' end);
  end if;
  return coalesce(new, old);
end $$;
create trigger log_categories after insert or update or delete on public.service_categories for each row execute function public.log_catalog_change();
create trigger log_services after insert or update or delete on public.services for each row execute function public.log_catalog_change();
create trigger log_synonyms after insert or update or delete on public.service_synonyms for each row execute function public.log_catalog_change();
create trigger log_settings after insert or update on public.app_settings for each row execute function public.log_catalog_change();
create trigger log_suggestions after update on public.service_suggestions for each row execute function public.log_catalog_change();

-- Limites para denúncias e sugestões (no banco, independem do app).
create or replace function public.limit_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.reports where reporter_id = new.reporter_id and provider_id = new.provider_id and status = 'aberta') then
    raise exception 'Você já denunciou este perfil; a moderação vai avaliar.' using errcode = '23505';
  end if;
  if (select count(*) from public.reports where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Limite diário de denúncias atingido' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger reports_limit before insert on public.reports for each row execute function public.limit_reports();

create or replace function public.limit_suggestions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.service_suggestions where user_id = new.user_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Limite diário de sugestões atingido' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger suggestions_limit before insert on public.service_suggestions for each row execute function public.limit_suggestions();

-- ---------------------------------------------------------------------------
-- Permissões (GRANTs) — além da RLS
-- ---------------------------------------------------------------------------
-- Funções privilegiadas: somente o servidor (service_role).
revoke execute on function public.contact_target_urgent(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.contact_target_general(uuid) from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.contact_target_urgent(uuid, integer, integer) to service_role;
grant execute on function public.contact_target_general(uuid) to service_role;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;
-- Ações do próprio prestador: exigem login.
revoke execute on function public.publish_my_profile() from public, anon;
revoke execute on function public.set_my_profile_status(public.provider_status) from public, anon;
revoke execute on function public.set_available_today(integer[], integer[], boolean) from public, anon;
revoke execute on function public.clear_available_today() from public, anon;
revoke execute on function public.admin_set_provider_status(uuid, public.provider_status, text) from public, anon;
revoke execute on function public.admin_resolve_report(bigint, text, text) from public, anon;
revoke execute on function public.profile_missing_fields(uuid) from public, anon;

-- Tabelas sem acesso direto de clientes.
revoke all on public.rate_events from anon, authenticated;
revoke all on public.provider_private from anon;
revoke insert, update, delete on public.availability_today from anon, authenticated;
revoke insert, update, delete on public.user_roles from anon, authenticated;
revoke insert, update, delete on public.moderation_log from anon, authenticated;

-- Perfil: status/slug/publicação só mudam pelas funções acima.
revoke insert, update on public.provider_profiles from anon, authenticated;
grant insert (id, slug, display_name, photo_path, bio, main_service_id, city_id, serves_whole_city, serves_online, draft_step)
  on public.provider_profiles to authenticated;
grant update (display_name, photo_path, bio, main_service_id, city_id, serves_whole_city, serves_online, draft_step)
  on public.provider_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.cities enable row level security;
alter table public.neighborhoods enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.service_synonyms enable row level security;
alter table public.service_suggestions enable row level security;
alter table public.provider_profiles enable row level security;
alter table public.provider_services enable row level security;
alter table public.provider_areas enable row level security;
alter table public.provider_work_photos enable row level security;
alter table public.provider_private enable row level security;
alter table public.availability_today enable row level security;
alter table public.favorites enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_log enable row level security;
alter table public.user_roles enable row level security;
alter table public.rate_events enable row level security;
alter table public.app_settings enable row level security;

-- Catálogo e localidades: leitura pública; escrita só admin.
create policy "leitura publica" on public.cities for select to anon, authenticated using (true);
create policy "admin escreve" on public.cities for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leitura publica" on public.neighborhoods for select to anon, authenticated using (true);
create policy "admin escreve" on public.neighborhoods for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leitura publica" on public.service_categories for select to anon, authenticated using (true);
create policy "admin escreve" on public.service_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leitura publica" on public.services for select to anon, authenticated using (true);
create policy "admin escreve" on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leitura publica" on public.service_synonyms for select to anon, authenticated using (true);
create policy "admin escreve" on public.service_synonyms for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leitura publica" on public.app_settings for select to anon, authenticated using (true);
create policy "admin escreve" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Sugestões de serviço
create policy "usuario sugere" on public.service_suggestions for insert to authenticated
  with check (user_id = auth.uid() and status = 'pendente' and service_id is null and reviewed_by is null);
create policy "ve as proprias ou admin" on public.service_suggestions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "admin avalia" on public.service_suggestions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Perfil público: visitantes leem só publicados; dono lê o próprio em qualquer estado.
create policy "publicados ou proprio" on public.provider_profiles for select to anon, authenticated
  using (status = 'published' or id = auth.uid() or public.is_admin());
create policy "cria o proprio" on public.provider_profiles for insert to authenticated
  with check (id = auth.uid());
create policy "edita o proprio" on public.provider_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Tabelas filhas do perfil
create policy "leitura conforme perfil" on public.provider_services for select to anon, authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id));
create policy "dono insere" on public.provider_services for insert to authenticated with check (provider_id = auth.uid());
create policy "dono remove" on public.provider_services for delete to authenticated using (provider_id = auth.uid());

create policy "leitura conforme perfil" on public.provider_areas for select to anon, authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id));
create policy "dono insere" on public.provider_areas for insert to authenticated with check (provider_id = auth.uid());
create policy "dono remove" on public.provider_areas for delete to authenticated using (provider_id = auth.uid());

create policy "leitura conforme perfil" on public.provider_work_photos for select to anon, authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id));
create policy "dono insere" on public.provider_work_photos for insert to authenticated with check (provider_id = auth.uid());
create policy "dono atualiza" on public.provider_work_photos for update to authenticated using (provider_id = auth.uid()) with check (provider_id = auth.uid());
create policy "dono remove" on public.provider_work_photos for delete to authenticated using (provider_id = auth.uid());

-- Dados privados: somente o dono.
create policy "somente o dono" on public.provider_private for all to authenticated
  using (provider_id = auth.uid()) with check (provider_id = auth.uid());

-- Disponibilidade: leitura de perfis visíveis; escrita só via funções.
create policy "leitura conforme perfil" on public.availability_today for select to anon, authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id));

-- Favoritos
create policy "proprios favoritos" on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Denúncias
create policy "usuario denuncia" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'aberta' and resolved_by is null);
create policy "ve as proprias ou admin" on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

-- Histórico e papéis
create policy "admin le historico" on public.moderation_log for select to authenticated using (public.is_admin());
create policy "le o proprio papel" on public.user_roles for select to authenticated using (user_id = auth.uid());

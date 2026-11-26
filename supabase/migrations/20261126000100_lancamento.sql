-- Resolve Aqui · preparação do lançamento (migração aditiva)
-- Não apaga registros. Acrescenta:
--   1. categoria "Crédito imobiliário" (desligada até aprovação) e canal oficial por perfil;
--   2. verificação do perfil (identidade, contato e até três referências), com fila na administração;
--   3. selos públicos só para checagens feitas;
--   4. regra do piloto (desligada por padrão): só perfis aprovados aparecem na busca, no feed e no contato;
--   5. painel "Preparar lançamento" (cobertura por serviço);
--   6. medição simples de uso (buscas e cliques de contato), sem dados pessoais.
-- Documentos não são armazenados: a equipe registra apenas o resultado da conferência.

-- ---------------------------------------------------------------------------
-- 1. Catálogo: categorias com canal oficial
-- ---------------------------------------------------------------------------
alter table public.service_categories add column if not exists official_channel boolean not null default false;

-- Serviço só online ou de categoria com canal oficial nunca entra no "Preciso para hoje".
create or replace function public.services_urgent_by_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.mode = 'online'
     or exists (select 1 from public.service_categories c where c.id = new.category_id and c.official_channel) then
    new.urgent_pilot := false;
  end if;
  return new;
end $$;
drop trigger if exists services_urgent_by_mode on public.services;
create trigger services_urgent_by_mode before insert or update of mode, urgent_pilot, category_id on public.services
  for each row execute function public.services_urgent_by_mode();

insert into public.service_categories (name, slug, sort, active, official_channel)
values ('Crédito imobiliário', 'credito-imobiliario', 900, false, true)
on conflict (slug) do nothing;
insert into public.services (category_id, name, slug, mode, urgent_pilot, active, sort)
select c.id, v.name, v.slug, 'ambos', false, true, v.sort
  from public.service_categories c,
       (values ('Financiamento imobiliário', 'financiamento-imobiliario', 1),
               ('Empréstimo com garantia de imóvel', 'emprestimo-com-garantia-de-imovel', 2)) as v(name, slug, sort)
 where c.slug = 'credito-imobiliario'
on conflict (slug) do nothing;

-- Busca por termos: só serviços ativos de categorias ativas.
create or replace function public.query_service_ids(p_q text)
returns table (service_id integer)
language sql stable set search_path = '' as $$
  with q as (select public.normalize_text(p_q) as qn)
  select s.id
    from public.services s
    join public.service_categories c on c.id = s.category_id and c.active, q
   where s.active and length(q.qn) >= 2
     and (s.name_norm like '%' || q.qn || '%'
          or (' ' || q.qn || ' ') like ('% ' || s.name_norm || '%'))
  union
  select ss.service_id
    from public.service_synonyms ss
    join public.services s on s.id = ss.service_id and s.active
    join public.service_categories c on c.id = s.category_id and c.active, q
   where length(q.qn) >= 2
     and ((' ' || q.qn || ' ') like ('% ' || ss.term_norm || '%')
          or (length(q.qn) >= 3 and ss.term_norm like q.qn || '%'))
$$;

-- Canal oficial (instituição ou correspondente). Só o resultado da conferência é guardado.
create table public.provider_official_channel (
  provider_id uuid primary key references public.provider_profiles(id) on delete cascade,
  institution_name text not null check (char_length(institution_name) between 2 and 120),
  role text not null check (role in ('instituicao', 'correspondente')),
  linked_institution text check (char_length(linked_institution) <= 120),
  official_url text not null check (char_length(official_url) <= 300 and official_url ~ '^https://[^[:space:]]+$'),
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (role = 'instituicao' or char_length(coalesce(linked_institution, '')) >= 2)
);

-- ---------------------------------------------------------------------------
-- 2. Verificação do perfil
-- ---------------------------------------------------------------------------
create table public.provider_verification (
  provider_id uuid primary key references public.provider_profiles(id) on delete cascade,
  status text not null default 'rascunho' check (status in ('rascunho', 'em_analise', 'pendencia', 'aprovado')),
  legal_name text check (char_length(legal_name) <= 120),            -- privado
  is_company boolean not null default false,
  company_name text check (char_length(company_name) <= 120),        -- privado
  responsible_name text check (char_length(responsible_name) <= 120),-- privado
  experience_years smallint check (experience_years between 0 and 70),
  refs_consent boolean not null default false,
  privacy_ack boolean not null default false,
  identity_checked_at timestamptz,
  identity_checked_by uuid references auth.users(id) on delete set null,
  contact_checked_at timestamptz,
  contact_checked_by uuid references auth.users(id) on delete set null,
  pending_reason text check (char_length(pending_reason) <= 500),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index provider_verification_status_idx on public.provider_verification(status);
create trigger provider_verification_touch before update on public.provider_verification
  for each row execute function public.touch_updated_at();

create table public.provider_references (
  id bigint generated always as identity primary key,
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  name text not null check (char_length(name) between 2 and 80),
  contact text not null check (contact ~ '^[0-9]{10,11}$'),
  service text not null check (char_length(service) between 2 and 120),
  period text check (char_length(period) <= 60),
  result text not null default 'a_conferir' check (result in ('a_conferir', 'confirmada', 'nao_confirmada')),
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  internal_note text check (char_length(internal_note) <= 500),     -- só a equipe
  created_at timestamptz not null default now(),
  unique (provider_id, position)
);

-- Todo perfil novo começa em rascunho.
create or replace function public.provider_verification_init() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.provider_verification (provider_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger provider_verification_init after insert on public.provider_profiles
  for each row execute function public.provider_verification_init();

-- Cadastros antigos entram na fila com os dados atuais e instrução para completar.
insert into public.provider_verification (provider_id, status, pending_reason)
select p.id,
       case when p.status = 'draft' then 'rascunho' else 'pendencia' end,
       case when p.status <> 'draft' then 'Complete a verificação do perfil: confirme seu nome completo e informe três referências de clientes.' end
  from public.provider_profiles p
on conflict (provider_id) do nothing;

-- Condições de aprovação: identidade e contato conferidos e ao menos uma referência confirmada.
create or replace function public.verification_ready(p_provider uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.provider_verification v
     where v.provider_id = p_provider
       and v.identity_checked_at is not null and v.contact_checked_at is not null
       and exists (select 1 from public.provider_references r where r.provider_id = v.provider_id and r.result = 'confirmada'))
$$;

-- Aprovado que perdeu alguma condição volta para análise.
create or replace function public.verification_recheck(p_provider uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.provider_verification set status = 'em_analise', decided_at = null, decided_by = null
   where provider_id = p_provider and status = 'aprovado' and not public.verification_ready(p_provider);
end $$;
revoke execute on function public.verification_recheck(uuid) from public, anon, authenticated;

-- Troca do WhatsApp exige nova conferência do contato.
create or replace function public.provider_private_contact_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.whatsapp is distinct from old.whatsapp then
    update public.provider_verification set contact_checked_at = null, contact_checked_by = null where provider_id = new.provider_id;
    perform public.verification_recheck(new.provider_id);
  end if;
  return new;
end $$;
create trigger provider_private_contact_changed after update of whatsapp on public.provider_private
  for each row execute function public.provider_private_contact_changed();

-- O prestador salva ou envia a verificação. Campos de conferência só a equipe altera.
create or replace function public.save_my_verification(
  p_legal_name text, p_is_company boolean, p_company_name text, p_responsible_name text,
  p_experience_years integer, p_refs jsonb, p_refs_consent boolean, p_privacy_ack boolean,
  p_channel jsonb default null, p_submit boolean default false
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.provider_verification;
  r jsonb; pos integer; old_ref public.provider_references;
  n_refs integer; needs_channel boolean; ch public.provider_official_channel;
  nm text; ct text; sv text; pd text;
  identity_changed boolean;
begin
  if uid is null then raise exception 'Entre na sua conta' using errcode = '42501'; end if;
  if not exists (select 1 from public.provider_profiles where id = uid) then
    raise exception 'Crie seu perfil de prestador primeiro' using errcode = '42501';
  end if;
  insert into public.provider_verification (provider_id) values (uid) on conflict do nothing;
  select * into v from public.provider_verification where provider_id = uid for update;

  p_legal_name := nullif(trim(p_legal_name), '');
  p_company_name := case when p_is_company then nullif(trim(p_company_name), '') end;
  p_responsible_name := case when p_is_company then nullif(trim(p_responsible_name), '') end;
  if p_experience_years is not null and (p_experience_years < 0 or p_experience_years > 70) then
    raise exception 'Tempo de experiência inválido' using errcode = '23514';
  end if;

  identity_changed := v.legal_name is distinct from p_legal_name
                   or v.is_company is distinct from coalesce(p_is_company, false)
                   or v.company_name is distinct from p_company_name
                   or v.responsible_name is distinct from p_responsible_name;

  update public.provider_verification set
    legal_name = p_legal_name, is_company = coalesce(p_is_company, false),
    company_name = p_company_name, responsible_name = p_responsible_name,
    experience_years = p_experience_years,
    refs_consent = coalesce(p_refs_consent, false), privacy_ack = coalesce(p_privacy_ack, false),
    identity_checked_at = case when identity_changed then null else identity_checked_at end,
    identity_checked_by = case when identity_changed then null else identity_checked_by end
   where provider_id = uid;

  -- Referências: posições 1 a 3. Alterar uma referência já conferida pede nova conferência.
  for pos in 1..3 loop
    r := (select e from jsonb_array_elements(coalesce(p_refs, '[]'::jsonb)) e where (e->>'position')::int = pos limit 1);
    nm := nullif(trim(r->>'name'), ''); ct := regexp_replace(coalesce(r->>'contact', ''), '\D', '', 'g');
    sv := nullif(trim(r->>'service'), ''); pd := nullif(trim(r->>'period'), '');
    select * into old_ref from public.provider_references where provider_id = uid and position = pos;
    if nm is null and ct = '' and sv is null then
      delete from public.provider_references where provider_id = uid and position = pos;
    else
      if nm is null or sv is null or ct !~ '^[0-9]{10,11}$' then
        raise exception 'Referência %: informe nome, WhatsApp com DDD e o serviço realizado', pos using errcode = '23514';
      end if;
      if old_ref.id is null then
        insert into public.provider_references (provider_id, position, name, contact, service, period)
        values (uid, pos, nm, ct, sv, pd);
      elsif (old_ref.name, old_ref.contact, old_ref.service, coalesce(old_ref.period, '')) is distinct from (nm, ct, sv, coalesce(pd, '')) then
        update public.provider_references set name = nm, contact = ct, service = sv, period = pd,
               result = 'a_conferir', checked_at = null, checked_by = null, internal_note = null
         where id = old_ref.id;
      end if;
    end if;
  end loop;

  -- Canal oficial (para quem oferece serviço de crédito).
  if p_channel is not null and nullif(trim(p_channel->>'institution_name'), '') is not null then
    select * into ch from public.provider_official_channel where provider_id = uid;
    insert into public.provider_official_channel (provider_id, institution_name, role, linked_institution, official_url)
    values (uid, trim(p_channel->>'institution_name'), coalesce(p_channel->>'role', 'instituicao'),
            nullif(trim(p_channel->>'linked_institution'), ''), trim(p_channel->>'official_url'))
    on conflict (provider_id) do update set
      institution_name = excluded.institution_name, role = excluded.role,
      linked_institution = excluded.linked_institution, official_url = excluded.official_url, updated_at = now(),
      checked_at = case when (ch.institution_name, ch.role, coalesce(ch.linked_institution, ''), ch.official_url)
                             is distinct from (excluded.institution_name, excluded.role, coalesce(excluded.linked_institution, ''), excluded.official_url)
                        then null else public.provider_official_channel.checked_at end,
      checked_by = case when (ch.institution_name, ch.role, coalesce(ch.linked_institution, ''), ch.official_url)
                             is distinct from (excluded.institution_name, excluded.role, coalesce(excluded.linked_institution, ''), excluded.official_url)
                        then null else public.provider_official_channel.checked_by end;
  end if;

  perform public.verification_recheck(uid);

  if coalesce(p_submit, false) then
    select count(*) into n_refs from public.provider_references where provider_id = uid;
    needs_channel := exists (select 1 from public.provider_services ps join public.services s on s.id = ps.service_id
                               join public.service_categories c on c.id = s.category_id
                              where ps.provider_id = uid and c.official_channel);
    if p_legal_name is null or char_length(p_legal_name) < 5 then
      raise exception 'Informe seu nome completo' using errcode = '23514';
    end if;
    if coalesce(p_is_company, false) and (p_company_name is null or p_responsible_name is null) then
      raise exception 'Informe o nome da empresa e do responsável' using errcode = '23514';
    end if;
    if not exists (select 1 from public.provider_private where provider_id = uid and whatsapp is not null) then
      raise exception 'Informe o WhatsApp profissional em Meu perfil' using errcode = '23514';
    end if;
    if n_refs < 1 then raise exception 'Informe pelo menos uma referência' using errcode = '23514'; end if;
    if not coalesce(p_refs_consent, false) then
      raise exception 'Confirme que avisou as referências e que elas concordaram em ser contatadas' using errcode = '23514';
    end if;
    if not coalesce(p_privacy_ack, false) then
      raise exception 'Confirme que leu o aviso de privacidade' using errcode = '23514';
    end if;
    if needs_channel and not exists (select 1 from public.provider_official_channel where provider_id = uid) then
      raise exception 'Informe a instituição e o canal oficial do atendimento de crédito' using errcode = '23514';
    end if;
    update public.provider_verification
       set status = case when status = 'aprovado' then 'aprovado' else 'em_analise' end,
           submitted_at = now(), pending_reason = case when status = 'aprovado' then pending_reason end
     where provider_id = uid;
  end if;

  return (select status from public.provider_verification where provider_id = uid);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Regra do piloto e visibilidade
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values ('verificacao_obrigatoria', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

create or replace function public.verification_required()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value->>'enabled')::boolean from public.app_settings where key = 'verificacao_obrigatoria'), false)
$$;

-- Com a regra ligada, só perfis aprovados aparecem e recebem contato.
create or replace function public.provider_cleared(p_provider uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.verification_required()
      or exists (select 1 from public.provider_verification v where v.provider_id = p_provider and v.status = 'aprovado')
$$;

-- Serviço de categoria com canal oficial só vale para o perfil com canal conferido.
-- "Pronto" ignora se a categoria está ligada (o painel de lançamento mostra o que já pode ser habilitado);
-- "público" exige também a categoria ligada.
create or replace function public.provider_service_ready(p_provider uuid, p_service integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.services s join public.service_categories c on c.id = s.category_id
     where s.id = p_service and s.active
       and (not c.official_channel
            or exists (select 1 from public.provider_official_channel o where o.provider_id = p_provider and o.checked_at is not null)))
$$;
create or replace function public.provider_service_public(p_provider uuid, p_service integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.provider_service_ready(p_provider, p_service)
     and exists (select 1 from public.services s join public.service_categories c on c.id = s.category_id
                  where s.id = p_service and c.active)
$$;

-- Apto para o lançamento: visível na busca, contato conferido e verificação aprovada.
create or replace function public.provider_apt(p_provider uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.provider_profiles p
      join public.provider_private pp on pp.provider_id = p.id and pp.whatsapp is not null
      join public.provider_verification v on v.provider_id = p.id and v.status = 'aprovado'
     where p.id = p_provider and p.status = 'published' and public.provider_coverage(p.id) <> 'pendente')
$$;

drop policy if exists "publicados ou proprio" on public.provider_profiles;
create policy "publicados ou proprio" on public.provider_profiles for select to anon, authenticated
  using ((status = 'published' and public.provider_cleared(id)) or id = auth.uid() or public.is_admin());

create or replace function public.provider_in_community(p_provider uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.provider_profiles p
                  where p.id = p_provider and p.status = 'published' and public.provider_coverage(p.id) <> 'pendente'
                    and public.provider_cleared(p.id))
$$;

create or replace function public.contact_target_general(p_provider uuid)
returns table (whatsapp text, display_name text)
language sql stable security definer set search_path = '' as $$
  select pp.whatsapp, p.display_name
    from public.provider_profiles p join public.provider_private pp on pp.provider_id = p.id
   where p.id = p_provider and p.status = 'published' and pp.whatsapp is not null and public.provider_cleared(p.id)
$$;

create or replace function public.urgent_match_area(p_provider uuid, p_service_id integer, p_city_id smallint, p_neighborhood_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.provider_profiles p
      join public.availability_today a on a.provider_id = p.id
      join public.services s on s.id = p_service_id and s.urgent_pilot and s.active
      join public.cities c on c.id = p_city_id and c.is_pilot
      left join public.neighborhoods n on n.id = p_neighborhood_id
     where p.id = p_provider
       and p.status = 'published'
       and public.provider_cleared(p.id)
       and a.expires_at > now()
       and p_service_id = any (a.service_ids)
       and exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id = p_service_id)
       and a.city_id = c.id and p.city_id = c.id
       and (p.serves_whole_city
            or exists (select 1 from public.provider_areas pa
                        where pa.provider_id = p.id and (a.whole_city or pa.neighborhood_id = any (a.neighborhood_ids))))
       and (p_neighborhood_id is null
            or (n.city_id = c.id
                and (a.whole_city or n.id = any (a.neighborhood_ids))
                and (p.serves_whole_city or exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = n.id))))
  )
$$;

create or replace function public.search_providers(
  p_q text default null,
  p_service_slug text default null,
  p_city_slug text default null,
  p_neighborhood_slug text default null,
  p_online boolean default false,
  p_today boolean default false,
  p_limit integer default 20,
  p_offset integer default 0,
  p_category_slug text default null
)
returns table (
  id uuid, slug text, display_name text, photo_path text, main_service text,
  area_label text, serves_online boolean, available_today boolean, total_count bigint,
  main_category text
)
language sql stable set search_path = '' as $$
  with q as (select nullif(public.normalize_text(p_q), '') as qn),
  matched as (select m.service_id from public.query_service_ids(p_q) m),
  city as (select c.id from public.cities c where c.slug = p_city_slug),
  nb as (
    select n.id, n.city_id from public.neighborhoods n join public.cities c on c.id = n.city_id
     where n.slug = p_neighborhood_slug and (p_city_slug is null or c.slug = p_city_slug)
  ),
  svc as (select s.id from public.services s join public.service_categories sc on sc.id = s.category_id and sc.active
           where s.slug = p_service_slug and s.active),
  cat as (select s.id from public.services s join public.service_categories sc on sc.id = s.category_id
           where sc.slug = p_category_slug and sc.active and s.active),
  base as (
    select p.*,
      exists (select 1 from public.availability_today a
               where a.provider_id = p.id and a.expires_at > now()) as avail
      from public.provider_profiles p
     where p.status = 'published'
       and public.provider_cleared(p.id)
       -- perfil sem nenhum serviço visível (ex.: só crédito, ainda desligado) fica fora
       and exists (select 1 from public.provider_services ps where ps.provider_id = p.id and public.provider_service_public(p.id, ps.service_id))
       and (p_service_slug is null
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id = (select id from svc)
                         and public.provider_service_public(p.id, ps.service_id)))
       and (p_category_slug is null
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id in (select id from cat)
                         and public.provider_service_public(p.id, ps.service_id)))
       and ((select qn from q) is null
            or p.name_norm like '%' || (select qn from q) || '%'
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id in (select service_id from matched)
                         and public.provider_service_public(p.id, ps.service_id)))
       and (not coalesce(p_online, false) or p.serves_online)
       and (p.serves_online or p.serves_whole_city
            or exists (select 1 from public.provider_areas pa where pa.provider_id = p.id))
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
         public.provider_area_label(b.id), b.serves_online, b.avail, count(*) over (),
         mc.slug
    from base b
    left join public.services ms on ms.id = b.main_service_id and public.provider_service_public(b.id, ms.id)
    left join public.service_categories mc on mc.id = ms.category_id
   order by b.avail desc, b.published_at desc nulls last, b.id
   limit least(coalesce(p_limit, 20), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;
grant execute on function public.search_providers(text, text, text, text, boolean, boolean, integer, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Selos e canal oficial públicos (só perfis visíveis, só checagens feitas)
-- ---------------------------------------------------------------------------
create or replace function public.provider_badges(p_ids uuid[])
returns table (provider_id uuid, identity_checked boolean, refs_confirmed integer, experience_years smallint)
language sql stable security definer set search_path = '' as $$
  select v.provider_id,
         v.identity_checked_at is not null,
         (select count(*)::int from public.provider_references r where r.provider_id = v.provider_id and r.result = 'confirmada'),
         case when v.status <> 'rascunho' then v.experience_years end
    from public.provider_verification v
    join public.provider_profiles p on p.id = v.provider_id
   where v.provider_id = any (p_ids)
     and ((p.status = 'published' and public.provider_cleared(p.id)) or p.id = auth.uid() or public.is_admin())
$$;

create or replace function public.provider_public_channel(p_provider uuid)
returns table (institution_name text, role text, linked_institution text, official_url text)
language sql stable security definer set search_path = '' as $$
  select o.institution_name, o.role, o.linked_institution, o.official_url
    from public.provider_official_channel o
    join public.provider_profiles p on p.id = o.provider_id
   where o.provider_id = p_provider and o.checked_at is not null
     -- só com a categoria de crédito ligada pela equipe
     and exists (select 1 from public.provider_services ps join public.services s on s.id = ps.service_id and s.active
                   join public.service_categories c on c.id = s.category_id and c.active and c.official_channel
                  where ps.provider_id = o.provider_id)
     and ((p.status = 'published' and public.provider_cleared(p.id)) or p.id = auth.uid() or public.is_admin())
$$;

-- ---------------------------------------------------------------------------
-- 5. Administração: fila de verificação e cobertura do lançamento
-- ---------------------------------------------------------------------------
drop function if exists public.admin_providers(text, text, text, text, text, boolean, boolean, integer, integer);
drop function if exists public.admin_category_coverage(text);
drop function if exists public.admin_provider_base(smallint);

create or replace function public.admin_provider_base(p_city_id smallint default null)
returns table (
  id uuid, slug text, display_name text, status public.provider_status, city_id smallint,
  coverage text, area_pending boolean, available_today boolean,
  category_ids integer[], today_category_ids integer[], updated_at timestamptz,
  verification text, apt boolean, service_ids integer[], apt_service_ids integer[], submitted_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return query
  with prof as (
    select p.*, public.provider_coverage(p.id) as cov,
           (pv.ref_street is not null or pv.ref_cep is not null) as has_ref,
           coalesce(v.status, 'rascunho') as ver, v.submitted_at as sub,
           public.provider_apt(p.id) as is_apt
      from public.provider_profiles p
      left join public.provider_private pv on pv.provider_id = p.id
      left join public.provider_verification v on v.provider_id = p.id
      left join public.cities ci on ci.id = p_city_id
     where p_city_id is null
        or p.city_id = p_city_id
        or (p.city_id is null and public.normalize_text(pv.ref_city) = ci.name_norm)
  ),
  today as (
    select pr.id as provider_id, s.id as service_id, s.category_id
      from prof pr
      join public.availability_today a on a.provider_id = pr.id
      join public.services s on s.id = any (a.service_ids)
     where pr.status = 'published'
       and pr.cov in ('cidade', 'bairros')
       and a.expires_at > now()
       and a.city_id = pr.city_id
       and s.active and s.mode in ('presencial', 'ambos')
       and exists (select 1 from public.provider_services ps where ps.provider_id = pr.id and ps.service_id = s.id)
       and (pr.serves_whole_city
            or exists (select 1 from public.provider_areas pa
                        where pa.provider_id = pr.id and (a.whole_city or pa.neighborhood_id = any (a.neighborhood_ids))))
  )
  select pr.id, pr.slug, pr.display_name, pr.status, pr.city_id,
         pr.cov,
         (pr.cov = 'pendente' and pr.has_ref and pr.status <> 'draft'),
         exists (select 1 from today t where t.provider_id = pr.id),
         coalesce((select array_agg(distinct s.category_id) from public.provider_services ps
                    join public.services s on s.id = ps.service_id
                   where ps.provider_id = pr.id and s.active), '{}'),
         coalesce((select array_agg(distinct t.category_id) from today t where t.provider_id = pr.id), '{}'),
         pr.updated_at,
         pr.ver, pr.is_apt,
         coalesce((select array_agg(ps.service_id) from public.provider_services ps
                    join public.services s on s.id = ps.service_id where ps.provider_id = pr.id and s.active), '{}'),
         case when pr.is_apt then
           coalesce((select array_agg(ps.service_id) from public.provider_services ps
                      where ps.provider_id = pr.id and public.provider_service_ready(pr.id, ps.service_id)), '{}')
         else '{}'::integer[] end,
         pr.sub
    from prof pr;
end $$;

-- p_launch: 'apto' (conta na oferta) ou 'analise' (verificação em análise ou com pendência, fora da oferta).
create or replace function public.admin_providers(
  p_city_slug text default null,
  p_q text default null,
  p_status text default null,
  p_category_slug text default null,
  p_coverage text default null,
  p_today boolean default false,
  p_area_pending boolean default false,
  p_limit integer default 50,
  p_offset integer default 0,
  p_service_slug text default null,
  p_launch text default null,
  p_verification text default null
)
returns table (
  id uuid, slug text, display_name text, status public.provider_status, coverage text,
  area_pending boolean, available_today boolean, area_label text, categories text, updated_at timestamptz,
  verification text, apt boolean, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare cat_id integer; svc_id integer; qn text := nullif(public.normalize_text(p_q), '');
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  select c.id into cat_id from public.service_categories c where c.slug = p_category_slug;
  if p_category_slug is not null and cat_id is null then cat_id := -1; end if;
  select s.id into svc_id from public.services s where s.slug = p_service_slug;
  if p_service_slug is not null and svc_id is null then svc_id := -1; end if;
  return query
  select b.id, b.slug, b.display_name, b.status, b.coverage, b.area_pending, b.available_today,
         public.provider_area_label(b.id),
         (select string_agg(c.name, ', ' order by c.sort) from public.service_categories c where c.id = any (b.category_ids)),
         b.updated_at, b.verification, b.apt, count(*) over ()
    from public.admin_provider_base(public.admin_city_id(p_city_slug)) b
   where (p_city_slug is null or public.admin_city_id(p_city_slug) is not null)
     and (p_status is null or b.status::text = p_status)
     and (qn is null or public.normalize_text(b.display_name) like '%' || qn || '%')
     and (cat_id is null or cat_id = any (b.category_ids))
     and (p_coverage is null or b.coverage = p_coverage)
     and (not coalesce(p_area_pending, false) or b.area_pending)
     and (not coalesce(p_today, false) or (b.available_today and (cat_id is null or cat_id = any (b.today_category_ids))))
     and (p_verification is null
          or (p_verification = 'fila' and b.verification in ('em_analise', 'pendencia'))
          or b.verification = p_verification)
     and (p_launch is null
          or (p_launch = 'apto' and b.apt and (svc_id is null or svc_id = any (b.apt_service_ids)))
          or (p_launch = 'analise' and not b.apt and b.status <> 'suspended'
              and b.verification in ('em_analise', 'pendencia') and (svc_id is null or svc_id = any (b.service_ids))))
     and (p_launch is not null or svc_id is null or svc_id = any (b.service_ids))
   order by case when p_verification is not null then b.submitted_at end asc nulls last, b.updated_at desc, b.id
   limit least(coalesce(p_limit, 50), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_category_coverage(p_city_slug text default null)
returns table (category_id integer, name text, slug text, active boolean, published bigint, available_today bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return query
  with b as (select * from public.admin_provider_base(public.admin_city_id(p_city_slug))
              where p_city_slug is null or public.admin_city_id(p_city_slug) is not null)
  select c.id, c.name, c.slug, c.active,
         (select count(*) from b where b.status = 'published' and c.id = any (b.category_ids)),
         (select count(*) from b where b.available_today and c.id = any (b.today_category_ids))
    from public.service_categories c
   order by c.sort, c.id;
end $$;

-- Uma linha por serviço do catálogo. Um perfil com quatro serviços conta em cada uma das quatro linhas.
create or replace function public.admin_launch_coverage(p_city_slug text default null)
returns table (
  service_id integer, service_name text, service_slug text, service_active boolean,
  category_name text, category_slug text, category_active boolean, official_channel boolean,
  apt bigint, analysis bigint
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return query
  with b as (select * from public.admin_provider_base(public.admin_city_id(p_city_slug))
              where p_city_slug is null or public.admin_city_id(p_city_slug) is not null)
  select s.id, s.name, s.slug, s.active, c.name, c.slug, c.active, c.official_channel,
         (select count(*) from b where s.id = any (b.apt_service_ids)),
         (select count(*) from b where not b.apt and b.status <> 'suspended'
                                   and b.verification in ('em_analise', 'pendencia') and s.id = any (b.service_ids))
    from public.services s
    join public.service_categories c on c.id = s.category_id
   order by c.sort, c.id, s.sort, s.id;
end $$;

-- Detalhe do cadastro para quem trata a verificação (dados restritos).
create or replace function public.admin_verification_detail(p_provider uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'provider', jsonb_build_object('id', p.id, 'slug', p.slug, 'display_name', p.display_name, 'status', p.status,
                                     'coverage', public.provider_coverage(p.id), 'area_label', public.provider_area_label(p.id),
                                     'apt', public.provider_apt(p.id)),
      'whatsapp', pp.whatsapp,
      'services', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'official_channel', c.official_channel) order by c.sort, s.sort)
                              from public.provider_services ps join public.services s on s.id = ps.service_id
                              join public.service_categories c on c.id = s.category_id where ps.provider_id = p.id), '[]'::jsonb),
      'verification', to_jsonb(v) - 'identity_checked_by' - 'contact_checked_by' - 'decided_by'
                      || jsonb_build_object(
                           'identity_checked_by', (select u.email::text from auth.users u where u.id = v.identity_checked_by),
                           'contact_checked_by', (select u.email::text from auth.users u where u.id = v.contact_checked_by),
                           'decided_by', (select u.email::text from auth.users u where u.id = v.decided_by)),
      'references', coalesce((select jsonb_agg(to_jsonb(r) - 'checked_by'
                                               || jsonb_build_object('checked_by', (select u.email::text from auth.users u where u.id = r.checked_by))
                                               order by r.position)
                                from public.provider_references r where r.provider_id = p.id), '[]'::jsonb),
      'channel', (select to_jsonb(o) - 'checked_by' from public.provider_official_channel o where o.provider_id = p.id),
      'ready', public.verification_ready(p.id)
    )
      from public.provider_profiles p
      left join public.provider_private pp on pp.provider_id = p.id
      left join public.provider_verification v on v.provider_id = p.id
     where p.id = p_provider
  );
end $$;

-- Conferências e decisão. O histórico registra a ação, nunca contatos ou documentos.
create or replace function public.admin_verification_action(p_provider uuid, p_action text, p_ref bigint default null, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n integer;
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  p_note := nullif(trim(p_note), '');
  insert into public.provider_verification (provider_id) values (p_provider) on conflict do nothing;
  case p_action
    when 'identidade_ok' then
      update public.provider_verification set identity_checked_at = now(), identity_checked_by = uid where provider_id = p_provider;
    when 'identidade_desfazer' then
      update public.provider_verification set identity_checked_at = null, identity_checked_by = null where provider_id = p_provider;
    when 'contato_ok' then
      if not exists (select 1 from public.provider_private where provider_id = p_provider and whatsapp is not null) then
        raise exception 'O perfil ainda não tem WhatsApp' using errcode = '23514';
      end if;
      update public.provider_verification set contact_checked_at = now(), contact_checked_by = uid where provider_id = p_provider;
    when 'contato_desfazer' then
      update public.provider_verification set contact_checked_at = null, contact_checked_by = null where provider_id = p_provider;
    when 'referencia_confirmada', 'referencia_nao_confirmada', 'referencia_desfazer' then
      update public.provider_references
         set result = case p_action when 'referencia_confirmada' then 'confirmada' when 'referencia_nao_confirmada' then 'nao_confirmada' else 'a_conferir' end,
             checked_at = case when p_action = 'referencia_desfazer' then null else now() end,
             checked_by = case when p_action = 'referencia_desfazer' then null else uid end,
             internal_note = p_note
       where id = p_ref and provider_id = p_provider;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'Referência não encontrada' using errcode = 'P0002'; end if;
    when 'canal_ok' then
      update public.provider_official_channel set checked_at = now(), checked_by = uid where provider_id = p_provider;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'Canal oficial não informado' using errcode = 'P0002'; end if;
    when 'canal_desfazer' then
      update public.provider_official_channel set checked_at = null, checked_by = null where provider_id = p_provider;
    when 'aprovar' then
      if not public.verification_ready(p_provider) then
        raise exception 'Para aprovar: identidade e contato conferidos e ao menos uma referência confirmada' using errcode = '23514';
      end if;
      update public.provider_verification set status = 'aprovado', pending_reason = null, decided_at = now(), decided_by = uid
       where provider_id = p_provider;
    when 'pendencia' then
      if p_note is null then raise exception 'Explique a pendência para o prestador' using errcode = '23514'; end if;
      update public.provider_verification set status = 'pendencia', pending_reason = p_note, decided_at = now(), decided_by = uid
       where provider_id = p_provider;
    else
      raise exception 'Ação inválida' using errcode = '22023';
  end case;
  perform public.verification_recheck(p_provider);
  insert into public.moderation_log (actor_id, action, target_type, target_id, note)
  values (uid, 'verificacao_' || p_action, 'provider', p_provider::text,
          case when p_action in ('pendencia', 'aprovar') then p_note end);
  return (select status from public.provider_verification where provider_id = p_provider);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Medição do piloto (sem dados pessoais: nem conta, nem IP, nem texto digitado)
-- ---------------------------------------------------------------------------
create table public.usage_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('busca', 'busca_hoje', 'contato_geral', 'contato_hoje', 'canal_oficial')),
  service_id integer references public.services(id) on delete set null,
  category_id integer references public.service_categories(id) on delete set null,
  city_id smallint references public.cities(id),
  results integer,
  created_at timestamptz not null default now()
);
create index usage_events_created_idx on public.usage_events(created_at desc);

create or replace function public.admin_usage_summary(p_days integer default 30)
returns table (category_id integer, category_name text, searches bigint, searches_found bigint, contacts bigint, official bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return query
  select e.category_id, coalesce(c.name, 'Sem categoria (busca por nome ou termo livre)'),
         count(*) filter (where e.kind in ('busca', 'busca_hoje')),
         count(*) filter (where e.kind in ('busca', 'busca_hoje') and e.results > 0),
         count(*) filter (where e.kind in ('contato_geral', 'contato_hoje')),
         count(*) filter (where e.kind = 'canal_oficial')
    from public.usage_events e
    left join public.service_categories c on c.id = e.category_id
   where e.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
   group by e.category_id, c.name, c.sort
   order by count(*) desc, c.sort nulls last;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
alter table public.provider_verification enable row level security;
alter table public.provider_references enable row level security;
alter table public.provider_official_channel enable row level security;
alter table public.usage_events enable row level security;

revoke all on public.provider_verification, public.provider_references, public.provider_official_channel, public.usage_events from anon, authenticated;
grant select on public.provider_verification to authenticated;
grant select (id, provider_id, position, name, contact, service, period, result, checked_at, created_at) on public.provider_references to authenticated;
grant select (provider_id, institution_name, role, linked_institution, official_url, checked_at, updated_at) on public.provider_official_channel to authenticated;

create policy "dono ou admin" on public.provider_verification for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());
create policy "dono ou admin" on public.provider_references for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());
create policy "dono ou admin" on public.provider_official_channel for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());
-- usage_events: sem políticas; só o servidor (service_role) grava, e a equipe lê pelo resumo.

revoke execute on function public.save_my_verification(text, boolean, text, text, integer, jsonb, boolean, boolean, jsonb, boolean) from public, anon;
grant execute on function public.save_my_verification(text, boolean, text, text, integer, jsonb, boolean, boolean, jsonb, boolean) to authenticated;
revoke execute on function public.verification_ready(uuid) from public, anon;
grant execute on function public.verification_ready(uuid) to authenticated;
grant execute on function public.verification_required() to anon, authenticated;
grant execute on function public.provider_cleared(uuid) to anon, authenticated;
grant execute on function public.provider_service_ready(uuid, integer) to anon, authenticated;
grant execute on function public.provider_service_public(uuid, integer) to anon, authenticated;
revoke execute on function public.provider_apt(uuid) from public, anon;
grant execute on function public.provider_apt(uuid) to authenticated;
grant execute on function public.provider_badges(uuid[]) to anon, authenticated;
grant execute on function public.provider_public_channel(uuid) to anon, authenticated;
revoke execute on function public.admin_provider_base(smallint) from public, anon;
revoke execute on function public.admin_providers(text, text, text, text, text, boolean, boolean, integer, integer, text, text, text) from public, anon;
revoke execute on function public.admin_category_coverage(text) from public, anon;
revoke execute on function public.admin_launch_coverage(text) from public, anon;
revoke execute on function public.admin_verification_detail(uuid) from public, anon;
revoke execute on function public.admin_verification_action(uuid, text, bigint, text) from public, anon;
revoke execute on function public.admin_usage_summary(integer) from public, anon;
grant execute on function public.admin_provider_base(smallint) to authenticated;
grant execute on function public.admin_providers(text, text, text, text, text, boolean, boolean, integer, integer, text, text, text) to authenticated;
grant execute on function public.admin_category_coverage(text) to authenticated;
grant execute on function public.admin_launch_coverage(text) to authenticated;
grant execute on function public.admin_verification_detail(uuid) to authenticated;
grant execute on function public.admin_verification_action(uuid, text, bigint, text) to authenticated;
grant execute on function public.admin_usage_summary(integer) to authenticated;

-- Histórico: configurações (chave em vez de id) também ficam registradas, com o valor salvo.
-- Corrige o salvamento de configurações pela administração (antes o histórico ficava sem alvo e a gravação falhava).
create or replace function public.log_catalog_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec jsonb := to_jsonb(coalesce(new, old));
begin
  if auth.uid() is not null then
    insert into public.moderation_log(actor_id, action, target_type, target_id, note)
    values (auth.uid(), lower(tg_op), tg_table_name, coalesce(rec->>'id', rec->>'key'),
            coalesce(rec->>'name', rec->>'term', rec->>'key', '') ||
            case when tg_table_name = 'app_settings' then ' ' || coalesce(rec->>'value', '') else '' end ||
            case when tg_op = 'UPDATE' and (to_jsonb(old)->>'active') is distinct from (to_jsonb(new)->>'active')
                 then ' (ativo: ' || (to_jsonb(new)->>'active') || ')' else '' end ||
            case when tg_op = 'UPDATE' and (to_jsonb(old)->>'urgent_pilot') is distinct from (to_jsonb(new)->>'urgent_pilot')
                 then ' (Preciso para hoje: ' || (to_jsonb(new)->>'urgent_pilot') || ')' else '' end);
  end if;
  return coalesce(new, old);
end $$;

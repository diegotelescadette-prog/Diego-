-- Resolve Aqui · painéis do prestador e da administração (migração aditiva)
-- Não altera nem apaga registros existentes. Acrescenta:
--   1. estado da cobertura de cada perfil (cidade inteira, bairros, online ou pendente);
--   2. revalidação do "Atendo hoje" quando a cobertura habitual ou os serviços mudam;
--   3. regra do "Preciso para hoje" exigindo cobertura confirmada também na busca pela cidade inteira;
--   4. consultas da administração com os mesmos critérios para indicadores e listas;
--   5. histórico de moderação com o responsável.

-- ---------------------------------------------------------------------------
-- 1. Cobertura declarada
-- ---------------------------------------------------------------------------
create or replace function public.provider_coverage(p_provider uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when p.serves_whole_city then 'cidade'
           when exists (select 1 from public.provider_areas pa where pa.provider_id = p.id) then 'bairros'
           when p.serves_online and exists (select 1 from public.provider_services ps join public.services s on s.id = ps.service_id
                                             where ps.provider_id = p.id and s.mode in ('online', 'ambos')) then 'online'
           else 'pendente'
         end
    from public.provider_profiles p where p.id = p_provider
$$;
grant execute on function public.provider_coverage(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Atendo hoje" acompanha a cobertura habitual e os serviços
--    Mantém o que continua válido; remove a disponibilidade se nada sobrar.
-- ---------------------------------------------------------------------------
create or replace function public.revalidate_my_available_today()
returns text language plpgsql security definer set search_path = '' as $$
declare
  p public.provider_profiles;
  a public.availability_today;
  svc integer[];
  nbs integer[];
  whole boolean;
begin
  select * into p from public.provider_profiles where id = auth.uid();
  if not found then return 'sem_perfil'; end if;
  select * into a from public.availability_today where provider_id = p.id and expires_at > now();
  if not found then
    delete from public.availability_today where provider_id = p.id;  -- limpa registro vencido
    return 'inativa';
  end if;
  if p.status <> 'published' or p.city_id is distinct from a.city_id then
    delete from public.availability_today where provider_id = p.id;
    return 'removida';
  end if;

  select coalesce(array_agg(x order by x), '{}') into svc
    from unnest(a.service_ids) x
   where exists (select 1 from public.provider_services ps join public.services s on s.id = ps.service_id
                  where ps.provider_id = p.id and ps.service_id = x and s.active and s.mode in ('presencial', 'ambos'));

  if p.serves_whole_city then
    whole := a.whole_city;
    select coalesce(array_agg(x order by x), '{}') into nbs
      from unnest(a.neighborhood_ids) x
     where exists (select 1 from public.neighborhoods n where n.id = x and n.city_id = p.city_id);
  else
    whole := false;
    select coalesce(array_agg(pa.neighborhood_id order by pa.neighborhood_id), '{}') into nbs
      from public.provider_areas pa
     where pa.provider_id = p.id and (a.whole_city or pa.neighborhood_id = any (a.neighborhood_ids));
  end if;

  if cardinality(svc) = 0 or (not whole and cardinality(nbs) = 0) then
    delete from public.availability_today where provider_id = p.id;
    return 'removida';
  end if;
  if svc = a.service_ids and whole = a.whole_city and nbs = (select coalesce(array_agg(x order by x), '{}') from unnest(a.neighborhood_ids) x) then
    return 'mantida';
  end if;
  update public.availability_today set service_ids = svc, whole_city = whole, neighborhood_ids = nbs where provider_id = p.id;
  return 'ajustada';
end $$;
revoke execute on function public.revalidate_my_available_today() from public, anon;
grant execute on function public.revalidate_my_available_today() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. "Preciso para hoje": a área do dia precisa caber na cobertura confirmada,
--    inclusive quando a busca é pela cidade inteira (sem bairro).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Administração: uma base única para indicadores, listas e cobertura
-- ---------------------------------------------------------------------------
create or replace function public.admin_provider_base(p_city_id smallint default null)
returns table (
  id uuid, slug text, display_name text, status public.provider_status, city_id smallint,
  coverage text, area_pending boolean, available_today boolean,
  category_ids integer[], today_category_ids integer[], updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return query
  with prof as (
    select p.*, public.provider_coverage(p.id) as cov,
           (pv.ref_street is not null or pv.ref_cep is not null) as has_ref
      from public.provider_profiles p
      left join public.provider_private pv on pv.provider_id = p.id
      left join public.cities ci on ci.id = p_city_id
     where p_city_id is null
        or p.city_id = p_city_id
        or (p.city_id is null and public.normalize_text(pv.ref_city) = ci.name_norm)
  ),
  today as (
    -- serviços com disponibilidade vigente e ainda válidos para o perfil
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
         pr.updated_at
    from prof pr;
end $$;

create or replace function public.admin_city_id(p_city_slug text)
returns smallint language sql stable set search_path = '' as $$
  select id from public.cities where slug = p_city_slug
$$;

create or replace function public.admin_providers(
  p_city_slug text default null,
  p_q text default null,
  p_status text default null,
  p_category_slug text default null,
  p_coverage text default null,
  p_today boolean default false,
  p_area_pending boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, slug text, display_name text, status public.provider_status, coverage text,
  area_pending boolean, available_today boolean, area_label text, categories text, updated_at timestamptz, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare cat_id integer; qn text := nullif(public.normalize_text(p_q), '');
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  select c.id into cat_id from public.service_categories c where c.slug = p_category_slug;
  if p_category_slug is not null and cat_id is null then cat_id := -1; end if;
  return query
  select b.id, b.slug, b.display_name, b.status, b.coverage, b.area_pending, b.available_today,
         public.provider_area_label(b.id),
         (select string_agg(c.name, ', ' order by c.sort) from public.service_categories c where c.id = any (b.category_ids)),
         b.updated_at, count(*) over ()
    from public.admin_provider_base(public.admin_city_id(p_city_slug)) b
   where (p_city_slug is null or public.admin_city_id(p_city_slug) is not null)
     and (p_status is null or b.status::text = p_status)
     and (qn is null or public.normalize_text(b.display_name) like '%' || qn || '%')
     and (cat_id is null or cat_id = any (b.category_ids))
     and (p_coverage is null or b.coverage = p_coverage)
     and (not coalesce(p_area_pending, false) or b.area_pending)
     -- "Atende hoje" com categoria: disponível hoje em um serviço dessa categoria
     and (not coalesce(p_today, false) or (b.available_today and (cat_id is null or cat_id = any (b.today_category_ids))))
   order by b.updated_at desc, b.id
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

create or replace function public.admin_open_reports(p_city_slug text default null)
returns bigint language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return (select count(*) from public.reports r join public.provider_profiles p on p.id = r.provider_id
           where r.status = 'aberta' and (p_city_slug is null or p.city_id = public.admin_city_id(p_city_slug)));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Histórico com responsável e alvo legível
-- ---------------------------------------------------------------------------
create or replace function public.admin_moderation_log(p_limit integer default 150, p_target text default null)
returns table (id bigint, action text, target_type text, target_id text, target_name text, note text, actor_email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  return query
  select l.id, l.action, l.target_type, l.target_id,
         case l.target_type
           when 'provider' then (select nullif(p.display_name, '') from public.provider_profiles p where p.id::text = l.target_id)
           when 'services' then (select s.name from public.services s where s.id::text = l.target_id)
           when 'service_categories' then (select c.name from public.service_categories c where c.id::text = l.target_id)
           else null end,
         l.note, (select u.email::text from auth.users u where u.id = l.actor_id), l.created_at
    from public.moderation_log l
   where p_target is null or l.target_id = p_target
   order by l.id desc
   limit least(coalesce(p_limit, 150), 500);
end $$;

revoke execute on function public.admin_provider_base(smallint) from public, anon;
revoke execute on function public.admin_providers(text, text, text, text, text, boolean, boolean, integer, integer) from public, anon;
revoke execute on function public.admin_category_coverage(text) from public, anon;
revoke execute on function public.admin_open_reports(text) from public, anon;
revoke execute on function public.admin_moderation_log(integer, text) from public, anon;
grant execute on function public.admin_provider_base(smallint) to authenticated;
grant execute on function public.admin_providers(text, text, text, text, text, boolean, boolean, integer, integer) to authenticated;
grant execute on function public.admin_category_coverage(text) to authenticated;
grant execute on function public.admin_open_reports(text) to authenticated;
grant execute on function public.admin_moderation_log(integer, text) to authenticated;

-- Histórico do catálogo também registra a elegibilidade para "Preciso para hoje".
create or replace function public.log_catalog_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec jsonb := to_jsonb(coalesce(new, old));
begin
  if auth.uid() is not null then
    insert into public.moderation_log(actor_id, action, target_type, target_id, note)
    values (auth.uid(), lower(tg_op), tg_table_name, rec->>'id',
            coalesce(rec->>'name', rec->>'term', rec->>'key', '') ||
            case when tg_op = 'UPDATE' and (to_jsonb(old)->>'active') is distinct from (to_jsonb(new)->>'active')
                 then ' (ativo: ' || (to_jsonb(new)->>'active') || ')' else '' end ||
            case when tg_op = 'UPDATE' and (to_jsonb(old)->>'urgent_pilot') is distinct from (to_jsonb(new)->>'urgent_pilot')
                 then ' (Preciso para hoje: ' || (to_jsonb(new)->>'urgent_pilot') || ')' else '' end);
  end if;
  return coalesce(new, old);
end $$;

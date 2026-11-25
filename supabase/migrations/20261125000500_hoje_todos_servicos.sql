-- Resolve Aqui · "Preciso para hoje" passa a valer para todos os serviços
-- feitos no local (presencial ou ambos). Serviços só online ficam de fora,
-- porque não faz sentido falar em bairro para eles.
-- A coluna mantém o nome urgent_pilot por compatibilidade.

alter table public.services alter column urgent_pilot set default true;
update public.services set urgent_pilot = (mode <> 'online') where urgent_pilot is distinct from (mode <> 'online');

-- Serviço só online nunca entra no "Preciso para hoje". Os demais entram por
-- padrão, e o administrador ainda pode tirar algum (urgent_pilot = false).
create or replace function public.services_urgent_by_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.mode = 'online' then new.urgent_pilot := false; end if;
  return new;
end $$;

create trigger services_urgent_by_mode before insert or update of mode, urgent_pilot on public.services
  for each row execute function public.services_urgent_by_mode();

-- Busca geral por categoria (cards de categoria da página inicial).
drop function if exists public.search_providers(text, text, text, text, boolean, boolean, integer, integer);
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
  svc as (select s.id from public.services s where s.slug = p_service_slug),
  cat as (select s.id from public.services s join public.service_categories sc on sc.id = s.category_id where sc.slug = p_category_slug),
  base as (
    select p.*,
      exists (select 1 from public.availability_today a
               where a.provider_id = p.id and a.expires_at > now()) as avail
      from public.provider_profiles p
     where p.status = 'published'
       and (p_service_slug is null
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id = (select id from svc)))
       and (p_category_slug is null
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id in (select id from cat)))
       and ((select qn from q) is null
            or p.name_norm like '%' || (select qn from q) || '%'
            or exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id in (select service_id from matched)))
       and (not coalesce(p_online, false) or p.serves_online)
       -- a área escolhida define onde o perfil aparece (endereço não conta)
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
    left join public.services ms on ms.id = b.main_service_id
    left join public.service_categories mc on mc.id = ms.category_id
   order by b.avail desc, b.published_at desc nulls last, b.id
   limit least(coalesce(p_limit, 20), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;
grant execute on function public.search_providers(text, text, text, text, boolean, boolean, integer, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bairro opcional no "Preciso para hoje" (padrão: Todos os bairros).
-- Sem bairro, vale a cidade: entra quem confirmou para a cidade inteira e
-- quem confirmou bairros dessa cidade. Com bairro, vale a área do dia.
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
       and (p_neighborhood_id is null
            or (n.city_id = c.id
                and (a.whole_city or n.id = any (a.neighborhood_ids))
                and (p.serves_whole_city or exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = n.id))))
  )
$$;

-- Mantém a assinatura antiga (com bairro obrigatório) apontando para a nova regra.
create or replace function public.urgent_match(p_provider uuid, p_service_id integer, p_neighborhood_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.urgent_match_area(p_provider, p_service_id, n.city_id, p_neighborhood_id)
    from public.neighborhoods n where n.id = p_neighborhood_id
$$;

-- Cidade do piloto (para quando a busca não informa cidade nem bairro).
create or replace function public.pilot_city_id() returns smallint
language sql stable set search_path = '' as $$
  select id from public.cities where is_pilot and active order by id limit 1
$$;

drop function if exists public.urgent_search(text, integer);
create or replace function public.urgent_search(p_service_slug text, p_neighborhood_id integer default null, p_city_slug text default null)
returns table (id uuid, slug text, display_name text, photo_path text, service_name text, area_label text)
language sql stable set search_path = '' as $$
  with c as (
    select coalesce((select n.city_id from public.neighborhoods n where n.id = p_neighborhood_id),
                    (select ci.id from public.cities ci where ci.slug = p_city_slug),
                    public.pilot_city_id()) as id
  )
  select p.id, p.slug, p.display_name, p.photo_path, s.name, public.availability_area_label(p.id)
    from public.provider_profiles p
    join public.availability_today a on a.provider_id = p.id
    join public.services s on s.slug = p_service_slug
   where public.urgent_match_area(p.id, s.id, (select id from c), p_neighborhood_id)
   order by a.whole_city desc, a.started_at desc, p.id
   limit 50
$$;
grant execute on function public.urgent_search(text, integer, text) to anon, authenticated;

drop function if exists public.contact_target_urgent(uuid, integer, integer);
create or replace function public.contact_target_urgent(p_provider uuid, p_service_id integer, p_neighborhood_id integer default null, p_city_id smallint default null)
returns table (whatsapp text, service_name text, neighborhood_name text, city_name text)
language sql stable security definer set search_path = '' as $$
  with c as (
    select coalesce((select n.city_id from public.neighborhoods n where n.id = p_neighborhood_id), p_city_id, public.pilot_city_id()) as id
  )
  select pp.whatsapp, s.name, (select n.name from public.neighborhoods n where n.id = p_neighborhood_id), ci.name
    from public.provider_private pp
    join public.services s on s.id = p_service_id
    join public.cities ci on ci.id = (select id from c)
   where pp.provider_id = p_provider and pp.whatsapp is not null
     and public.urgent_match_area(p_provider, p_service_id, ci.id, p_neighborhood_id)
$$;
revoke execute on function public.contact_target_urgent(uuid, integer, integer, smallint) from public, anon, authenticated;
grant execute on function public.contact_target_urgent(uuid, integer, integer, smallint) to service_role;

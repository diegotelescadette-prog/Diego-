-- Resolve Aqui: banco completo para produção (gerado por scripts/gerar-sql-producao.sh).
-- Cole tudo no SQL Editor de um projeto Supabase NOVO e clique em Run. Sem dados de demonstração.
begin;

-- ===== 20261125000100_schema.sql =====
-- Resolve Aqui · esquema principal
-- Dados públicos (perfil, serviços, área atendida) ficam separados dos dados
-- privados (telefone, CPF cifrado, endereço de referência) — ver provider_private.

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Normalização para busca: minúsculas e sem acento. Wrapper IMMUTABLE para
-- poder ser usado em colunas geradas e índices.
create or replace function public.normalize_text(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Localidades
-- ---------------------------------------------------------------------------
create table public.cities (
  id smallint generated always as identity primary key,
  name text not null,
  uf char(2) not null,
  slug text not null unique,
  timezone text not null,            -- usado na expiração do "Atendo hoje"
  is_pilot boolean not null default false,
  active boolean not null default true,
  name_norm text generated always as (public.normalize_text(name)) stored
);

create table public.neighborhoods (
  id integer generated always as identity primary key,
  city_id smallint not null references public.cities(id),
  name text not null,
  slug text not null,
  active boolean not null default true,
  name_norm text generated always as (public.normalize_text(name)) stored,
  unique (city_id, slug)
);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
create table public.service_categories (
  id integer generated always as identity primary key,
  name text not null,
  slug text not null unique,
  sort integer not null default 0,
  active boolean not null default true
);

create table public.services (
  id integer generated always as identity primary key,
  category_id integer not null references public.service_categories(id),
  name text not null,
  slug text not null unique,
  -- presencial | online | ambos
  mode text not null default 'presencial' check (mode in ('presencial', 'online', 'ambos')),
  urgent_pilot boolean not null default false, -- especialidades do "Preciso para hoje"
  active boolean not null default true,        -- desativar preserva vínculos
  sort integer not null default 0,
  name_norm text generated always as (public.normalize_text(name)) stored
);
create index services_category_idx on public.services(category_id);

create table public.service_synonyms (
  id integer generated always as identity primary key,
  service_id integer not null references public.services(id) on delete cascade,
  term text not null,
  term_norm text generated always as (public.normalize_text(term)) stored,
  unique (service_id, term_norm)
);
create index service_synonyms_term_idx on public.service_synonyms using gin (term_norm extensions.gin_trgm_ops);

create table public.service_suggestions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  note text check (char_length(note) <= 300),
  status text not null default 'pendente' check (status in ('pendente', 'incorporada', 'associada', 'recusada')),
  service_id integer references public.services(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Prestadores
-- ---------------------------------------------------------------------------
create type public.provider_status as enum ('draft', 'published', 'paused', 'suspended');

-- Perfil PÚBLICO. id = auth.users.id (uma conta, um perfil profissional).
create table public.provider_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique,
  display_name text not null default '' check (char_length(display_name) <= 80),
  photo_path text,
  bio text check (char_length(bio) <= 600),
  main_service_id integer references public.services(id),
  city_id smallint references public.cities(id),     -- cidade de atendimento
  serves_whole_city boolean not null default false,
  serves_online boolean not null default false,
  status public.provider_status not null default 'draft',
  draft_step smallint not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name_norm text generated always as (public.normalize_text(display_name)) stored
);
create index provider_profiles_status_city_idx on public.provider_profiles(status, city_id);
create index provider_profiles_name_trgm on public.provider_profiles using gin (name_norm extensions.gin_trgm_ops);

create table public.provider_services (
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  service_id integer not null references public.services(id),
  primary key (provider_id, service_id)
);
create index provider_services_service_idx on public.provider_services(service_id);

-- Área atendida (diferente do endereço de referência).
create table public.provider_areas (
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  neighborhood_id integer not null references public.neighborhoods(id),
  primary key (provider_id, neighborhood_id)
);
create index provider_areas_neighborhood_idx on public.provider_areas(neighborhood_id);

create table public.provider_work_photos (
  id bigint generated always as identity primary key,
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  path text not null,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- Dados PRIVADOS do prestador: só o próprio dono lê/escreve (RLS).
-- Telefone/WhatsApp nunca vão para a busca nem para a página do perfil;
-- o link do WhatsApp é gerado no servidor.
create table public.provider_private (
  provider_id uuid primary key references public.provider_profiles(id) on delete cascade,
  phone text,                  -- só dígitos, com DDD
  whatsapp text,               -- só dígitos, com DDD
  cpf_ciphertext text,         -- CPF cifrado no servidor (AES-256-GCM); nunca em claro
  cpf_last2 text,              -- para o próprio prestador conferir o que enviou
  ref_cep text,
  ref_street text,
  ref_number text,
  ref_complement text,
  ref_neighborhood text,
  ref_city text,
  ref_uf char(2),
  updated_at timestamptz not null default now()
);

-- "Atendo hoje": expira à meia-noite do fuso da cidade de atendimento.
create table public.availability_today (
  provider_id uuid primary key references public.provider_profiles(id) on delete cascade,
  city_id smallint not null references public.cities(id),
  whole_city boolean not null default false,
  service_ids integer[] not null,
  neighborhood_ids integer[] not null default '{}',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index availability_today_expires_idx on public.availability_today(expires_at);

-- ---------------------------------------------------------------------------
-- Uso / moderação
-- ---------------------------------------------------------------------------
create table public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, provider_id)
);

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references auth.users(id) on delete set null,
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  reason text not null check (reason in ('informacoes_falsas', 'golpe_ou_cobranca', 'comportamento_inadequado', 'conteudo_improprio', 'outro')),
  details text check (char_length(details) <= 1000),
  status text not null default 'aberta' check (status in ('aberta', 'procedente', 'improcedente')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text
);

-- Histórico das ações administrativas.
create table public.moderation_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  note text,
  created_at timestamptz not null default now()
);

-- Função de administrador: definida somente pelo servidor/SQL (sem política de escrita).
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now()
);

-- Limites de frequência (contato, denúncias, sugestões, uploads).
-- subject = id do usuário ou hash do IP (nunca o IP em claro).
create table public.rate_events (
  id bigint generated always as identity primary key,
  kind text not null,
  subject text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events(kind, subject, created_at desc);

-- Configurações operacionais (ex.: coleta de CPF).
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger provider_profiles_touch before update on public.provider_profiles
  for each row execute function public.touch_updated_at();
create trigger provider_private_touch before update on public.provider_private
  for each row execute function public.touch_updated_at();


-- ===== 20261125000200_functions_rls.sql =====
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


-- ===== 20261125000300_storage.sql =====
-- Resolve Aqui · armazenamento de fotos
-- Fotos são reprocessadas no servidor (sharp → WebP, sem EXIF/GPS) antes do envio.
-- Cada usuário só escreve na própria pasta: {user_id}/...

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 2097152, array['image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "fotos publicas" on storage.objects for select to anon, authenticated
  using (bucket_id = 'profile-photos');
create policy "dono envia na propria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dono atualiza na propria pasta" on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dono remove na propria pasta" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);


-- ===== 20261125000400_catalog_seed.sql =====
-- Resolve Aqui · dados iniciais de lançamento (editáveis pelo painel administrativo).
-- Gerado por dev/gen_catalog.py. Bairros de Campo Grande: lista inicial, revisar com a operação.

insert into public.app_settings(key, value) values ('cpf_collection', '{"enabled": false, "purpose": null, "necessity_confirmed": false}') on conflict do nothing;
insert into public.cities (name, uf, slug, timezone, is_pilot) values ('Campo Grande', 'MS', 'campo-grande-ms', 'America/Campo_Grande', true);
insert into public.neighborhoods (city_id, name, slug) select c.id, v.name, v.slug from public.cities c, (values
  ('Aero Rancho', 'aero-rancho'),
  ('Alves Pereira', 'alves-pereira'),
  ('Amambaí', 'amambai'),
  ('América', 'america'),
  ('Autonomista', 'autonomista'),
  ('Bandeira', 'bandeira'),
  ('Batistão', 'batistao'),
  ('Bela Vista', 'bela-vista'),
  ('Cabreúva', 'cabreuva'),
  ('Caiçara', 'caicara'),
  ('Carandá', 'caranda'),
  ('Carandá Bosque', 'caranda-bosque'),
  ('Carlota', 'carlota'),
  ('Centenário', 'centenario'),
  ('Centro', 'centro'),
  ('Chácara Cachoeira', 'chacara-cachoeira'),
  ('Chácara dos Poderes', 'chacara-dos-poderes'),
  ('Coophavila II', 'coophavila-ii'),
  ('Coronel Antonino', 'coronel-antonino'),
  ('Cruzeiro', 'cruzeiro'),
  ('Dr. Albuquerque', 'dr-albuquerque'),
  ('Estrela Dalva', 'estrela-dalva'),
  ('Glória', 'gloria'),
  ('Guanandi', 'guanandi'),
  ('Itanhangá', 'itanhanga'),
  ('Jacy', 'jacy'),
  ('Jardim dos Estados', 'jardim-dos-estados'),
  ('Jardim Paulista', 'jardim-paulista'),
  ('Jockey Club', 'jockey-club'),
  ('José Abrão', 'jose-abrao'),
  ('Lageado', 'lageado'),
  ('Leblon', 'leblon'),
  ('Los Angeles', 'los-angeles'),
  ('Margarida', 'margarida'),
  ('Maria Aparecida Pedrossian', 'maria-aparecida-pedrossian'),
  ('Mata do Jacinto', 'mata-do-jacinto'),
  ('Mata do Segredo', 'mata-do-segredo'),
  ('Monte Castelo', 'monte-castelo'),
  ('Monte Carlo', 'monte-carlo'),
  ('Moreninha', 'moreninha'),
  ('Nasser', 'nasser'),
  ('Noroeste', 'noroeste'),
  ('Nova Campo Grande', 'nova-campo-grande'),
  ('Nova Lima', 'nova-lima'),
  ('Novos Estados', 'novos-estados'),
  ('Panamá', 'panama'),
  ('Parati', 'parati'),
  ('Pioneiros', 'pioneiros'),
  ('Piratininga', 'piratininga'),
  ('Planalto', 'planalto'),
  ('Popular', 'popular'),
  ('Rita Vieira', 'rita-vieira'),
  ('Santa Fé', 'santa-fe'),
  ('Santo Amaro', 'santo-amaro'),
  ('Santo Antônio', 'santo-antonio'),
  ('São Bento', 'sao-bento'),
  ('São Conrado', 'sao-conrado'),
  ('São Francisco', 'sao-francisco'),
  ('São Lourenço', 'sao-lourenco'),
  ('Seminário', 'seminario'),
  ('Sobrinho', 'sobrinho'),
  ('Taquarussu', 'taquarussu'),
  ('Taveirópolis', 'taveiropolis'),
  ('Tijuca', 'tijuca'),
  ('Tiradentes', 'tiradentes'),
  ('TV Morena', 'tv-morena'),
  ('Universitário', 'universitario'),
  ('Vilasboas', 'vilasboas')) as v(name, slug) where c.slug = 'campo-grande-ms';

insert into public.service_categories (name, slug, sort) values ('Construção e reformas', 'construcao-e-reformas', 1);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Pedreiro', 'pedreiro', 'presencial', false, 1),
  ('Servente', 'servente', 'presencial', false, 2),
  ('Empreiteiro', 'empreiteiro', 'presencial', false, 3),
  ('Mestre de obras', 'mestre-de-obras', 'presencial', false, 4),
  ('Gesseiro', 'gesseiro', 'presencial', false, 5),
  ('Instalador de drywall', 'instalador-de-drywall', 'presencial', false, 6),
  ('Azulejista', 'azulejista', 'presencial', false, 7),
  ('Assentador de piso e porcelanato', 'assentador-de-piso-e-porcelanato', 'presencial', false, 8),
  ('Impermeabilizador', 'impermeabilizador', 'presencial', false, 9),
  ('Telhadista', 'telhadista', 'presencial', false, 10),
  ('Instalador de calhas', 'instalador-de-calhas', 'presencial', false, 11),
  ('Instalador de forro', 'instalador-de-forro', 'presencial', false, 12)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'construcao-e-reformas';
insert into public.service_categories (name, slug, sort) values ('Marcenaria, carpintaria e mobiliário', 'marcenaria-carpintaria-e-mobiliario', 2);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Marceneiro', 'marceneiro', 'presencial', false, 1),
  ('Carpinteiro', 'carpinteiro', 'presencial', false, 2),
  ('Montador de móveis', 'montador-de-moveis', 'presencial', false, 3),
  ('Instalador de móveis planejados', 'instalador-de-moveis-planejados', 'presencial', false, 4),
  ('Restaurador de móveis', 'restaurador-de-moveis', 'presencial', false, 5),
  ('Estofador', 'estofador', 'presencial', false, 6),
  ('Tapeceiro', 'tapeceiro', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'marcenaria-carpintaria-e-mobiliario';
insert into public.service_categories (name, slug, sort) values ('Pintura e acabamentos', 'pintura-e-acabamentos', 3);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Pintor residencial', 'pintor-residencial', 'presencial', false, 1),
  ('Pintor comercial', 'pintor-comercial', 'presencial', false, 2),
  ('Aplicador de textura', 'aplicador-de-textura', 'presencial', false, 3),
  ('Instalador de papel de parede', 'instalador-de-papel-de-parede', 'presencial', false, 4),
  ('Instalador de cortinas e persianas', 'instalador-de-cortinas-e-persianas', 'presencial', false, 5),
  ('Marmorista', 'marmorista', 'presencial', false, 6)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'pintura-e-acabamentos';
insert into public.service_categories (name, slug, sort) values ('Hidráulica e manutenção', 'hidraulica-e-manutencao', 4);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Encanador', 'encanador', 'presencial', true, 1),
  ('Bombeiro hidráulico', 'bombeiro-hidraulico', 'presencial', false, 2),
  ('Caça-vazamentos', 'caca-vazamentos', 'presencial', false, 3),
  ('Desentupidor', 'desentupidor', 'presencial', false, 4),
  ('Limpador de caixa d’água', 'limpador-de-caixa-dagua', 'presencial', false, 5),
  ('Instalador de filtros', 'instalador-de-filtros', 'presencial', false, 6),
  ('Marido de aluguel', 'marido-de-aluguel', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'hidraulica-e-manutencao';
insert into public.service_categories (name, slug, sort) values ('Elétrica e climatização', 'eletrica-e-climatizacao', 5);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Eletricista', 'eletricista', 'presencial', true, 1),
  ('Técnico de ar-condicionado', 'tecnico-de-ar-condicionado', 'presencial', true, 2),
  ('Técnico de refrigeração', 'tecnico-de-refrigeracao', 'presencial', false, 3),
  ('Instalador de energia solar', 'instalador-de-energia-solar', 'presencial', false, 4),
  ('Instalador de ventilador', 'instalador-de-ventilador', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'eletrica-e-climatizacao';
insert into public.service_categories (name, slug, sort) values ('Portas, janelas e segurança', 'portas-janelas-e-seguranca', 6);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Serralheiro', 'serralheiro', 'presencial', false, 1),
  ('Soldador', 'soldador', 'presencial', false, 2),
  ('Vidraceiro', 'vidraceiro', 'presencial', false, 3),
  ('Chaveiro', 'chaveiro', 'presencial', true, 4),
  ('Instalador de esquadrias', 'instalador-de-esquadrias', 'presencial', false, 5),
  ('Técnico de portão eletrônico', 'tecnico-de-portao-eletronico', 'presencial', false, 6),
  ('Instalador de câmeras, alarmes e interfone', 'instalador-de-cameras-alarmes-e-interfone', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'portas-janelas-e-seguranca';
insert into public.service_categories (name, slug, sort) values ('Piscina, jardim e área externa', 'piscina-jardim-e-area-externa', 7);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Piscineiro', 'piscineiro', 'presencial', false, 1),
  ('Instalador de piscinas', 'instalador-de-piscinas', 'presencial', false, 2),
  ('Jardineiro', 'jardineiro', 'presencial', false, 3),
  ('Paisagista', 'paisagista', 'presencial', false, 4),
  ('Podador de árvores', 'podador-de-arvores', 'presencial', false, 5),
  ('Roçador', 'rocador', 'presencial', false, 6),
  ('Operador de lavagem de alta pressão', 'operador-de-lavagem-de-alta-pressao', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'piscina-jardim-e-area-externa';
insert into public.service_categories (name, slug, sort) values ('Limpeza e conservação', 'limpeza-e-conservacao', 8);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Diarista', 'diarista', 'presencial', false, 1),
  ('Faxineiro', 'faxineiro', 'presencial', false, 2),
  ('Limpador pós-obra', 'limpador-pos-obra', 'presencial', false, 3),
  ('Limpador de vidros', 'limpador-de-vidros', 'presencial', false, 4),
  ('Higienizador de sofás e colchões', 'higienizador-de-sofas-e-colchoes', 'presencial', false, 5),
  ('Dedetizador', 'dedetizador', 'presencial', false, 6),
  ('Passadeira', 'passadeira', 'presencial', false, 7),
  ('Organizador residencial', 'organizador-residencial', 'presencial', false, 8)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'limpeza-e-conservacao';
insert into public.service_categories (name, slug, sort) values ('Tecnologia e eletrônicos', 'tecnologia-e-eletronicos', 9);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Técnico de TI', 'tecnico-de-ti', 'ambos', false, 1),
  ('Técnico de computadores', 'tecnico-de-computadores', 'presencial', false, 2),
  ('Técnico de celulares', 'tecnico-de-celulares', 'presencial', false, 3),
  ('Técnico de impressoras', 'tecnico-de-impressoras', 'presencial', false, 4),
  ('Instalador de Wi-Fi e redes', 'instalador-de-wi-fi-e-redes', 'presencial', false, 5),
  ('Técnico de TV', 'tecnico-de-tv', 'presencial', false, 6),
  ('Suporte remoto', 'suporte-remoto', 'online', false, 7),
  ('Desenvolvedor', 'desenvolvedor', 'online', false, 8),
  ('Web designer', 'web-designer', 'online', false, 9)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'tecnologia-e-eletronicos';
insert into public.service_categories (name, slug, sort) values ('Eletrodomésticos', 'eletrodomesticos', 10);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Técnico de geladeira e freezer', 'tecnico-de-geladeira-e-freezer', 'presencial', false, 1),
  ('Técnico de máquina de lavar', 'tecnico-de-maquina-de-lavar', 'presencial', false, 2),
  ('Técnico de fogão e forno', 'tecnico-de-fogao-e-forno', 'presencial', false, 3),
  ('Técnico de micro-ondas', 'tecnico-de-micro-ondas', 'presencial', false, 4),
  ('Técnico de pequenos eletrodomésticos', 'tecnico-de-pequenos-eletrodomesticos', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'eletrodomesticos';
insert into public.service_categories (name, slug, sort) values ('Automotivo', 'automotivo', 11);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Mecânico', 'mecanico', 'presencial', false, 1),
  ('Eletricista automotivo', 'eletricista-automotivo', 'presencial', false, 2),
  ('Borracharia móvel', 'borracharia-movel', 'presencial', false, 3),
  ('Guincho', 'guincho', 'presencial', false, 4),
  ('Chaveiro automotivo', 'chaveiro-automotivo', 'presencial', false, 5),
  ('Funileiro', 'funileiro', 'presencial', false, 6),
  ('Pintor automotivo', 'pintor-automotivo', 'presencial', false, 7),
  ('Instalador de som automotivo', 'instalador-de-som-automotivo', 'presencial', false, 8),
  ('Detalhador automotivo', 'detalhador-automotivo', 'presencial', false, 9)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'automotivo';
insert into public.service_categories (name, slug, sort) values ('Transporte e entregas', 'transporte-e-entregas', 12);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Frete', 'frete', 'presencial', false, 1),
  ('Carreto', 'carreto', 'presencial', false, 2),
  ('Mudança residencial', 'mudanca-residencial', 'presencial', false, 3),
  ('Ajudante de mudança', 'ajudante-de-mudanca', 'presencial', false, 4),
  ('Motoboy', 'motoboy', 'presencial', false, 5),
  ('Entregador', 'entregador', 'presencial', false, 6)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'transporte-e-entregas';
insert into public.service_categories (name, slug, sort) values ('Beleza e cuidados pessoais', 'beleza-e-cuidados-pessoais', 13);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Cabeleireiro', 'cabeleireiro', 'presencial', false, 1),
  ('Barbeiro', 'barbeiro', 'presencial', false, 2),
  ('Manicure', 'manicure', 'presencial', false, 3),
  ('Pedicure', 'pedicure', 'presencial', false, 4),
  ('Maquiador', 'maquiador', 'presencial', false, 5),
  ('Designer de sobrancelhas', 'designer-de-sobrancelhas', 'presencial', false, 6),
  ('Depilador', 'depilador', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'beleza-e-cuidados-pessoais';
insert into public.service_categories (name, slug, sort) values ('Pets', 'pets', 14);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Banho e tosa', 'banho-e-tosa', 'presencial', false, 1),
  ('Passeador de cães', 'passeador-de-caes', 'presencial', false, 2),
  ('Cuidador de animais', 'cuidador-de-animais', 'presencial', false, 3),
  ('Adestrador', 'adestrador', 'presencial', false, 4),
  ('Transporte pet', 'transporte-pet', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'pets';
insert into public.service_categories (name, slug, sort) values ('Eventos e alimentação', 'eventos-e-alimentacao', 15);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Fotógrafo', 'fotografo', 'presencial', false, 1),
  ('Videomaker', 'videomaker', 'presencial', false, 2),
  ('DJ', 'dj', 'presencial', false, 3),
  ('Decorador de festas', 'decorador-de-festas', 'presencial', false, 4),
  ('Garçom', 'garcom', 'presencial', false, 5),
  ('Churrasqueiro', 'churrasqueiro', 'presencial', false, 6),
  ('Cozinheiro', 'cozinheiro', 'presencial', false, 7),
  ('Confeiteiro', 'confeiteiro', 'presencial', false, 8),
  ('Buffet', 'buffet', 'presencial', false, 9),
  ('Locador de mesas e cadeiras', 'locador-de-mesas-e-cadeiras', 'presencial', false, 10),
  ('Técnico de som e iluminação', 'tecnico-de-som-e-iluminacao', 'presencial', false, 11)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'eventos-e-alimentacao';
insert into public.service_categories (name, slug, sort) values ('Aulas e serviços profissionais', 'aulas-e-servicos-profissionais', 16);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Professor particular', 'professor-particular', 'ambos', false, 1),
  ('Professor de idiomas', 'professor-de-idiomas', 'ambos', false, 2),
  ('Instrutor de música', 'instrutor-de-musica', 'ambos', false, 3),
  ('Tradutor', 'tradutor', 'online', false, 4),
  ('Revisor', 'revisor', 'online', false, 5),
  ('Designer gráfico', 'designer-grafico', 'online', false, 6),
  ('Social media', 'social-media', 'online', false, 7),
  ('Assistente virtual', 'assistente-virtual', 'online', false, 8),
  ('Contador', 'contador', 'ambos', false, 9)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'aulas-e-servicos-profissionais';
insert into public.service_categories (name, slug, sort) values ('Confecção e consertos', 'confeccao-e-consertos', 17);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Costureira', 'costureira', 'presencial', false, 1),
  ('Alfaiate', 'alfaiate', 'presencial', false, 2),
  ('Ajuste de roupas', 'ajuste-de-roupas', 'presencial', false, 3),
  ('Sapateiro', 'sapateiro', 'presencial', false, 4),
  ('Bordadeira', 'bordadeira', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'confeccao-e-consertos';

insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['vazamento', 'cano', 'encanamento', 'torneira', 'registro', 'descarga', 'hidraulica', 'cano furado', 'agua vazando', 'conserto de cano']) t where s.slug = 'encanador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['vazamento', 'infiltracao', 'caca vazamento', 'vazamento oculto', 'conta de agua alta']) t where s.slug = 'caca-vazamentos' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['entupimento', 'pia entupida', 'vaso entupido', 'esgoto', 'ralo entupido', 'desentupir']) t where s.slug = 'desentupidor' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['tomada', 'disjuntor', 'curto', 'curto circuito', 'fiacao', 'chuveiro queimado', 'queda de energia', 'instalacao eletrica', 'quadro de luz', 'luz']) t where s.slug = 'eletricista' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['chave', 'fechadura', 'porta trancada', 'trancado', 'copia de chave', 'abrir porta', 'perdi a chave']) t where s.slug = 'chaveiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['chave de carro', 'chave codificada', 'carro trancado']) t where s.slug = 'chaveiro-automotivo' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['ar condicionado', 'ar-condicionado', 'split', 'instalar ar', 'limpeza de ar', 'ar pingando', 'climatizacao', 'manutencao de ar']) t where s.slug = 'tecnico-de-ar-condicionado' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['refrigeracao', 'camara fria']) t where s.slug = 'tecnico-de-refrigeracao' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['limpeza de piscina', 'limpar piscina', 'piscina verde', 'tratamento de piscina', 'piscina']) t where s.slug = 'piscineiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['t.i.', 'ti', 'informatica', 'suporte tecnico']) t where s.slug = 'tecnico-de-ti' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['formatar computador', 'formatacao', 'formatar', 'computador', 'pc', 'notebook', 'computador lento', 'conserto de notebook']) t where s.slug = 'tecnico-de-computadores' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['celular', 'tela quebrada', 'troca de tela', 'smartphone']) t where s.slug = 'tecnico-de-celulares' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['wifi', 'internet', 'roteador', 'rede']) t where s.slug = 'instalador-de-wi-fi-e-redes' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['suporte online', 'ajuda no computador']) t where s.slug = 'suporte-remoto' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['faxina', 'limpeza de casa', 'limpeza']) t where s.slug = 'diarista' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['faxina', 'limpeza']) t where s.slug = 'faxineiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['obra', 'reforma', 'construcao', 'muro']) t where s.slug = 'pedreiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pintura', 'pintar parede', 'pintar casa']) t where s.slug = 'pintor-residencial' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pequenos reparos', 'faz tudo', 'reparos']) t where s.slug = 'marido-de-aluguel' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['montar movel', 'montagem de moveis', 'montar guarda roupa']) t where s.slug = 'montador-de-moveis' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['jardim', 'cortar grama', 'grama']) t where s.slug = 'jardineiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['rocada', 'terreno sujo', 'limpar terreno']) t where s.slug = 'rocador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['dedetizacao', 'barata', 'cupim', 'pragas']) t where s.slug = 'dedetizador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['carro', 'oficina', 'motor']) t where s.slug = 'mecanico' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['reboque', 'carro quebrado']) t where s.slug = 'guincho' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pneu furado', 'pneu', 'borracheiro']) t where s.slug = 'borracharia-movel' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['transporte', 'carreto']) t where s.slug = 'frete' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['mudanca']) t where s.slug = 'mudanca-residencial' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['geladeira', 'freezer', 'geladeira nao gela']) t where s.slug = 'tecnico-de-geladeira-e-freezer' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['maquina de lavar', 'lavadora']) t where s.slug = 'tecnico-de-maquina-de-lavar' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['caixa dagua', 'caixa d agua', 'limpeza de caixa']) t where s.slug = 'limpador-de-caixa-dagua' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pet shop', 'tosa', 'banho em cachorro']) t where s.slug = 'banho-e-tosa' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['aula particular', 'reforco escolar', 'aulas']) t where s.slug = 'professor-particular' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['contabilidade', 'imposto de renda', 'mei']) t where s.slug = 'contador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['costura', 'barra de calca']) t where s.slug = 'costureira' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['portao', 'portao eletronico', 'motor de portao']) t where s.slug = 'tecnico-de-portao-eletronico' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['camera', 'cftv', 'alarme', 'interfone']) t where s.slug = 'instalador-de-cameras-alarmes-e-interfone' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['vidro', 'box de banheiro', 'vidro quebrado']) t where s.slug = 'vidraceiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['grade', 'portao de ferro', 'serralheria']) t where s.slug = 'serralheiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['gesso', 'sanca']) t where s.slug = 'gesseiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['placa solar', 'energia solar', 'painel solar']) t where s.slug = 'instalador-de-energia-solar' on conflict do nothing;


-- ===== 20261125000500_hoje_todos_servicos.sql =====
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


-- ===== 20261125000600_paineis.sql =====
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


-- ===== 20261125000700_vagas.sql =====
-- Resolve Aqui · vagas de emprego e currículos (migração aditiva)
-- Não altera dados existentes. Acrescenta:
--   1. vagas publicadas por qualquer conta (empresa ou pessoa), com prazo de 30 dias;
--   2. candidaturas com currículo em PDF num bucket PRIVADO;
--   3. denúncias de vagas e remoção pela moderação;
--   4. limpeza dos currículos 90 dias depois que a vaga encerra (LGPD: guardar só o necessário).
-- Quem vê o currículo: somente o candidato e quem publicou a vaga. Nem a administração tem acesso.

-- ---------------------------------------------------------------------------
-- 1. Vagas
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  poster_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  company_name text not null check (char_length(company_name) between 2 and 100),
  description text not null check (char_length(description) between 20 and 4000),
  requirements text check (char_length(requirements) <= 2000),
  employment_type text not null check (employment_type in ('clt', 'pj', 'temporario', 'estagio', 'freelance', 'diaria')),
  work_mode text not null check (work_mode in ('presencial', 'hibrido', 'remoto')),
  city_id smallint not null references public.cities(id),
  neighborhood_id integer references public.neighborhoods(id),
  salary_text text check (char_length(salary_text) <= 80),
  openings smallint not null default 1 check (openings between 1 and 99),
  status text not null default 'aberta' check (status in ('aberta', 'encerrada', 'removida')),
  expires_at timestamptz not null default now() + interval '30 days',
  closed_at timestamptz,
  removed_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_norm text generated always as (public.normalize_text(title || ' ' || company_name)) stored
);
create index jobs_open_idx on public.jobs(status, expires_at desc);
create index jobs_poster_idx on public.jobs(poster_id);
create index jobs_search_trgm on public.jobs using gin (search_norm extensions.gin_trgm_ops);
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();

-- Bairro precisa ser da cidade da vaga.
create or replace function public.jobs_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.neighborhood_id is not null
     and not exists (select 1 from public.neighborhoods n where n.id = new.neighborhood_id and n.city_id = new.city_id) then
    raise exception 'Bairro fora da cidade da vaga' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.jobs where poster_id = new.poster_id and created_at > now() - interval '1 day') >= 5 then
      raise exception 'Limite diário de vagas atingido' using errcode = '54000';
    end if;
    if (select count(*) from public.jobs where poster_id = new.poster_id and status = 'aberta' and expires_at > now()) >= 20 then
      raise exception 'Você já tem 20 vagas abertas. Encerre alguma para publicar outra.' using errcode = '54000';
    end if;
  end if;
  return new;
end $$;
create trigger jobs_check before insert or update on public.jobs for each row execute function public.jobs_check();

-- ---------------------------------------------------------------------------
-- 2. Candidaturas
-- ---------------------------------------------------------------------------
create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 100),
  email text not null check (char_length(email) between 5 and 160),
  phone text check (phone ~ '^[0-9]{10,11}$'),
  message text check (char_length(message) <= 1500),
  resume_path text not null unique,
  resume_filename text not null check (char_length(resume_filename) <= 120),
  resume_size integer not null check (resume_size between 1 and 4194304),
  consent_at timestamptz not null,
  status text not null default 'recebida' check (status in ('recebida', 'vista', 'em_contato', 'nao_selecionada')),
  status_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);
create index job_applications_applicant_idx on public.job_applications(applicant_id);

create or replace function public.job_applications_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if tg_op = 'INSERT' then
    select * into j from public.jobs where id = new.job_id;
    if not found or j.status <> 'aberta' or j.expires_at <= now() then
      raise exception 'Esta vaga não está mais recebendo currículos' using errcode = '23514';
    end if;
    if j.poster_id = new.applicant_id then
      raise exception 'Você não pode se candidatar à própria vaga' using errcode = '23514';
    end if;
    if split_part(new.resume_path, '/', 1) <> new.applicant_id::text then
      raise exception 'Arquivo de currículo inválido' using errcode = '42501';
    end if;
    if (select count(*) from public.job_applications where applicant_id = new.applicant_id and created_at > now() - interval '1 day') >= 20 then
      raise exception 'Limite diário de candidaturas atingido' using errcode = '54000';
    end if;
    new.status := 'recebida';
    new.status_at := now();
  elsif new.status is distinct from old.status then
    new.status_at := now();
  end if;
  return new;
end $$;
create trigger job_applications_check before insert or update on public.job_applications
  for each row execute function public.job_applications_check();

-- ---------------------------------------------------------------------------
-- 3. Denúncias de vagas
-- ---------------------------------------------------------------------------
create table public.job_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references auth.users(id) on delete set null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  reason text not null check (reason in ('cobra_taxa', 'vaga_falsa', 'conteudo_improprio', 'discriminacao', 'outro')),
  details text check (char_length(details) <= 1000),
  status text not null default 'aberta' check (status in ('aberta', 'procedente', 'improcedente')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz
);

create or replace function public.limit_job_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.job_reports where reporter_id = new.reporter_id and job_id = new.job_id and status = 'aberta') then
    raise exception 'Você já denunciou esta vaga; a moderação vai avaliar.' using errcode = '23505';
  end if;
  if (select count(*) from public.job_reports where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Limite diário de denúncias atingido' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger job_reports_limit before insert on public.job_reports for each row execute function public.limit_job_reports();

-- ---------------------------------------------------------------------------
-- 4. Funções
-- ---------------------------------------------------------------------------
-- Quem publicou encerra ou reabre (reabrir renova o prazo por 30 dias).
create or replace function public.set_my_job_status(p_job uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select status into st from public.jobs where id = p_job and poster_id = auth.uid() for update;
  if not found then raise exception 'Vaga não encontrada' using errcode = 'P0002'; end if;
  if st = 'removida' then raise exception 'Vaga removida pela moderação' using errcode = '42501'; end if;
  if p_status = 'encerrada' then
    update public.jobs set status = 'encerrada', closed_at = now() where id = p_job;
  elsif p_status = 'aberta' then
    update public.jobs set status = 'aberta', closed_at = null, expires_at = now() + interval '30 days' where id = p_job;
  else
    raise exception 'Estado inválido' using errcode = '23514';
  end if;
  return p_status;
end $$;

-- Quem publicou acompanha as candidaturas (só o status).
create or replace function public.set_application_status(p_application uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('recebida', 'vista', 'em_contato', 'nao_selecionada') then
    raise exception 'Estado inválido' using errcode = '23514';
  end if;
  update public.job_applications a set status = p_status
    from public.jobs j
   where a.id = p_application and j.id = a.job_id and j.poster_id = auth.uid();
  if not found then raise exception 'Candidatura não encontrada' using errcode = 'P0002'; end if;
  return p_status;
end $$;

-- Moderação: remove a vaga do ar (as candidaturas continuam só com o candidato e quem publicou).
create or replace function public.admin_set_job_status(p_job uuid, p_status text, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare st text; t text;
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Informe o motivo' using errcode = '23514'; end if;
  if p_status not in ('removida', 'encerrada') then raise exception 'Estado inválido' using errcode = '23514'; end if;
  select status, title into st, t from public.jobs where id = p_job for update;
  if not found then raise exception 'Vaga não encontrada' using errcode = 'P0002'; end if;
  update public.jobs set status = p_status, closed_at = coalesce(closed_at, now()),
         removed_note = case when p_status = 'removida' then p_note else removed_note end
   where id = p_job;
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), case when p_status = 'removida' then 'remover_vaga' else 'encerrar_vaga' end, 'job', p_job::text,
          '“' || t || '”: ' || p_note || ' (de ' || st || ' para ' || p_status || ')');
  return p_status;
end $$;

create or replace function public.admin_resolve_job_report(p_report bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if p_status not in ('procedente', 'improcedente') then raise exception 'Estado inválido' using errcode = '23514'; end if;
  update public.job_reports set status = p_status, resolved_by = auth.uid(), resolved_at = now() where id = p_report;
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'avaliar_denuncia_vaga', 'job_report', p_report::text, p_status || coalesce(': ' || nullif(trim(p_note), ''), ''));
end $$;

-- Retenção: candidaturas de vagas encerradas/vencidas há mais de 90 dias.
-- Devolve os arquivos para o servidor apagar no storage e então apaga as linhas.
create or replace function public.purge_old_applications()
returns table (resume_path text) language sql security definer set search_path = '' as $$
  delete from public.job_applications a
   using public.jobs j
   where j.id = a.job_id
     and (case when j.status = 'aberta' then j.expires_at else coalesce(j.closed_at, j.expires_at) end) < now() - interval '90 days'
  returning a.resume_path
$$;

-- Contagem de candidaturas por vaga para quem publicou.
create or replace function public.my_jobs_overview()
returns table (job_id uuid, total bigint, novas bigint)
language sql stable security definer set search_path = '' as $$
  select j.id, count(a.id), count(a.id) filter (where a.status = 'recebida')
    from public.jobs j left join public.job_applications a on a.job_id = j.id
   where j.poster_id = auth.uid()
   group by j.id
$$;

-- ---------------------------------------------------------------------------
-- 5. Permissões
-- ---------------------------------------------------------------------------
revoke execute on function public.set_my_job_status(uuid, text) from public, anon;
revoke execute on function public.set_application_status(uuid, text) from public, anon;
revoke execute on function public.admin_set_job_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_resolve_job_report(bigint, text, text) from public, anon;
revoke execute on function public.my_jobs_overview() from public, anon;
revoke execute on function public.purge_old_applications() from public, anon, authenticated;
grant execute on function public.purge_old_applications() to service_role;

revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to anon, authenticated;
grant insert (poster_id, title, company_name, description, requirements, employment_type, work_mode, city_id, neighborhood_id, salary_text, openings)
  on public.jobs to authenticated;
grant update (title, company_name, description, requirements, employment_type, work_mode, neighborhood_id, salary_text, openings)
  on public.jobs to authenticated;
grant delete on public.jobs to authenticated;

revoke all on public.job_applications from anon, authenticated;
grant select, delete on public.job_applications to authenticated;
grant insert (job_id, applicant_id, full_name, email, phone, message, resume_path, resume_filename, resume_size, consent_at)
  on public.job_applications to authenticated;

revoke all on public.job_reports from anon, authenticated;
grant select on public.job_reports to authenticated;
grant insert (reporter_id, job_id, reason, details) on public.job_reports to authenticated;

alter table public.jobs enable row level security;
alter table public.job_applications enable row level security;
alter table public.job_reports enable row level security;

-- Funções auxiliares das políticas (SECURITY DEFINER evita recursão entre as políticas das duas tabelas).
create or replace function public.is_job_poster(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j where j.id = p_job and j.poster_id = auth.uid())
$$;
create or replace function public.applied_to_job(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_applications a where a.job_id = p_job and a.applicant_id = auth.uid())
$$;
revoke execute on function public.is_job_poster(uuid) from public, anon;
revoke execute on function public.applied_to_job(uuid) from public, anon;
grant execute on function public.is_job_poster(uuid) to authenticated;
grant execute on function public.applied_to_job(uuid) to authenticated;

-- Vagas: o público vê as abertas; quem publicou vê todas as suas; o candidato continua vendo
-- a vaga em que se candidatou (mesmo encerrada); a administração vê todas.
create policy "vagas abertas publicas" on public.jobs for select to anon, authenticated
  using (status = 'aberta' and expires_at > now());
create policy "dono candidato ou admin ve" on public.jobs for select to authenticated
  using (poster_id = auth.uid() or public.applied_to_job(id) or public.is_admin());
create policy "usuario publica" on public.jobs for insert to authenticated
  with check (poster_id = auth.uid());
create policy "dono edita" on public.jobs for update to authenticated
  using (poster_id = auth.uid() and status <> 'removida') with check (poster_id = auth.uid());
create policy "dono exclui" on public.jobs for delete to authenticated
  using (poster_id = auth.uid());

-- Candidatura: o candidato e quem publicou a vaga. A administração NÃO lê currículos.
create policy "candidato ou anunciante le" on public.job_applications for select to authenticated
  using (applicant_id = auth.uid() or public.is_job_poster(job_id));
create policy "candidato envia" on public.job_applications for insert to authenticated
  with check (applicant_id = auth.uid());
create policy "candidato desiste" on public.job_applications for delete to authenticated
  using (applicant_id = auth.uid());

create policy "usuario denuncia vaga" on public.job_reports for insert to authenticated
  with check (reporter_id = auth.uid());
create policy "ve as proprias ou admin" on public.job_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. Armazenamento dos currículos: bucket PRIVADO, só PDF, até 4 MB.
--    Caminho: {id do candidato}/{id aleatório}.pdf
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('curriculos', 'curriculos', false, 4194304, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "candidato envia curriculo" on storage.objects for insert to authenticated
  with check (bucket_id = 'curriculos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "candidato remove curriculo" on storage.objects for delete to authenticated
  using (bucket_id = 'curriculos' and (storage.foldername(name))[1] = auth.uid()::text);
-- Leitura: o próprio candidato ou quem publicou a vaga da candidatura.
create policy "candidato ou anunciante le curriculo" on storage.objects for select to authenticated
  using (bucket_id = 'curriculos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.job_applications a
                where a.resume_path = objects.name and public.is_job_poster(a.job_id))));


-- ===== 20261125000800_banco_curriculos.sql =====
-- Resolve Aqui · banco de currículos (migração aditiva)
-- A pessoa deixa o currículo sem escolher uma vaga. Quem pode consultar: somente contas com
-- pelo menos uma vaga aberta (quem está contratando). A administração não consulta.
-- O candidato autoriza, pode ocultar ou apagar quando quiser, e o currículo vence em 6 meses
-- (salvar de novo renova). Vencido há mais de 30 dias, é apagado.

create table public.talent_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 100),
  desired_role text not null check (char_length(desired_role) between 3 and 100),
  summary text check (char_length(summary) <= 1500),
  neighborhood_id integer references public.neighborhoods(id),
  email text not null check (char_length(email) between 5 and 160),
  phone text check (phone ~ '^[0-9]{10,11}$'),
  resume_path text not null unique,
  resume_filename text not null check (char_length(resume_filename) <= 120),
  resume_size integer not null check (resume_size between 1 and 4194304),
  consent_at timestamptz not null,
  visible boolean not null default true,
  expires_at timestamptz not null default now() + interval '180 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_norm text generated always as (public.normalize_text(desired_role || ' ' || coalesce(summary, ''))) stored
);
create index talent_profiles_listing_idx on public.talent_profiles(visible, expires_at, updated_at desc);
create index talent_profiles_search_trgm on public.talent_profiles using gin (search_norm extensions.gin_trgm_ops);

-- Arquivo na pasta do próprio usuário; cada salvamento renova o prazo de 6 meses.
create or replace function public.talent_profiles_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if split_part(new.resume_path, '/', 1) <> new.user_id::text then
    raise exception 'Arquivo de currículo inválido' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.expires_at := now() + interval '180 days';
  return new;
end $$;
create trigger talent_profiles_check before insert or update on public.talent_profiles
  for each row execute function public.talent_profiles_check();

-- Quem está contratando: tem ao menos uma vaga aberta e no prazo.
create or replace function public.can_browse_talent()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j where j.poster_id = auth.uid() and j.status = 'aberta' and j.expires_at > now())
$$;
revoke execute on function public.can_browse_talent() from public, anon;
grant execute on function public.can_browse_talent() to authenticated;

-- Retenção: vencidos há mais de 30 dias. Devolve os arquivos para o servidor apagar.
create or replace function public.purge_old_talent()
returns table (resume_path text) language sql security definer set search_path = '' as $$
  delete from public.talent_profiles t where t.expires_at < now() - interval '30 days' returning t.resume_path
$$;
revoke execute on function public.purge_old_talent() from public, anon, authenticated;
grant execute on function public.purge_old_talent() to service_role;

revoke all on public.talent_profiles from anon, authenticated;
grant select, delete on public.talent_profiles to authenticated;
grant insert (user_id, full_name, desired_role, summary, neighborhood_id, email, phone, resume_path, resume_filename, resume_size, consent_at, visible)
  on public.talent_profiles to authenticated;
grant update (full_name, desired_role, summary, neighborhood_id, email, phone, resume_path, resume_filename, resume_size, consent_at, visible)
  on public.talent_profiles to authenticated;

alter table public.talent_profiles enable row level security;
create policy "dono ve o proprio" on public.talent_profiles for select to authenticated
  using (user_id = auth.uid());
create policy "quem contrata consulta" on public.talent_profiles for select to authenticated
  using (visible and expires_at > now() and public.can_browse_talent());
create policy "dono cria" on public.talent_profiles for insert to authenticated with check (user_id = auth.uid());
create policy "dono edita" on public.talent_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono apaga" on public.talent_profiles for delete to authenticated using (user_id = auth.uid());

-- Leitura do arquivo no storage por quem está contratando (o dono já lê pela regra da pasta).
create policy "quem contrata le curriculo do banco" on storage.objects for select to authenticated
  using (bucket_id = 'curriculos' and exists (
    select 1 from public.talent_profiles t
     where t.resume_path = objects.name and t.visible and t.expires_at > now() and public.can_browse_talent()));


-- ===== 20261125000900_publicacoes.sql =====
-- Resolve Aqui · publicações dos prestadores (feed no estilo Facebook), comentários, "Útil" e denúncias.
-- Migração aditiva: não altera dados existentes. Acrescenta:
--   posts, post_media, post_comments, post_reactions, post_reports, member_names,
--   bucket público post-media (fotos WebP reprocessadas no servidor e vídeos curtos de até 50 MB),
--   funções feed_posts, hide_comment e as de moderação.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.provider_profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  status text not null default 'publicado' check (status in ('publicado', 'removido')),
  removed_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_feed_idx on public.posts(created_at desc) where status = 'publicado';
create index posts_author_idx on public.posts(author_id, created_at desc);

create table public.post_media (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  kind text not null check (kind in ('foto', 'video')),
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  sort smallint not null default 0
);
create index post_media_post_idx on public.post_media(post_id, sort);

-- Nome mostrado nos comentários de quem não é prestador (o e-mail nunca aparece).
create table public.member_names (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 60),
  updated_at timestamptz not null default now()
);

create table public.post_comments (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  status text not null default 'visivel' check (status in ('visivel', 'oculto', 'removido')),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments(post_id, created_at);

create table public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references auth.users(id) on delete set null,
  post_id uuid not null references public.posts(id) on delete cascade,
  comment_id bigint references public.post_comments(id) on delete cascade,
  reason text not null check (reason in ('golpe_ou_cobranca', 'conteudo_improprio', 'ofensa_ou_assedio', 'spam', 'outro')),
  details text check (char_length(details) <= 1000),
  status text not null default 'aberta' check (status in ('aberta', 'procedente', 'improcedente')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Regras (gatilhos)
-- ---------------------------------------------------------------------------
-- auth.uid() nulo = servidor (service_role) ou SQL direto: liberado.
create or replace function public.posts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.author_id <> auth.uid() then
      raise exception 'Publique só no seu perfil' using errcode = '42501';
    end if;
    if not exists (select 1 from public.provider_profiles p where p.id = new.author_id and p.status = 'published') then
      raise exception 'Publique seu perfil de prestador antes de postar' using errcode = '42501';
    end if;
    if auth.uid() is not null and (select count(*) from public.posts where author_id = new.author_id and created_at > now() - interval '1 day') >= 10 then
      raise exception 'Limite de 10 publicações por dia' using errcode = '54000';
    end if;
    new.status := 'publicado'; new.removed_note := null; new.created_at := now();
  else
    if auth.uid() is not null and not public.is_admin() then
      new.author_id := old.author_id; new.status := old.status; new.removed_note := old.removed_note; new.created_at := old.created_at;
      if old.status = 'removido' then raise exception 'Publicação removida pela moderação' using errcode = '42501'; end if;
    end if;
  end if;
  new.body := trim(new.body);
  new.updated_at := now();
  return new;
end $$;
create trigger posts_check before insert or update on public.posts for each row execute function public.posts_check();

create or replace function public.post_media_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a uuid; fotos int; videos int;
begin
  select author_id into a from public.posts where id = new.post_id;
  if auth.uid() is not null and a is distinct from auth.uid() then
    raise exception 'Publicação não encontrada' using errcode = '42501';
  end if;
  if split_part(new.path, '/', 1) <> a::text then
    raise exception 'Arquivo fora da sua pasta' using errcode = '42501';
  end if;
  select count(*) filter (where kind = 'foto'), count(*) filter (where kind = 'video') into fotos, videos
    from public.post_media where post_id = new.post_id;
  if new.kind = 'video' and (videos > 0 or fotos > 0) then
    raise exception 'Use um vídeo OU até 6 fotos por publicação' using errcode = '23514';
  end if;
  if new.kind = 'foto' and (videos > 0 or fotos >= 6) then
    raise exception 'Use um vídeo OU até 6 fotos por publicação' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger post_media_check before insert on public.post_media for each row execute function public.post_media_check();

create or replace function public.post_comments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if auth.uid() is not null and new.author_id <> auth.uid() then
    raise exception 'Comente com a sua conta' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts where id = new.post_id and status = 'publicado') then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  select coalesce(
    (select nullif(trim(p.display_name), '') from public.provider_profiles p where p.id = new.author_id and p.status = 'published'),
    (select m.name from public.member_names m where m.user_id = new.author_id)) into nm;
  if nm is null then raise exception 'Informe seu nome para comentar' using errcode = '23514'; end if;
  if auth.uid() is not null and (select count(*) from public.post_comments where author_id = new.author_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Muitos comentários em pouco tempo. Aguarde um pouco.' using errcode = '54000';
  end if;
  new.author_name := nm; new.status := 'visivel'; new.created_at := now(); new.body := trim(new.body);
  return new;
end $$;
create trigger post_comments_check before insert on public.post_comments for each row execute function public.post_comments_check();

create or replace function public.limit_post_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.post_reports where reporter_id = new.reporter_id and post_id = new.post_id
              and comment_id is not distinct from new.comment_id and status = 'aberta') then
    raise exception 'Você já denunciou isto; a moderação vai avaliar.' using errcode = '23505';
  end if;
  if (select count(*) from public.post_reports where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Limite diário de denúncias atingido' using errcode = '54000';
  end if;
  if new.comment_id is not null and not exists (select 1 from public.post_comments c where c.id = new.comment_id and c.post_id = new.post_id) then
    raise exception 'Comentário não encontrado' using errcode = 'P0002';
  end if;
  new.status := 'aberta'; new.resolved_by := null; new.resolved_at := null;
  return new;
end $$;
create trigger post_reports_limit before insert on public.post_reports for each row execute function public.limit_post_reports();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.member_names enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_reports enable row level security;

-- Publicação visível: publicada e de perfil publicado (a RLS de provider_profiles esconde os demais).
create policy "publicadas, proprias ou admin" on public.posts for select to anon, authenticated
  using ((status = 'publicado' and exists (select 1 from public.provider_profiles p where p.id = author_id and p.status = 'published'))
         or author_id = auth.uid() or public.is_admin());
create policy "prestador publica" on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy "dono edita" on public.posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "dono apaga" on public.posts for delete to authenticated using (author_id = auth.uid());

create policy "conforme publicacao" on public.post_media for select to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "dono anexa" on public.post_media for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
create policy "dono remove" on public.post_media for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

create policy "proprio nome" on public.member_names for select to authenticated using (user_id = auth.uid());
create policy "define o proprio nome" on public.member_names for insert to authenticated with check (user_id = auth.uid());
create policy "atualiza o proprio nome" on public.member_names for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "visiveis, proprios, do autor ou admin" on public.post_comments for select to anon, authenticated
  using ((status = 'visivel' and exists (select 1 from public.posts p where p.id = post_id))
         or author_id = auth.uid()
         or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
         or public.is_admin());
create policy "comenta com a propria conta" on public.post_comments for insert to authenticated with check (author_id = auth.uid());
create policy "apaga o proprio comentario" on public.post_comments for delete to authenticated using (author_id = auth.uid());

create policy "contagem publica" on public.post_reactions for select to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "marca util" on public.post_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.status = 'publicado'));
create policy "desmarca util" on public.post_reactions for delete to authenticated using (user_id = auth.uid());

create policy "denuncia logado" on public.post_reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "admin ou quem denunciou" on public.post_reports for select to authenticated using (public.is_admin() or reporter_id = auth.uid());

revoke all on public.posts, public.post_media, public.member_names, public.post_comments, public.post_reactions, public.post_reports from anon, authenticated;
grant select on public.posts, public.post_media, public.post_comments, public.post_reactions to anon, authenticated;
grant insert (author_id, body) on public.posts to authenticated;
grant update (body) on public.posts to authenticated;
grant delete on public.posts to authenticated;
grant insert (post_id, kind, path, sort) on public.post_media to authenticated;
grant delete on public.post_media to authenticated;
grant select, insert (user_id, name, updated_at), update (user_id, name, updated_at) on public.member_names to authenticated;
grant insert (post_id, author_id, body) on public.post_comments to authenticated;
grant delete on public.post_comments to authenticated;
grant insert (post_id, user_id), delete on public.post_reactions to authenticated;
grant select, insert (reporter_id, post_id, comment_id, reason, details) on public.post_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Funções
-- ---------------------------------------------------------------------------
-- Feed (SECURITY INVOKER: obedece à RLS). Ordem: mais recentes; paginação por data.
create or replace function public.feed_posts(
  p_city_slug text default null, p_author uuid default null, p_post uuid default null,
  p_before timestamptz default null, p_limit integer default 20
)
returns table (
  id uuid, body text, created_at timestamptz, author_id uuid, slug text, display_name text, photo_path text,
  main_service text, area_label text, available_today boolean, media jsonb,
  reactions bigint, comments bigint, reacted boolean, last_comment jsonb
)
language sql stable set search_path = '' as $$
  select po.id, po.body, po.created_at, pr.id, pr.slug, pr.display_name, pr.photo_path, s.name,
         public.provider_area_label(pr.id),
         exists (select 1 from public.availability_today a where a.provider_id = pr.id and a.expires_at > now()),
         coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'path', m.path) order by m.sort, m.id)
                     from public.post_media m where m.post_id = po.id), '[]'::jsonb),
         (select count(*) from public.post_reactions r where r.post_id = po.id),
         (select count(*) from public.post_comments c where c.post_id = po.id and c.status = 'visivel'),
         exists (select 1 from public.post_reactions r where r.post_id = po.id and r.user_id = auth.uid()),
         (select jsonb_build_object('name', c.author_name, 'body', c.body)
            from public.post_comments c where c.post_id = po.id and c.status = 'visivel'
           order by c.created_at desc limit 1)
    from public.posts po
    join public.provider_profiles pr on pr.id = po.author_id
    left join public.services s on s.id = pr.main_service_id
   where po.status = 'publicado' and pr.status = 'published'
     and (p_city_slug is null or pr.serves_online or pr.city_id = (select c.id from public.cities c where c.slug = p_city_slug))
     and (p_author is null or po.author_id = p_author)
     and (p_post is null or po.id = p_post)
     and (p_before is null or po.created_at < p_before)
   order by po.created_at desc
   limit least(coalesce(p_limit, 20), 50)
$$;

-- Autor da publicação oculta ou mostra um comentário (não mexe no que a moderação removeu).
create or replace function public.hide_comment(p_comment bigint, p_hide boolean)
returns text language plpgsql security definer set search_path = '' as $$
begin
  update public.post_comments c set status = case when p_hide then 'oculto' else 'visivel' end
    from public.posts p
   where c.id = p_comment and p.id = c.post_id and p.author_id = auth.uid() and c.status <> 'removido';
  if not found then raise exception 'Comentário não encontrado' using errcode = 'P0002'; end if;
  return case when p_hide then 'oculto' else 'visivel' end;
end $$;

create or replace function public.admin_remove_post(p_post uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Informe o motivo' using errcode = '23514'; end if;
  update public.posts set status = 'removido', removed_note = p_note where id = p_post;
  if not found then raise exception 'Publicação não encontrada' using errcode = 'P0002'; end if;
  update public.post_reports set status = 'procedente', resolved_by = auth.uid(), resolved_at = now()
   where post_id = p_post and comment_id is null and status = 'aberta';
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'remover_publicacao', 'post', p_post::text, p_note);
end $$;

create or replace function public.admin_remove_comment(p_comment bigint, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Informe o motivo' using errcode = '23514'; end if;
  update public.post_comments set status = 'removido' where id = p_comment;
  if not found then raise exception 'Comentário não encontrado' using errcode = 'P0002'; end if;
  update public.post_reports set status = 'procedente', resolved_by = auth.uid(), resolved_at = now()
   where comment_id = p_comment and status = 'aberta';
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'remover_comentario', 'comment', p_comment::text, p_note);
end $$;

create or replace function public.admin_resolve_post_report(p_report bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if p_status not in ('procedente', 'improcedente') then raise exception 'Estado inválido' using errcode = '23514'; end if;
  update public.post_reports set status = p_status, resolved_by = auth.uid(), resolved_at = now() where id = p_report;
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'avaliar_denuncia_publicacao', 'post_report', p_report::text, p_status || coalesce(': ' || nullif(trim(p_note), ''), ''));
end $$;

revoke execute on function public.hide_comment(bigint, boolean) from public, anon;
revoke execute on function public.admin_remove_post(uuid, text) from public, anon;
revoke execute on function public.admin_remove_comment(bigint, text) from public, anon;
revoke execute on function public.admin_resolve_post_report(bigint, text, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 5. Arquivos: bucket público post-media (cada um grava só na própria pasta)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800, array['image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "midia publica" on storage.objects for select to anon, authenticated
  using (bucket_id = 'post-media');
create policy "midia: dono envia na propria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "midia: dono remove na propria pasta" on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);


-- ===== 20261125001000_comunidade.sql =====
-- Resolve Aqui · Comunidade de Campo Grande (amplia as publicações da migração 000900).
-- Migração aditiva: preserva posts, mídias, comentários e reações existentes. Acrescenta:
--   1. tipos de publicação: trabalho (prestador), divulgação (prestador, preço opcional) e pedido de indicação (qualquer conta com nome público);
--   2. serviço/categoria, bairro, "Indicação encontrada", envio idempotente (client_token) e marca de edição;
--   3. ordem, capa (primeira) e rótulos Antes/Depois nas fotos;
--   4. publicações salvas; respostas, edição e indicação de prestador nos comentários;
--   5. feed com filtros (tipo, categoria, bairro pela área de atendimento) e paginação estável;
--   6. bucket post-media passa a privado: o servidor entrega links assinados só de publicações visíveis.

-- ---------------------------------------------------------------------------
-- 1. Publicações: autor passa a ser a conta (pedidos de indicação não exigem perfil profissional)
-- ---------------------------------------------------------------------------
alter table public.posts drop constraint posts_author_id_fkey;
alter table public.posts add constraint posts_author_id_fkey foreign key (author_id) references auth.users(id) on delete cascade;

alter table public.posts
  add column kind text not null default 'trabalho' check (kind in ('trabalho', 'divulgacao', 'pedido')),
  add column service_id integer references public.services(id),
  add column category_id integer references public.service_categories(id),
  add column city_id smallint references public.cities(id),
  add column neighborhood_id integer references public.neighborhoods(id),
  add column price_label text check (char_length(price_label) <= 60),
  add column found boolean not null default false,
  add column client_token uuid,
  add column edited_at timestamptz;
alter table public.posts add constraint posts_client_token_key unique (author_id, client_token);
create index posts_feed_kind_idx on public.posts(kind, created_at desc, id desc) where status = 'publicado';
create index posts_category_idx on public.posts(category_id) where status = 'publicado';

alter table public.post_media add column label text check (label in ('antes', 'depois'));

-- Nome público de qualquer conta: perfil profissional publicado ou o nome informado na comunidade.
create or replace function public.public_name(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(trim(p.display_name), '') from public.provider_profiles p where p.id = p_user and p.status = 'published'),
    (select m.name from public.member_names m where m.user_id = p_user))
$$;
grant execute on function public.public_name(uuid) to anon, authenticated;

-- Perfil profissional apto a aparecer na comunidade: publicado e com cobertura declarada.
create or replace function public.provider_in_community(p_provider uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.provider_profiles p
                  where p.id = p_provider and p.status = 'published' and public.provider_coverage(p.id) <> 'pendente')
$$;
grant execute on function public.provider_in_community(uuid) to anon, authenticated;

create or replace function public.posts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cat integer; prof_city smallint;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    if old.status = 'removido' then raise exception 'Publicação removida pela moderação' using errcode = '42501'; end if;
    new.author_id := old.author_id; new.status := old.status; new.removed_note := old.removed_note; new.created_at := old.created_at;
    new.kind := old.kind; new.client_token := old.client_token; new.city_id := old.city_id;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.author_id <> auth.uid() then
      raise exception 'Publique só com a sua conta' using errcode = '42501';
    end if;
    if auth.uid() is not null and (select count(*) from public.posts where author_id = new.author_id and created_at > now() - interval '1 day') >= 10 then
      raise exception 'Limite de 10 publicações por dia' using errcode = '54000';
    end if;
    new.status := 'publicado'; new.removed_note := null; new.created_at := now(); new.found := false; new.edited_at := null;
  end if;

  new.body := trim(new.body);
  new.price_label := nullif(trim(coalesce(new.price_label, '')), '');

  if new.kind in ('trabalho', 'divulgacao') then
    if tg_op = 'INSERT' and not public.provider_in_community(new.author_id) then
      raise exception 'Publique seu perfil de prestador e confirme a área de atendimento antes de postar' using errcode = '42501';
    end if;
    if new.service_id is null or not exists (select 1 from public.provider_services ps where ps.provider_id = new.author_id and ps.service_id = new.service_id) then
      raise exception 'Escolha um serviço oferecido no seu perfil' using errcode = '23514';
    end if;
    select p.city_id into prof_city from public.provider_profiles p where p.id = new.author_id;
    if tg_op = 'INSERT' then new.city_id := prof_city; end if;
    new.found := false;
    if new.kind = 'trabalho' then new.price_label := null; end if;
    if new.kind = 'divulgacao' and new.body = '' then raise exception 'Escreva o texto da divulgação' using errcode = '23514'; end if;
  else
    if public.public_name(new.author_id) is null then
      raise exception 'Informe seu nome público para publicar' using errcode = '23514';
    end if;
    if new.service_id is null and new.category_id is null then
      raise exception 'Escolha o serviço ou a categoria' using errcode = '23514';
    end if;
    if new.body = '' then raise exception 'Descreva o que você precisa' using errcode = '23514'; end if;
    if tg_op = 'INSERT' then new.city_id := coalesce(new.city_id, public.pilot_city_id()); end if;
    new.price_label := null;
  end if;

  if new.service_id is not null then
    select s.category_id into cat from public.services s where s.id = new.service_id and s.active;
    if cat is null then raise exception 'Serviço não encontrado' using errcode = '23514'; end if;
    new.category_id := cat;
  end if;
  if new.neighborhood_id is not null and not exists (
       select 1 from public.neighborhoods n where n.id = new.neighborhood_id and n.city_id = new.city_id and n.active) then
    raise exception 'Bairro fora da cidade' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (new.body is distinct from old.body or new.service_id is distinct from old.service_id
      or new.neighborhood_id is distinct from old.neighborhood_id or new.price_label is distinct from old.price_label) then
    new.edited_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Fotos: até 6 (ou 1 vídeo); a ordem e os rótulos podem ser trocados pelo autor.
create or replace function public.post_media_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a uuid; fotos int; videos int;
begin
  select author_id into a from public.posts where id = new.post_id;
  if tg_op = 'UPDATE' then
    new.post_id := old.post_id; new.path := old.path; new.kind := old.kind;
    if new.kind = 'video' then new.label := null; end if;
    return new;
  end if;
  if auth.uid() is not null and a is distinct from auth.uid() then
    raise exception 'Publicação não encontrada' using errcode = '42501';
  end if;
  if split_part(new.path, '/', 1) <> a::text then
    raise exception 'Arquivo fora da sua pasta' using errcode = '42501';
  end if;
  select count(*) filter (where kind = 'foto'), count(*) filter (where kind = 'video') into fotos, videos
    from public.post_media where post_id = new.post_id;
  if new.kind = 'video' and (videos > 0 or fotos > 0) then
    raise exception 'Use um vídeo OU até 6 fotos por publicação' using errcode = '23514';
  end if;
  if new.kind = 'foto' and (videos > 0 or fotos >= 6) then
    raise exception 'Use um vídeo OU até 6 fotos por publicação' using errcode = '23514';
  end if;
  if new.kind = 'video' then new.label := null; end if;
  return new;
end $$;
drop trigger post_media_check on public.post_media;
create trigger post_media_check before insert or update on public.post_media for each row execute function public.post_media_check();

-- Visibilidade: pedidos de qualquer conta; trabalhos e divulgações só de perfis publicados com cobertura.
drop policy "publicadas, proprias ou admin" on public.posts;
create policy "publicadas, proprias ou admin" on public.posts for select to anon, authenticated
  using ((status = 'publicado' and (kind = 'pedido' or public.provider_in_community(author_id)))
         or author_id = auth.uid() or public.is_admin());
drop policy "prestador publica" on public.posts;
create policy "conta publica" on public.posts for insert to authenticated with check (author_id = auth.uid());

create policy "dono reordena" on public.post_media for update to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

revoke insert, update on public.posts from authenticated;
grant insert (author_id, body, kind, service_id, category_id, neighborhood_id, price_label, client_token) on public.posts to authenticated;
grant update (body, service_id, category_id, neighborhood_id, price_label, found) on public.posts to authenticated;
revoke insert on public.post_media from authenticated;
grant insert (post_id, kind, path, sort, label) on public.post_media to authenticated;
grant update (sort, label) on public.post_media to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Publicações salvas
-- ---------------------------------------------------------------------------
create table public.post_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index post_saves_post_idx on public.post_saves(post_id);
alter table public.post_saves enable row level security;
create policy "proprios salvos" on public.post_saves for select to authenticated using (user_id = auth.uid());
create policy "salva visivel" on public.post_saves for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.status = 'publicado'));
create policy "tira dos salvos" on public.post_saves for delete to authenticated using (user_id = auth.uid());
revoke all on public.post_saves from anon, authenticated;
grant select, insert (user_id, post_id), delete on public.post_saves to authenticated;
grant select on public.post_saves to anon; -- o feed consulta "salvo?"; sem política para anon, não retorna linhas

-- ---------------------------------------------------------------------------
-- 3. Comentários: respostas (um nível), edição pelo autor e indicação de um perfil público
-- ---------------------------------------------------------------------------
alter table public.post_comments
  add column parent_id bigint references public.post_comments(id) on delete cascade,
  add column provider_id uuid references public.provider_profiles(id) on delete set null,
  add column edited_at timestamptz;
create index post_comments_parent_idx on public.post_comments(parent_id);

create or replace function public.post_comments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.is_admin() then
      if old.status = 'removido' then raise exception 'Comentário não encontrado' using errcode = '42501'; end if;
      if old.author_id = auth.uid() then
        -- quem escreveu corrige texto e indicação; o estado não muda
        new.status := old.status;
      elsif exists (select 1 from public.posts p where p.id = old.post_id and p.author_id = auth.uid()) then
        -- autor da publicação (via hide_comment): só oculta ou mostra
        if new.status not in ('visivel', 'oculto') then raise exception 'Estado inválido' using errcode = '42501'; end if;
        new.body := old.body; new.provider_id := old.provider_id;
      else
        raise exception 'Comentário não encontrado' using errcode = '42501';
      end if;
      new.post_id := old.post_id; new.author_id := old.author_id; new.author_name := old.author_name;
      new.created_at := old.created_at; new.parent_id := old.parent_id;
    end if;
    new.body := trim(new.body);
    if new.provider_id is not null and new.provider_id is distinct from old.provider_id and not public.provider_in_community(new.provider_id) then
      raise exception 'Perfil indicado não encontrado' using errcode = '23514';
    end if;
    if new.body is distinct from old.body or new.provider_id is distinct from old.provider_id then new.edited_at := now(); end if;
    return new;
  end if;
  if auth.uid() is not null and new.author_id <> auth.uid() then
    raise exception 'Comente com a sua conta' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts where id = new.post_id and status = 'publicado') then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  if new.parent_id is not null and not exists (
       select 1 from public.post_comments c where c.id = new.parent_id and c.post_id = new.post_id and c.parent_id is null and c.status <> 'removido') then
    raise exception 'Comentário respondido não encontrado' using errcode = 'P0002';
  end if;
  if new.provider_id is not null and not public.provider_in_community(new.provider_id) then
    raise exception 'Perfil indicado não encontrado' using errcode = '23514';
  end if;
  nm := public.public_name(new.author_id);
  if nm is null then raise exception 'Informe seu nome para comentar' using errcode = '23514'; end if;
  if auth.uid() is not null and (select count(*) from public.post_comments where author_id = new.author_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Muitos comentários em pouco tempo. Aguarde um pouco.' using errcode = '54000';
  end if;
  new.author_name := nm; new.status := 'visivel'; new.created_at := now(); new.body := trim(new.body); new.edited_at := null;
  return new;
end $$;
drop trigger post_comments_check on public.post_comments;
create trigger post_comments_check before insert or update on public.post_comments for each row execute function public.post_comments_check();

create policy "edita o proprio comentario" on public.post_comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
revoke insert on public.post_comments from authenticated;
grant insert (post_id, author_id, body, parent_id, provider_id) on public.post_comments to authenticated;
grant update (body, provider_id) on public.post_comments to authenticated;

-- O autor da publicação oculta ou mostra um comentário, com registro no histórico.
create or replace function public.hide_comment(p_comment bigint, p_hide boolean)
returns text language plpgsql security definer set search_path = '' as $$
begin
  update public.post_comments c set status = case when p_hide then 'oculto' else 'visivel' end
    from public.posts p
   where c.id = p_comment and p.id = c.post_id and p.author_id = auth.uid() and c.status <> 'removido';
  if not found then raise exception 'Comentário não encontrado' using errcode = 'P0002'; end if;
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), case when p_hide then 'autor_ocultou_comentario' else 'autor_mostrou_comentario' end, 'comment', p_comment::text, null);
  return case when p_hide then 'oculto' else 'visivel' end;
end $$;
revoke execute on function public.hide_comment(bigint, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Feed com filtros
--    Bairro: trabalhos/divulgações pela área de atendimento do prestador (cidade inteira entra em qualquer bairro);
--    pedidos pela região informada (pedido para a cidade toda entra em qualquer bairro).
--    "Atende hoje": mesma regra do "Preciso para hoje", para o serviço do post e o bairro filtrado.
-- ---------------------------------------------------------------------------
drop function public.feed_posts(text, uuid, uuid, timestamptz, integer);
create or replace function public.feed_posts(
  p_city_slug text default null, p_author uuid default null, p_post uuid default null,
  p_before timestamptz default null, p_limit integer default 20,
  p_kind text default null, p_category text default null, p_neighborhood integer default null,
  p_saved boolean default false, p_before_id uuid default null
)
returns table (
  id uuid, kind text, body text, created_at timestamptz, edited_at timestamptz,
  author_id uuid, is_provider boolean, slug text, display_name text, photo_path text,
  service_name text, service_slug text, category_name text, category_slug text, neighborhood_name text,
  area_label text, price_label text, found boolean, available_today boolean, media jsonb,
  reactions bigint, comments bigint, reacted boolean, saved boolean, last_comment jsonb
)
language sql stable set search_path = '' as $$
  select po.id, po.kind, po.body, po.created_at, po.edited_at,
         po.author_id, po.kind <> 'pedido', case when po.kind <> 'pedido' then pr.slug end,
         public.public_name(po.author_id), case when po.kind <> 'pedido' then pr.photo_path end,
         s.name, s.slug, sc.name, sc.slug, nb.name,
         case when po.kind <> 'pedido' then public.provider_area_label(pr.id)
              else coalesce(nb.name || ', ' || ci.name, ci.name || ' (cidade toda)') end,
         po.price_label, po.found,
         po.kind <> 'pedido' and po.service_id is not null and coalesce(public.urgent_match_area(pr.id, po.service_id, pr.city_id, p_neighborhood), false),
         coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'path', m.path, 'label', m.label) order by m.sort, m.id)
                     from public.post_media m where m.post_id = po.id), '[]'::jsonb),
         (select count(*) from public.post_reactions r where r.post_id = po.id),
         (select count(*) from public.post_comments c where c.post_id = po.id and c.status = 'visivel'),
         exists (select 1 from public.post_reactions r where r.post_id = po.id and r.user_id = auth.uid()),
         exists (select 1 from public.post_saves sv where sv.post_id = po.id and sv.user_id = auth.uid()),
         (select jsonb_build_object('name', c.author_name, 'body', c.body)
            from public.post_comments c where c.post_id = po.id and c.status = 'visivel'
           order by c.created_at desc limit 1)
    from public.posts po
    left join public.provider_profiles pr on pr.id = po.author_id
    left join public.services s on s.id = po.service_id
    left join public.service_categories sc on sc.id = po.category_id
    left join public.neighborhoods nb on nb.id = po.neighborhood_id
    left join public.cities ci on ci.id = po.city_id
   where po.status = 'publicado'
     and (po.kind = 'pedido' or (pr.status = 'published' and public.provider_coverage(pr.id) <> 'pendente'))
     and (p_city_slug is null or po.city_id is null or po.city_id = (select c.id from public.cities c where c.slug = p_city_slug)
          or (po.kind <> 'pedido' and pr.serves_online))
     and (p_author is null or po.author_id = p_author)
     and (p_post is null or po.id = p_post)
     and (p_kind is null or po.kind = p_kind)
     and (p_category is null or sc.slug = p_category)
     and (p_neighborhood is null or (
           case when po.kind = 'pedido' then po.neighborhood_id is null or po.neighborhood_id = p_neighborhood
                else pr.serves_whole_city or exists (select 1 from public.provider_areas pa where pa.provider_id = pr.id and pa.neighborhood_id = p_neighborhood)
           end))
     and (not coalesce(p_saved, false) or exists (select 1 from public.post_saves sv where sv.post_id = po.id and sv.user_id = auth.uid()))
     and (p_before is null
          or (p_before_id is null and po.created_at < p_before)
          or (p_before_id is not null and (po.created_at, po.id) < (p_before, p_before_id)))
   order by po.created_at desc, po.id desc
   limit least(coalesce(p_limit, 20), 50)
$$;

-- ---------------------------------------------------------------------------
-- 5. Mídias privadas: o servidor gera links assinados só para publicações visíveis.
--    Ocultação pela moderação ou perfil suspenso/pausado tiram o post e os arquivos do ar.
-- ---------------------------------------------------------------------------
update storage.buckets set public = false where id = 'post-media';
drop policy if exists "midia publica" on storage.objects;
create policy "midia: dono le a propria pasta" on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Nome público do autor como campo calculado (usado na administração: select=...,author_name).
create or replace function public.author_name(p public.posts)
returns text language sql stable set search_path = '' as $$ select public.public_name(p.author_id) $$;
grant execute on function public.author_name(public.posts) to authenticated;


-- ===== 20261126000100_lancamento.sql =====
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


-- ===== 20261126000200_agendamento.sql =====
-- Fase 1 do modelo "serviço com preço fixo": pacotes padronizados, agendamento, escolha do profissional,
-- acompanhamento por status e registro do pagamento na entrega. Tudo aditivo: nada existente é apagado.

-- ---------------------------------------------------------------------------
-- Pacotes (serviço padronizado com preço) e adicionais
-- ---------------------------------------------------------------------------
create table public.service_packages (
  id integer generated always as identity primary key,
  service_id integer not null references public.services(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  name text not null check (char_length(trim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 400),
  includes text[] not null default '{}' check (cardinality(includes) <= 10),
  excludes text[] not null default '{}' check (cardinality(excludes) <= 10),
  duration_min integer not null check (duration_min between 10 and 720),
  price_cents integer not null check (price_cents between 100 and 10000000),
  price_from boolean not null default false,
  featured boolean not null default false,
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_packages_service_idx on public.service_packages(service_id);
create trigger service_packages_touch before update on public.service_packages for each row execute function public.touch_updated_at();
create trigger log_packages after insert or update or delete on public.service_packages for each row execute function public.log_catalog_change();

create table public.package_addons (
  id integer generated always as identity primary key,
  package_id integer not null references public.service_packages(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 80),
  price_cents integer not null check (price_cents between 0 and 10000000),
  active boolean not null default true,
  sort integer not null default 100
);
create index package_addons_package_idx on public.package_addons(package_id);

alter table public.service_packages enable row level security;
alter table public.package_addons enable row level security;
create policy "leitura publica" on public.service_packages for select to anon, authenticated using (active or public.is_admin());
create policy "admin escreve" on public.service_packages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leitura publica" on public.package_addons for select to anon, authenticated using (active or public.is_admin());
create policy "admin escreve" on public.package_addons for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Pacote que pode ser agendado agora: ele, o serviço e a categoria ativos.
create or replace function public.package_bookable(p_package integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.service_packages k
                   join public.services s on s.id = k.service_id
                   join public.service_categories c on c.id = s.category_id
                  where k.id = p_package and k.active and s.active and c.active)
$$;

-- ---------------------------------------------------------------------------
-- Pedidos (agendamentos)
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  client_id uuid not null references auth.users(id) on delete cascade,
  city_id smallint not null references public.cities(id),
  neighborhood_id integer not null references public.neighborhoods(id),
  service_id integer not null references public.services(id),
  scheduled_date date not null,
  time_slot text not null check (time_slot in ('manha', 'tarde', 'noite')),
  notes text check (char_length(notes) <= 600),
  status text not null default 'solicitado'
    check (status in ('solicitado', 'confirmado', 'a_caminho', 'em_andamento', 'concluido', 'cancelado')),
  provider_id uuid references public.provider_profiles(id) on delete set null,
  total_cents integer not null check (total_cents >= 0),
  price_from boolean not null default false,
  payment_method text not null check (payment_method in ('pix_na_entrega', 'dinheiro_na_entrega')),
  commission_pct numeric(5, 2),
  commission_cents integer,
  cancel_kind text check (cancel_kind in ('cliente', 'profissional', 'nao_compareceu', 'equipe')),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  confirmed_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_client_idx on public.bookings(client_id, created_at desc);
create index bookings_provider_idx on public.bookings(provider_id, scheduled_date);
create index bookings_date_idx on public.bookings(scheduled_date, status);
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();

-- Endereço e telefone do cliente: o profissional só vê depois de confirmar o pedido.
create table public.booking_private (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  address_line text not null check (char_length(trim(address_line)) between 5 and 200),
  contact_phone text not null check (contact_phone ~ '^[0-9]{10,11}$')
);

create table public.booking_items (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  package_id integer references public.service_packages(id) on delete set null,
  name text not null,
  qty integer not null check (qty between 1 and 10),
  unit_cents integer not null,
  addons jsonb not null default '[]',
  subtotal_cents integer not null
);
create index booking_items_booking_idx on public.booking_items(booking_id);

create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status text not null,
  actor_role text not null check (actor_role in ('cliente', 'profissional', 'equipe', 'sistema')),
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events(booking_id, created_at);

-- Pagamento: na fase 1 só "na entrega" (Pix ou dinheiro), registrado por quem recebeu.
-- `gateway` e `gateway_ref` ficam prontos para o "Pix garantido" (valor retido até o cliente confirmar).
create table public.payments (
  id bigint generated always as identity primary key,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  method text not null check (method in ('pix_na_entrega', 'dinheiro_na_entrega', 'pix_garantido')),
  gateway text not null default 'na_entrega',
  gateway_ref text,
  status text not null default 'pendente' check (status in ('pendente', 'retido', 'pago', 'estornado')),
  amount_cents integer not null,
  paid_at timestamptz,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.bookings enable row level security;
alter table public.booking_private enable row level security;
alter table public.booking_items enable row level security;
alter table public.booking_events enable row level security;
alter table public.payments enable row level security;

create or replace function public.booking_visible(p_booking uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b
                  where b.id = p_booking and (b.client_id = auth.uid() or b.provider_id = auth.uid() or public.is_admin()))
$$;

create policy "cliente, profissional ou equipe" on public.bookings for select to authenticated
  using (client_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
create policy "cliente, profissional confirmado ou equipe" on public.booking_private for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                  and (b.client_id = auth.uid() or public.is_admin()
                       or (b.provider_id = auth.uid() and b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido')))));
create policy "quem ve o pedido" on public.booking_items for select to authenticated using (public.booking_visible(booking_id));
create policy "quem ve o pedido" on public.booking_events for select to authenticated using (public.booking_visible(booking_id));
create policy "quem ve o pedido" on public.payments for select to authenticated using (public.booking_visible(booking_id));

-- Avaliação do cliente depois do serviço concluído (uma por pedido). Entra na nota usada para sugerir profissionais.
create table public.booking_reviews (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.provider_profiles (id) on delete cascade,
  client_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index booking_reviews_provider_idx on public.booking_reviews (provider_id);
alter table public.booking_reviews enable row level security;
create policy "quem ve o pedido" on public.booking_reviews for select to authenticated using (public.booking_visible(booking_id));
-- Nenhuma política de escrita: tudo passa pelas funções abaixo.

insert into public.app_settings (key, value) values
  ('comissao', '{"percent": 12}'),
  ('prazo_aceite', '{"minutes": 10}')
on conflict (key) do nothing;

-- Data de hoje e hora em Campo Grande.
create or replace function public.cg_now()
returns timestamp language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Campo_Grande')
$$;

-- Faixa ainda dá para hoje: até 1 hora antes do fim (manhã 8h–12h, tarde 12h–18h, noite 18h–21h).
create or replace function public.slot_open(p_date date, p_slot text)
returns boolean language sql stable set search_path = '' as $$
  select case
           when p_date > public.cg_now()::date then p_date <= public.cg_now()::date + 14
           when p_date < public.cg_now()::date then false
           else public.cg_now()::time < case p_slot when 'manha' then time '11:00' when 'tarde' then time '17:00' else time '20:00' end
         end
$$;

-- Alguém confirmou "Atendo hoje" para o serviço do pacote (para destacar "Hoje").
create or replace function public.package_today(p_package integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.service_packages k
                   join public.availability_today a on k.service_id = any (a.service_ids) and a.expires_at > now()
                   join public.provider_profiles p on p.id = a.provider_id and p.status = 'published'
                  where k.id = p_package and public.provider_cleared(p.id))
$$;

-- Profissionais que podem atender o pedido, já ordenados (os 3 melhores).
-- Sem notas na fase 1, a ordem usa: atende hoje, comparecimento, serviços concluídos, selos e se atende o bairro
-- pela lista de bairros (mais perto) em vez da cidade toda.
create or replace function public.booking_candidates(p_booking uuid)
returns table (provider_id uuid, slug text, display_name text, photo_path text, available_today boolean,
               completed integer, show_rate integer, identity_checked boolean, refs_confirmed integer, near boolean,
               rating numeric, reviews integer)
language sql stable security definer set search_path = '' as $$
  with b as (select * from public.bookings where id = p_booking
               and (client_id = auth.uid() or public.is_admin() or auth.role() = 'service_role')),
  base as (
    select p.id, p.slug, p.display_name, p.photo_path,
           exists (select 1 from public.availability_today a
                    where a.provider_id = p.id and a.expires_at > now() and b.service_id = any (a.service_ids)
                      and (a.whole_city or b.neighborhood_id = any (a.neighborhood_ids))) as today,
           exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = b.neighborhood_id) as near,
           (select count(*)::int from public.bookings x where x.provider_id = p.id and x.status = 'concluido') as done,
           (select count(*)::int from public.bookings x where x.provider_id = p.id and x.cancel_kind = 'nao_compareceu') as noshow,
           coalesce((select v.identity_checked_at is not null from public.provider_verification v where v.provider_id = p.id), false) as idok,
           (select count(*)::int from public.provider_references r where r.provider_id = p.id and r.result = 'confirmada') as refs,
           (select round(avg(rv.rating), 1) from public.booking_reviews rv where rv.provider_id = p.id) as stars,
           (select count(*)::int from public.booking_reviews rv where rv.provider_id = p.id) as nrev,
           b.scheduled_date = public.cg_now()::date as for_today
      from b
      join public.provider_profiles p on p.city_id = b.city_id and p.status = 'published'
      join public.provider_private pp on pp.provider_id = p.id and pp.whatsapp is not null
     where public.provider_cleared(p.id)
       and public.provider_coverage(p.id) <> 'pendente'
       and exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id = b.service_id)
       and public.provider_service_public(p.id, b.service_id)
       and (p.serves_whole_city or exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = b.neighborhood_id))
       and not exists (select 1 from public.bookings o where o.provider_id = p.id and o.id <> b.id
                        and o.scheduled_date = b.scheduled_date and o.time_slot = b.time_slot
                        and o.status in ('confirmado', 'a_caminho', 'em_andamento'))
  )
  select id, slug, display_name, photo_path, today and for_today, done,
         case when done + noshow = 0 then null else round(100.0 * done / (done + noshow))::int end,
         idok, refs, near, stars, nrev
    from base
   where not for_today or today
   order by (today and for_today) desc, coalesce(stars, 4.5) desc, coalesce(case when done + noshow = 0 then null else 100.0 * done / (done + noshow) end, 90) desc,
            done desc, idok desc, refs desc, near desc, display_name
   limit 3
$$;

create or replace function public.booking_log(p_booking uuid, p_status text, p_role text, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.booking_events (booking_id, status, actor_role, actor_id, note)
  values (p_booking, p_status, p_role, auth.uid(), p_note)
$$;

-- Cria o pedido com o preço calculado no banco. Se só houver um profissional possível, ele já é escolhido.
create or replace function public.create_booking(
  p_package integer, p_qty integer, p_addons integer[], p_date date, p_slot text, p_neighborhood integer,
  p_address text, p_phone text, p_notes text, p_payment text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k public.service_packages;
  nb public.neighborhoods;
  addon_rows jsonb;
  addon_sum integer;
  unit integer;
  bid uuid;
  only_one uuid;
  n integer;
  phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if uid is null then raise exception 'login_required'; end if;
  if not public.rate_limit_hit('booking', uid::text, 6, 3600) then raise exception 'rate_limited'; end if;
  select * into k from public.service_packages where id = p_package;
  if k.id is null or not public.package_bookable(k.id) then raise exception 'package_unavailable'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'invalid_qty'; end if;
  if p_slot not in ('manha', 'tarde', 'noite') or p_date is null or not public.slot_open(p_date, p_slot) then raise exception 'invalid_slot'; end if;
  select n2.* into nb from public.neighborhoods n2 join public.cities c on c.id = n2.city_id and c.is_pilot where n2.id = p_neighborhood;
  if nb.id is null then raise exception 'invalid_neighborhood'; end if;
  if char_length(trim(coalesce(p_address, ''))) not between 5 and 200 then raise exception 'invalid_address'; end if;
  if phone !~ '^[0-9]{10,11}$' then raise exception 'invalid_phone'; end if;
  if char_length(coalesce(p_notes, '')) > 600 then raise exception 'invalid_notes'; end if;
  if p_payment not in ('pix_na_entrega', 'dinheiro_na_entrega') then raise exception 'invalid_payment'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price_cents', a.price_cents) order by a.sort, a.id), '[]'),
         coalesce(sum(a.price_cents), 0)::int, count(*)::int
    into addon_rows, addon_sum, n
    from public.package_addons a
   where a.package_id = k.id and a.active and a.id = any (coalesce(p_addons, '{}'));
  if n <> cardinality(array(select distinct x from unnest(coalesce(p_addons, '{}')) x)) then raise exception 'invalid_addons'; end if;
  unit := k.price_cents + addon_sum;

  insert into public.bookings (client_id, city_id, neighborhood_id, service_id, scheduled_date, time_slot, notes,
                               total_cents, price_from, payment_method)
  values (uid, nb.city_id, nb.id, k.service_id, p_date, p_slot, nullif(trim(coalesce(p_notes, '')), ''),
          unit * p_qty, k.price_from, p_payment)
  returning id into bid;
  insert into public.booking_private (booking_id, address_line, contact_phone) values (bid, trim(p_address), phone);
  insert into public.booking_items (booking_id, package_id, name, qty, unit_cents, addons, subtotal_cents)
  values (bid, k.id, k.name, p_qty, unit, addon_rows, unit * p_qty);
  insert into public.payments (booking_id, method, amount_cents) values (bid, p_payment, unit * p_qty);
  perform public.booking_log(bid, 'solicitado', 'cliente');

  select count(*)::int, (array_agg(c.provider_id))[1] into n, only_one from public.booking_candidates(bid) c;
  if n = 1 then
    update public.bookings set provider_id = only_one where id = bid;
    perform public.booking_log(bid, 'profissional_escolhido', 'sistema', 'Único profissional disponível');
  end if;
  return bid;
end $$;

-- Cliente escolhe um dos profissionais sugeridos (enquanto o pedido não foi confirmado).
create or replace function public.choose_booking_provider(p_booking uuid, p_provider uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.client_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if b.status <> 'solicitado' then raise exception 'invalid_status'; end if;
  if not exists (select 1 from public.booking_candidates(p_booking) c where c.provider_id = p_provider) then raise exception 'invalid_provider'; end if;
  update public.bookings set provider_id = p_provider where id = p_booking;
  perform public.booking_log(p_booking, 'profissional_escolhido', 'cliente');
end $$;

-- Mudança de status por quem pode:
--   profissional escolhido: confirmar/recusar (solicitado), a_caminho, em_andamento, concluido, pago;
--   cliente: cancelar enquanto solicitado ou confirmado;
--   equipe: qualquer passo, cancelar (com o tipo) e marcar pago.
create or replace function public.booking_action(p_booking uuid, p_action text, p_note text default null, p_cancel_kind text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  uid uuid := auth.uid();
  role text;
  next_status text;
  pct numeric;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then raise exception 'not_found'; end if;
  role := case when public.is_admin() then 'equipe' when b.provider_id = uid then 'profissional'
               when b.client_id = uid then 'cliente' end;
  if role is null then raise exception 'not_allowed'; end if;
  if char_length(coalesce(note, '')) > 300 then raise exception 'invalid_note'; end if;

  if p_action = 'cancelar' then
    if b.status in ('concluido', 'cancelado') then raise exception 'invalid_status'; end if;
    if role = 'cliente' and b.status not in ('solicitado', 'confirmado') then raise exception 'invalid_status'; end if;
    if role = 'profissional' then raise exception 'not_allowed'; end if;
    update public.bookings set status = 'cancelado', canceled_at = now(),
           cancel_kind = case when role = 'cliente' then 'cliente'
                              when p_cancel_kind in ('profissional', 'nao_compareceu', 'equipe', 'cliente') then p_cancel_kind else 'equipe' end,
           cancel_reason = note
     where id = b.id;
    update public.payments set status = 'estornado' where booking_id = b.id and status = 'retido';
    perform public.booking_log(b.id, 'cancelado', role, note);
    return 'cancelado';
  end if;

  if p_action = 'recusar' then
    if role not in ('profissional', 'equipe') or b.status <> 'solicitado' or b.provider_id is null then raise exception 'invalid_status'; end if;
    update public.bookings set provider_id = null where id = b.id;
    perform public.booking_log(b.id, 'recusado', role, note);
    return 'solicitado';
  end if;

  if p_action = 'pago' then
    if role not in ('profissional', 'equipe') or b.status <> 'concluido' then raise exception 'invalid_status'; end if;
    update public.payments set status = 'pago', paid_at = now(), recorded_by = uid where booking_id = b.id and status in ('pendente', 'retido');
    perform public.booking_log(b.id, 'pago', role, note);
    return 'pago';
  end if;

  if role = 'cliente' then raise exception 'not_allowed'; end if;
  next_status := case b.status when 'solicitado' then 'confirmado' when 'confirmado' then 'a_caminho'
                               when 'a_caminho' then 'em_andamento' when 'em_andamento' then 'concluido' end;
  if next_status is null or p_action <> next_status then raise exception 'invalid_status'; end if;
  if b.provider_id is null then raise exception 'no_provider'; end if;
  if next_status = 'concluido' then
    pct := coalesce((select (value->>'percent')::numeric from public.app_settings where key = 'comissao'), 12);
    update public.bookings set status = 'concluido', completed_at = now(), commission_pct = pct,
           commission_cents = round(b.total_cents * pct / 100) where id = b.id;
  else
    update public.bookings set status = next_status,
           confirmed_at = case when next_status = 'confirmado' then now() else confirmed_at end
     where id = b.id;
  end if;
  perform public.booking_log(b.id, next_status, role, note);
  return next_status;
end $$;

-- Equipe atribui ou troca o profissional (qualquer um publicado que faça o serviço).
create or replace function public.admin_assign_booking(p_booking uuid, p_provider uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.status in ('concluido', 'cancelado') then raise exception 'invalid_status'; end if;
  if p_provider is not null and not exists (
    select 1 from public.provider_profiles p join public.provider_services ps on ps.provider_id = p.id and ps.service_id = b.service_id
     where p.id = p_provider and p.status = 'published') then raise exception 'invalid_provider'; end if;
  update public.bookings set provider_id = p_provider,
         status = 'solicitado',
         confirmed_at = null
   where id = b.id;
  perform public.booking_log(b.id, 'profissional_trocado', 'equipe', null);
  insert into public.moderation_log (actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'pedido_atribuir', 'booking', b.id::text, coalesce(p_provider::text, 'sem profissional'));
end $$;

-- Contato do outro lado, só depois da confirmação (o telefone fica mascarado antes disso).
create or replace function public.booking_contacts(p_booking uuid)
returns table (provider_whatsapp text, provider_name text, provider_slug text, client_phone text, address_line text)
language sql stable security definer set search_path = '' as $$
  select case when b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido') and (b.client_id = auth.uid() or public.is_admin()) then pp.whatsapp end,
         p.display_name, p.slug,
         case when b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido') or public.is_admin() then bp.contact_phone end,
         case when b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido') or b.client_id = auth.uid() or public.is_admin() then bp.address_line end
    from public.bookings b
    left join public.provider_profiles p on p.id = b.provider_id
    left join public.provider_private pp on pp.provider_id = b.provider_id
    left join public.booking_private bp on bp.booking_id = b.id
   where b.id = p_booking and (b.client_id = auth.uid() or b.provider_id = auth.uid() or public.is_admin())
$$;

-- Cliente avalia o serviço concluído (1 a 5 estrelas e comentário opcional).
create or replace function public.review_booking(p_booking uuid, p_rating integer, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; c text := nullif(trim(coalesce(p_comment, '')), '');
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.client_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if b.status <> 'concluido' or b.provider_id is null then raise exception 'invalid_status'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if c is not null and char_length(c) > 500 then raise exception 'invalid_comment'; end if;
  if exists (select 1 from public.booking_reviews where booking_id = p_booking) then raise exception 'already_reviewed'; end if;
  insert into public.booking_reviews (booking_id, provider_id, client_id, rating, comment) values (p_booking, b.provider_id, b.client_id, p_rating, c);
  perform public.booking_log(p_booking, 'avaliado', 'cliente', p_rating || ' de 5');
end $$;

revoke all on public.bookings, public.booking_private, public.booking_items, public.booking_events, public.payments from anon;
revoke all on public.booking_reviews from anon;
revoke insert, update, delete on public.booking_reviews from authenticated;
revoke execute on function public.review_booking(uuid, integer, text) from public, anon;
grant execute on function public.review_booking(uuid, integer, text) to authenticated;
revoke insert, update, delete on public.bookings, public.booking_private, public.booking_items, public.booking_events, public.payments from authenticated;
revoke execute on function public.booking_log(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_booking(integer, integer, integer[], date, text, integer, text, text, text, text) from public, anon;
grant execute on function public.create_booking(integer, integer, integer[], date, text, integer, text, text, text, text) to authenticated;
revoke execute on function public.booking_candidates(uuid) from public, anon;
grant execute on function public.booking_candidates(uuid) to authenticated, service_role;
revoke execute on function public.choose_booking_provider(uuid, uuid) from public, anon;
grant execute on function public.choose_booking_provider(uuid, uuid) to authenticated;
revoke execute on function public.booking_action(uuid, text, text, text) from public, anon;
grant execute on function public.booking_action(uuid, text, text, text) to authenticated;
revoke execute on function public.admin_assign_booking(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_booking(uuid, uuid) to authenticated;
revoke execute on function public.booking_contacts(uuid) from public, anon;
grant execute on function public.booking_contacts(uuid) to authenticated;
grant execute on function public.package_bookable(integer) to anon, authenticated;
grant execute on function public.package_today(integer) to anon, authenticated;
grant execute on function public.slot_open(date, text) to anon, authenticated;
grant execute on function public.cg_now() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo inicial (valores de referência, editáveis no admin)
-- ---------------------------------------------------------------------------
insert into public.service_packages (service_id, slug, name, description, includes, excludes, duration_min, price_cents, price_from, featured, sort)
select s.id, v.slug, v.name, v.description, v.includes, v.excludes, v.duration_min, v.price_cents, v.price_from, v.featured, v.sort
  from (values
    ('eletricista', 'trocar-chuveiro', 'Trocar chuveiro', 'Troca do chuveiro elétrico por um novo que você já comprou.',
      array['Retirada do chuveiro antigo', 'Instalação e teste do novo', 'Vedação da conexão de água'],
      array['Chuveiro novo', 'Troca de fiação ou disjuntor', 'Quebra de parede'], 60, 9000, false, true, 10),
    ('eletricista', 'instalar-tomada-interruptor', 'Instalar tomada ou interruptor', 'Instalação ou troca de uma tomada ou interruptor em ponto que já existe.',
      array['Instalação de 1 tomada ou interruptor', 'Teste do ponto'],
      array['Material (tomada, espelho)', 'Puxar fiação nova', 'Abrir parede'], 40, 6000, false, false, 20),
    ('eletricista', 'instalar-ventilador-de-teto', 'Instalar ventilador de teto', 'Montagem e instalação de ventilador de teto em ponto com fiação pronta.',
      array['Montagem do ventilador', 'Fixação no teto', 'Ligação e teste'],
      array['Ventilador', 'Suporte especial para forro de gesso', 'Fiação nova'], 90, 15000, false, true, 30),
    ('encanador', 'desentupir-pia', 'Desentupir pia', 'Desentupimento de pia de cozinha ou banheiro.',
      array['Desentupimento do sifão e do cano', 'Teste de escoamento'],
      array['Troca de cano quebrado', 'Caixa de gordura', 'Esgoto da rua'], 60, 12000, false, true, 10),
    ('encanador', 'trocar-torneira', 'Trocar torneira', 'Troca de torneira de pia ou tanque por uma nova que você já comprou.',
      array['Retirada da torneira antiga', 'Instalação e vedação da nova'],
      array['Torneira nova', 'Troca de registro'], 40, 7000, false, true, 20),
    ('encanador', 'consertar-vazamento-simples', 'Consertar vazamento simples', 'Conserto de vazamento aparente em torneira, sifão, flexível ou registro.',
      array['Localização do vazamento aparente', 'Troca de vedação, flexível ou reparo simples'],
      array['Vazamento dentro da parede ou do piso', 'Peças maiores'], 60, 10000, true, false, 30),
    ('diarista', 'diaria-4-horas', 'Diária de 4 horas', 'Limpeza da casa por 4 horas, com as tarefas que você combinar.',
      array['Limpeza de cômodos, banheiro e cozinha', 'Tirar pó e passar pano'],
      array['Produtos de limpeza (pode incluir como adicional)', 'Limpeza pós-obra', 'Passar roupa'], 240, 12000, false, true, 10),
    ('diarista', 'diaria-8-horas', 'Diária de 8 horas', 'Limpeza completa da casa por 8 horas.',
      array['Limpeza completa de cômodos, banheiros e cozinha', 'Organização leve'],
      array['Produtos de limpeza (pode incluir como adicional)', 'Limpeza pós-obra'], 480, 20000, false, false, 20),
    ('diarista', 'faxina-pos-obra', 'Faxina pós-obra', 'Limpeza pesada depois de obra ou reforma. O valor final depende do tamanho do imóvel.',
      array['Retirada de pó de obra', 'Limpeza de pisos, janelas e banheiros'],
      array['Retirada de entulho', 'Produtos especiais para remover cimento'], 480, 30000, true, false, 30),
    ('montador-de-moveis', 'montar-guarda-roupa', 'Montar guarda-roupa', 'Montagem de guarda-roupa novo. O valor final depende do número de portas.',
      array['Montagem completa', 'Regulagem de portas e gavetas'],
      array['Desmontagem de móvel antigo', 'Fixação na parede com furação em azulejo'], 180, 15000, true, false, 10),
    ('montador-de-moveis', 'montar-cama-ou-comoda', 'Montar cama ou cômoda', 'Montagem de uma cama ou uma cômoda nova.',
      array['Montagem completa', 'Conferência das peças'],
      array['Desmontagem de móvel antigo'], 90, 9000, false, false, 20),
    ('chaveiro', 'abertura-de-porta', 'Abertura de porta', 'Abertura de porta residencial trancada, sem danificar a fechadura sempre que possível.',
      array['Ida até o endereço', 'Abertura da porta'],
      array['Troca de fechadura', 'Cópia de chave', 'Portas de carro e cofres'], 40, 10000, false, true, 10),
    ('chaveiro', 'copia-de-chave', 'Cópia de chave', 'Cópia de chave comum, feita no local.',
      array['1 cópia de chave comum'],
      array['Chave tetra, codificada ou de carro'], 20, 1500, false, false, 20)
  ) as v(service_slug, slug, name, description, includes, excludes, duration_min, price_cents, price_from, featured, sort)
  join public.services s on s.slug = v.service_slug
on conflict (slug) do nothing;

insert into public.package_addons (package_id, name, price_cents, sort)
select k.id, v.name, v.price_cents, v.sort
  from (values
    ('diaria-4-horas', 'Levar produtos de limpeza', 3000, 10),
    ('diaria-8-horas', 'Levar produtos de limpeza', 4000, 10),
    ('trocar-chuveiro', 'Trocar a resistência do chuveiro antigo também', 2000, 10),
    ('montar-guarda-roupa', 'Fixar o móvel na parede', 3000, 10)
  ) as v(package_slug, name, price_cents, sort)
  join public.service_packages k on k.slug = v.package_slug
 where not exists (select 1 from public.package_addons a where a.package_id = k.id and a.name = v.name);


-- ===== 20261126000300_trabalho.sql =====
-- Próximo · fase 2: Trabalho e Oferecer trabalho (migração aditiva)
-- Não apaga registros. Acrescenta:
--   1. vagas com área, faixa salarial e horário;
--   2. verificação de quem contrata (CNPJ ou CPF e endereço): a primeira vaga fica guardada até a equipe conferir;
--   3. currículo dentro do app (dados, experiências, formação, habilidades, referências e foto opcional);
--   4. candidatura com o currículo do app, telefone só se o candidato aceitar mostrar e novos status;
--   5. convite para entrevista (aparece na agenda das duas pessoas);
--   6. pacotes que cada profissional faz (os outros não chegam para ele).

-- 1. Vagas ---------------------------------------------------------------------------------------
alter table public.jobs
  add column area text check (area is null or area in (
    'administrativo', 'atendimento-vendas', 'cozinha-alimentacao', 'limpeza-conservacao', 'construcao-manutencao',
    'logistica-transporte', 'saude-cuidados', 'educacao', 'tecnologia', 'beleza', 'outros')),
  add column salary_min integer check (salary_min is null or salary_min between 1 and 1000000),
  add column salary_max integer check (salary_max is null or salary_max between 1 and 1000000),
  add column schedule_text text check (schedule_text is null or char_length(schedule_text) <= 80),
  add column held boolean not null default false,
  add constraint jobs_salary_range check (salary_min is null or salary_max is null or salary_min <= salary_max);
create index jobs_area_idx on public.jobs (area) where status = 'aberta';

grant insert (area, salary_min, salary_max, schedule_text), update (area, salary_min, salary_max, schedule_text)
  on public.jobs to authenticated;

insert into public.app_settings (key, value) values ('vagas_exigem_verificacao', '{"enabled": true}') on conflict (key) do nothing;

-- 2. Verificação de quem contrata ------------------------------------------------------------------
create table public.employer_verifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cnpj', 'cpf')),
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  cpf_ciphertext text,
  cpf_last2 text check (cpf_last2 is null or cpf_last2 ~ '^[0-9]{2}$'),
  legal_name text not null check (char_length(legal_name) between 2 and 120),
  address_line text not null check (char_length(address_line) between 5 and 200),
  neighborhood_id integer references public.neighborhoods (id),
  status text not null default 'pendente' check (status in ('pendente', 'verificado', 'recusado')),
  note text check (note is null or char_length(note) <= 500),
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'cnpj' and cnpj is not null) or (kind = 'cpf' and cpf_ciphertext is not null and cpf_last2 is not null))
);
alter table public.employer_verifications enable row level security;
create policy "dono ou equipe" on public.employer_verifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.employer_verifications from anon;
revoke insert, update, delete on public.employer_verifications from authenticated;

create or replace function public.employer_verified(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employer_verifications v where v.user_id = p_user and v.status = 'verificado')
$$;

-- Campo calculado: /jobs?select=*,poster_verified
create or replace function public.poster_verified(j public.jobs)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.employer_verified(j.poster_id)
$$;

-- A vaga de quem ainda não foi conferido fica guardada (a regra pode ser desligada em app_settings).
create or replace function public.jobs_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
declare on_ boolean;
begin
  select coalesce((value->>'enabled')::boolean, true) into on_ from public.app_settings where key = 'vagas_exigem_verificacao';
  new.held := coalesce(on_, true) and not public.employer_verified(new.poster_id)
              and not exists (select 1 from public.user_roles r where r.user_id = new.poster_id and r.role = 'admin');
  return new;
end $$;
create trigger jobs_hold before insert on public.jobs for each row execute function public.jobs_hold();

drop policy "vagas abertas publicas" on public.jobs;
create policy "vagas abertas publicas" on public.jobs for select to anon, authenticated
  using (status = 'aberta' and expires_at > now() and not held);

create or replace function public.can_browse_talent()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j where j.poster_id = auth.uid() and j.status = 'aberta' and j.expires_at > now() and not j.held)
$$;

-- Envio (o servidor valida o documento e cifra o CPF antes de chamar).
create or replace function public.submit_employer_verification(
  p_kind text, p_cnpj text, p_cpf_ciphertext text, p_cpf_last2 text, p_legal_name text, p_address text, p_neighborhood integer)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cur public.employer_verifications;
begin
  if uid is null then raise exception 'login_required'; end if;
  select * into cur from public.employer_verifications where user_id = uid;
  if cur.status = 'verificado' then raise exception 'already_verified'; end if;
  if p_kind not in ('cnpj', 'cpf') then raise exception 'invalid_kind'; end if;
  insert into public.employer_verifications (user_id, kind, cnpj, cpf_ciphertext, cpf_last2, legal_name, address_line, neighborhood_id, status)
  values (uid, p_kind, case when p_kind = 'cnpj' then p_cnpj end, case when p_kind = 'cpf' then p_cpf_ciphertext end,
          case when p_kind = 'cpf' then p_cpf_last2 end, trim(p_legal_name), trim(p_address), p_neighborhood, 'pendente')
  on conflict (user_id) do update set kind = excluded.kind, cnpj = excluded.cnpj, cpf_ciphertext = excluded.cpf_ciphertext,
    cpf_last2 = excluded.cpf_last2, legal_name = excluded.legal_name, address_line = excluded.address_line,
    neighborhood_id = excluded.neighborhood_id, status = 'pendente', note = null, checked_by = null, checked_at = null, updated_at = now();
end $$;

-- Equipe confere. Ao verificar, as vagas guardadas vão ao ar com 30 dias de prazo a partir de agora.
create or replace function public.admin_review_employer(p_user uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  if p_status not in ('verificado', 'recusado') then raise exception 'invalid_status'; end if;
  update public.employer_verifications set status = p_status, note = nullif(trim(coalesce(p_note, '')), ''),
         checked_by = auth.uid(), checked_at = now(), updated_at = now()
   where user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  if p_status = 'verificado' then
    update public.jobs set held = false, expires_at = greatest(expires_at, now() + interval '30 days')
     where poster_id = p_user and held;
  end if;
  insert into public.moderation_log (actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'contratante_' || p_status, 'employer', p_user::text, p_note);
end $$;

-- 3. Currículo no app ---------------------------------------------------------------------------------
create table public.resumes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 100),
  headline text check (headline is null or char_length(headline) <= 100),
  summary text check (summary is null or char_length(summary) <= 1500),
  email text check (email is null or char_length(email) between 5 and 160),
  phone text check (phone is null or phone ~ '^[0-9]{10,11}$'),
  neighborhood_id integer references public.neighborhoods (id),
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  experiences jsonb not null default '[]' check (jsonb_typeof(experiences) = 'array' and jsonb_array_length(experiences) <= 15),
  education jsonb not null default '[]' check (jsonb_typeof(education) = 'array' and jsonb_array_length(education) <= 10),
  skills text[] not null default '{}' check (cardinality(skills) <= 30),
  references_list jsonb not null default '[]' check (jsonb_typeof(references_list) = 'array' and jsonb_array_length(references_list) <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (photo_path is null or split_part(photo_path, '/', 1) = user_id::text)
);
alter table public.resumes enable row level security;
create policy "dono le" on public.resumes for select to authenticated using (user_id = auth.uid());
create policy "dono cria" on public.resumes for insert to authenticated with check (user_id = auth.uid());
create policy "dono edita" on public.resumes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono apaga" on public.resumes for delete to authenticated using (user_id = auth.uid());
revoke all on public.resumes from anon;
create trigger resumes_touch before update on public.resumes for each row execute function public.touch_updated_at();

-- Foto do currículo no mesmo bucket privado (pasta do usuário).
update storage.buckets set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] where id = 'curriculos';

-- 4. Candidatura com o currículo do app ------------------------------------------------------------
alter table public.job_applications
  alter column resume_path drop not null,
  alter column resume_filename drop not null,
  alter column resume_size drop not null,
  add column resume_snapshot jsonb,
  add column share_phone boolean not null default false,
  add constraint job_applications_resume_present check (resume_path is not null or resume_snapshot is not null);
alter table public.job_applications drop constraint job_applications_status_check;
alter table public.job_applications add constraint job_applications_status_check
  check (status in ('recebida', 'vista', 'em_contato', 'entrevista', 'aprovada', 'nao_selecionada'));

-- Vaga guardada (aguardando a conferência de quem publicou) não recebe candidaturas.
create or replace function public.job_applications_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if tg_op = 'INSERT' then
    select * into j from public.jobs where id = new.job_id;
    if not found or j.status <> 'aberta' or j.expires_at <= now() or j.held then
      raise exception 'Esta vaga não está mais recebendo currículos' using errcode = '23514';
    end if;
    if j.poster_id = new.applicant_id then
      raise exception 'Você não pode se candidatar à própria vaga' using errcode = '23514';
    end if;
    if new.resume_path is not null and split_part(new.resume_path, '/', 1) <> new.applicant_id::text then
      raise exception 'Arquivo de currículo inválido' using errcode = '42501';
    end if;
    if (select count(*) from public.job_applications where applicant_id = new.applicant_id and created_at > now() - interval '1 day') >= 20 then
      raise exception 'Limite diário de candidaturas atingido' using errcode = '54000';
    end if;
    new.status := 'recebida';
    new.status_at := now();
  elsif new.status is distinct from old.status then
    new.status_at := now();
  end if;
  return new;
end $$;

-- Candidata-se com o currículo do app: copia o currículo (sem telefone, a menos que a pessoa aceite mostrar).
create or replace function public.apply_with_resume(p_job uuid, p_message text default null, p_share_phone boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.resumes; aid uuid; em text;
begin
  if uid is null then raise exception 'login_required'; end if;
  select * into r from public.resumes where user_id = uid;
  if r.user_id is null then raise exception 'resume_missing'; end if;
  if coalesce(r.headline, '') = '' then raise exception 'resume_incomplete'; end if;
  if exists (select 1 from public.job_applications where job_id = p_job and applicant_id = uid) then raise exception 'already_applied'; end if;
  if char_length(coalesce(p_message, '')) > 1500 then raise exception 'invalid_message'; end if;
  em := coalesce(r.email, (select u.email from auth.users u where u.id = uid));
  insert into public.job_applications (job_id, applicant_id, full_name, email, phone, message, consent_at, resume_snapshot, share_phone)
  values (p_job, uid, r.full_name, em, case when p_share_phone then r.phone end, nullif(trim(coalesce(p_message, '')), ''), now(),
          jsonb_build_object('full_name', r.full_name, 'headline', r.headline, 'summary', r.summary,
            'neighborhood', (select n.name from public.neighborhoods n where n.id = r.neighborhood_id),
            'photo_path', r.photo_path, 'experiences', r.experiences, 'education', r.education,
            'skills', to_jsonb(r.skills), 'references', r.references_list, 'updated_at', r.updated_at),
          coalesce(p_share_phone, false))
  returning id into aid;
  return aid;
end $$;

create or replace function public.set_application_status(p_application uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('recebida', 'vista', 'em_contato', 'entrevista', 'aprovada', 'nao_selecionada') then
    raise exception 'Estado inválido' using errcode = '23514';
  end if;
  update public.job_applications a set status = p_status
    from public.jobs j
   where a.id = p_application and j.id = a.job_id and j.poster_id = auth.uid();
  if not found then raise exception 'Candidatura não encontrada' using errcode = 'P0002'; end if;
  return p_status;
end $$;

-- Quem publicou abriu o currículo: "Enviado" passa a "Visualizado".
create or replace function public.mark_application_seen(p_application uuid)
returns void language sql security definer set search_path = '' as $$
  update public.job_applications a set status = 'vista'
    from public.jobs j
   where a.id = p_application and j.id = a.job_id and j.poster_id = auth.uid() and a.status = 'recebida'
$$;

-- 5. Entrevistas ------------------------------------------------------------------------------------
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  employer_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  mode text not null check (mode in ('presencial', 'video')),
  place text check (place is null or char_length(place) between 5 and 200),
  video_url text check (video_url is null or (video_url ~ '^https://' and char_length(video_url) <= 300)),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'proposta' check (status in ('proposta', 'confirmada', 'recusada', 'cancelada')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((mode = 'presencial' and place is not null) or (mode = 'video' and video_url is not null))
);
create index interviews_employer_idx on public.interviews (employer_id, starts_at);
create index interviews_candidate_idx on public.interviews (candidate_id, starts_at);
alter table public.interviews enable row level security;
create policy "participantes ou equipe" on public.interviews for select to authenticated
  using (employer_id = auth.uid() or candidate_id = auth.uid() or public.is_admin());
revoke all on public.interviews from anon;
revoke insert, update, delete on public.interviews from authenticated;

create or replace function public.invite_interview(
  p_application uuid, p_starts_at timestamptz, p_mode text, p_place text, p_video_url text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.job_applications; j public.jobs; iid uuid;
begin
  select * into a from public.job_applications where id = p_application for update;
  if a.id is null then raise exception 'not_found'; end if;
  select * into j from public.jobs where id = a.job_id;
  if j.poster_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if a.status = 'nao_selecionada' then raise exception 'invalid_status'; end if;
  if p_starts_at is null or p_starts_at < now() + interval '1 hour' or p_starts_at > now() + interval '60 days' then raise exception 'invalid_time'; end if;
  if p_mode not in ('presencial', 'video') then raise exception 'invalid_mode'; end if;
  if p_mode = 'presencial' and char_length(trim(coalesce(p_place, ''))) < 5 then raise exception 'invalid_place'; end if;
  if p_mode = 'video' and coalesce(p_video_url, '') !~ '^https://' then raise exception 'invalid_video'; end if;
  update public.interviews set status = 'cancelada', cancel_reason = 'Remarcada', updated_at = now()
   where application_id = a.id and status in ('proposta', 'confirmada');
  insert into public.interviews (application_id, job_id, employer_id, candidate_id, starts_at, mode, place, video_url, note)
  values (a.id, j.id, j.poster_id, a.applicant_id, p_starts_at, p_mode,
          case when p_mode = 'presencial' then trim(p_place) end, case when p_mode = 'video' then p_video_url end,
          nullif(trim(coalesce(p_note, '')), ''))
  returning id into iid;
  update public.job_applications set status = 'entrevista' where id = a.id;
  return iid;
end $$;

create or replace function public.respond_interview(p_interview uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare i public.interviews; st text := case when p_accept then 'confirmada' else 'recusada' end;
begin
  select * into i from public.interviews where id = p_interview for update;
  if i.id is null or i.candidate_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if i.status <> 'proposta' then raise exception 'invalid_status'; end if;
  update public.interviews set status = st, responded_at = now(), updated_at = now() where id = i.id;
  return st;
end $$;

create or replace function public.cancel_interview(p_interview uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.interviews;
begin
  select * into i from public.interviews where id = p_interview for update;
  if i.id is null or (i.employer_id is distinct from auth.uid() and i.candidate_id is distinct from auth.uid()) then raise exception 'not_allowed'; end if;
  if i.status not in ('proposta', 'confirmada') then raise exception 'invalid_status'; end if;
  update public.interviews set status = 'cancelada', cancel_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now() where id = i.id;
end $$;

-- 6. Pacotes que o profissional NÃO faz (por padrão, faz todos os pacotes dos serviços que oferece) -------
create table public.provider_packages_off (
  provider_id uuid not null references public.provider_profiles (id) on delete cascade,
  package_id integer not null references public.service_packages (id) on delete cascade,
  primary key (provider_id, package_id)
);
alter table public.provider_packages_off enable row level security;
create policy "dono ou equipe" on public.provider_packages_off for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());
revoke all on public.provider_packages_off from anon;
revoke insert, update, delete on public.provider_packages_off from authenticated;

create or replace function public.set_my_packages(p_off integer[])
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.provider_profiles where id = uid) then raise exception 'not_allowed'; end if;
  delete from public.provider_packages_off where provider_id = uid;
  insert into public.provider_packages_off (provider_id, package_id)
  select uid, k.id from public.service_packages k
   where k.id = any (coalesce(p_off, '{}'))
     and exists (select 1 from public.provider_services ps where ps.provider_id = uid and ps.service_id = k.service_id);
end $$;

create or replace function public.booking_candidates(p_booking uuid)
returns table (provider_id uuid, slug text, display_name text, photo_path text, available_today boolean,
               completed integer, show_rate integer, identity_checked boolean, refs_confirmed integer, near boolean,
               rating numeric, reviews integer)
language sql stable security definer set search_path = '' as $$
  with b as (select * from public.bookings where id = p_booking
               and (client_id = auth.uid() or public.is_admin() or auth.role() = 'service_role')),
  base as (
    select p.id, p.slug, p.display_name, p.photo_path,
           exists (select 1 from public.availability_today a
                    where a.provider_id = p.id and a.expires_at > now() and b.service_id = any (a.service_ids)
                      and (a.whole_city or b.neighborhood_id = any (a.neighborhood_ids))) as today,
           exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = b.neighborhood_id) as near,
           (select count(*)::int from public.bookings x where x.provider_id = p.id and x.status = 'concluido') as done,
           (select count(*)::int from public.bookings x where x.provider_id = p.id and x.cancel_kind = 'nao_compareceu') as noshow,
           coalesce((select v.identity_checked_at is not null from public.provider_verification v where v.provider_id = p.id), false) as idok,
           (select count(*)::int from public.provider_references r where r.provider_id = p.id and r.result = 'confirmada') as refs,
           (select round(avg(rv.rating), 1) from public.booking_reviews rv where rv.provider_id = p.id) as stars,
           (select count(*)::int from public.booking_reviews rv where rv.provider_id = p.id) as nrev,
           b.scheduled_date = public.cg_now()::date as for_today
      from b
      join public.provider_profiles p on p.city_id = b.city_id and p.status = 'published'
      join public.provider_private pp on pp.provider_id = p.id and pp.whatsapp is not null
     where public.provider_cleared(p.id)
       and public.provider_coverage(p.id) <> 'pendente'
       and exists (select 1 from public.provider_services ps where ps.provider_id = p.id and ps.service_id = b.service_id)
       and public.provider_service_public(p.id, b.service_id)
       and (p.serves_whole_city or exists (select 1 from public.provider_areas pa where pa.provider_id = p.id and pa.neighborhood_id = b.neighborhood_id))
       and not exists (select 1 from public.provider_packages_off o
                        join public.booking_items bi on bi.package_id = o.package_id and bi.booking_id = b.id
                       where o.provider_id = p.id)
       and not exists (select 1 from public.bookings o where o.provider_id = p.id and o.id <> b.id
                        and o.scheduled_date = b.scheduled_date and o.time_slot = b.time_slot
                        and o.status in ('confirmado', 'a_caminho', 'em_andamento'))
  )
  select id, slug, display_name, photo_path, today and for_today, done,
         case when done + noshow = 0 then null else round(100.0 * done / (done + noshow))::int end,
         idok, refs, near, stars, nrev
    from base
   where not for_today or today
   order by (today and for_today) desc, coalesce(stars, 4.5) desc, coalesce(case when done + noshow = 0 then null else 100.0 * done / (done + noshow) end, 90) desc,
            done desc, idok desc, refs desc, near desc, display_name
   limit 3
$$;

-- Permissões ---------------------------------------------------------------------------------------
revoke execute on function public.jobs_hold() from public, anon, authenticated;
grant execute on function public.employer_verified(uuid) to anon, authenticated;
grant execute on function public.poster_verified(public.jobs) to anon, authenticated;
revoke execute on function public.submit_employer_verification(text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.submit_employer_verification(text, text, text, text, text, text, integer) to authenticated;
revoke execute on function public.admin_review_employer(uuid, text, text) from public, anon;
grant execute on function public.admin_review_employer(uuid, text, text) to authenticated;
revoke execute on function public.apply_with_resume(uuid, text, boolean) from public, anon;
grant execute on function public.apply_with_resume(uuid, text, boolean) to authenticated;
revoke execute on function public.mark_application_seen(uuid) from public, anon;
grant execute on function public.mark_application_seen(uuid) to authenticated;
revoke execute on function public.invite_interview(uuid, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.invite_interview(uuid, timestamptz, text, text, text, text) to authenticated;
revoke execute on function public.respond_interview(uuid, boolean) from public, anon;
grant execute on function public.respond_interview(uuid, boolean) to authenticated;
revoke execute on function public.cancel_interview(uuid, text) from public, anon;
grant execute on function public.cancel_interview(uuid, text) to authenticated;
revoke execute on function public.set_my_packages(integer[]) from public, anon;
grant execute on function public.set_my_packages(integer[]) to authenticated;

commit;

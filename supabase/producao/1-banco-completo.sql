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

commit;

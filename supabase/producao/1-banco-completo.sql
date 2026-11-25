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

commit;

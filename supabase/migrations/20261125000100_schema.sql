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

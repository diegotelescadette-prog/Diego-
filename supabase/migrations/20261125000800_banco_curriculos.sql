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

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

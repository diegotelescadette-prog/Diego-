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

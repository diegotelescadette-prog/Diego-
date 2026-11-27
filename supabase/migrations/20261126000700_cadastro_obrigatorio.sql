-- Próximo · v3 item 3: cadastro obrigatório (migração aditiva, não apaga dados).
--   1. Dados do cadastro: nome completo, celular com WhatsApp, bairro e os aceites (Termos e Aviso de Privacidade).
--      Ficam numa tabela só da própria pessoa (e da equipe). O celular nunca é público.
--   2. Cadastro feito no formulário: o servidor do app grava os dados logo depois de criar a conta,
--      mesmo antes da confirmação do e-mail. Contas antigas completam o cadastro com complete_signup().
--   3. Visitante sem conta deixa de ler o conteúdo do app (feed, perfis, vagas, Momentos, busca, "Preciso para hoje").
--      Continuam abertos só o catálogo, cidades e bairros, usados no cadastro e na página de entrada.

-- ---------------------------------------------------------------------------
-- 1. Dados do cadastro
-- ---------------------------------------------------------------------------
create table public.member_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 5 and 100),
  phone text not null check (phone ~ '^[1-9][0-9]{9,10}$'),
  neighborhood_id integer not null references public.neighborhoods (id),
  terms_accepted_at timestamptz not null,
  privacy_accepted_at timestamptz not null,
  -- Fase 7: confirmação do celular por código no WhatsApp.
  phone_verified_at timestamptz,
  first_goal text check (first_goal in ('servico', 'prestar', 'emprego', 'vaga', 'comercio', 'comunidade')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index member_accounts_neighborhood_idx on public.member_accounts (neighborhood_id);
alter table public.member_accounts enable row level security;
create policy "propria ou equipe" on public.member_accounts for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "propria atualiza" on public.member_accounts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.member_accounts from anon, authenticated;
grant select, update (full_name, phone, neighborhood_id, first_goal) on public.member_accounts to authenticated;
create trigger member_accounts_touch before update on public.member_accounts for each row execute function public.touch_updated_at();
create trigger member_accounts_offense before insert or update of full_name on public.member_accounts for each row execute function public.reject_offense('full_name');

-- Grava (ou completa) o cadastro. Usada pelo servidor do app logo após criar a conta e por complete_signup().
create or replace function public.save_signup(p_user uuid, p_full_name text, p_public_name text, p_phone text,
                                              p_neighborhood integer, p_terms boolean, p_goal text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_phone ~ '^55[1-9][0-9]{9,10}$' then v_phone := substr(v_phone, 3); end if;
  if char_length(trim(coalesce(p_full_name, ''))) not between 5 and 100 then
    raise exception 'Informe o nome completo.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_public_name, ''))) not between 2 and 60 then
    raise exception 'Informe como você quer aparecer no app.' using errcode = '22023';
  end if;
  if v_phone !~ '^[1-9][0-9]{9,10}$' then
    raise exception 'Informe o celular com DDD.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.neighborhoods n where n.id = p_neighborhood and n.active) then
    raise exception 'Escolha o seu bairro.' using errcode = '22023';
  end if;
  if p_terms is not true then
    raise exception 'É preciso aceitar os Termos e o Aviso de Privacidade.' using errcode = '22023';
  end if;
  insert into public.member_accounts (user_id, full_name, phone, neighborhood_id, terms_accepted_at, privacy_accepted_at, first_goal)
  values (p_user, trim(p_full_name), v_phone, p_neighborhood, now(), now(), nullif(p_goal, ''))
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone,
    neighborhood_id = excluded.neighborhood_id, terms_accepted_at = excluded.terms_accepted_at,
    privacy_accepted_at = excluded.privacy_accepted_at;
  insert into public.member_names (user_id, name) values (p_user, trim(p_public_name))
  on conflict (user_id) do update set name = excluded.name, updated_at = now();
end $$;
revoke execute on function public.save_signup(uuid, text, text, text, integer, boolean, text) from public, anon, authenticated;
-- O servidor do app grava o cadastro logo depois de criar a conta (antes da confirmação do e-mail).
grant execute on function public.save_signup(uuid, text, text, text, integer, boolean, text) to service_role;
grant execute on function public.text_offense(text) to service_role;

-- Conta antiga (ou cadastro incompleto): a própria pessoa completa.
create or replace function public.complete_signup(p_full_name text, p_public_name text, p_phone text, p_neighborhood integer, p_terms boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  perform public.save_signup(auth.uid(), p_full_name, p_public_name, p_phone, p_neighborhood, p_terms, null);
end $$;
revoke execute on function public.complete_signup(text, text, text, integer, boolean) from public, anon;
grant execute on function public.complete_signup(text, text, text, integer, boolean) to authenticated;

-- "O que você quer fazer primeiro?" (opcional; só define o primeiro destino).
create or replace function public.set_first_goal(p_goal text) returns void
language sql security definer set search_path = '' as $$
  update public.member_accounts set first_goal = p_goal where user_id = auth.uid()
$$;
revoke execute on function public.set_first_goal(text) from public, anon;
grant execute on function public.set_first_goal(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Visitante sem conta não lê o conteúdo do app
-- ---------------------------------------------------------------------------
revoke all on public.posts, public.post_media, public.post_comments, public.post_reactions, public.post_saves,
  public.provider_follows, public.stories, public.story_views, public.jobs, public.provider_profiles,
  public.provider_services, public.provider_areas, public.provider_work_photos, public.availability_today,
  public.favorites, public.reports, public.service_suggestions, public.moderation_log, public.user_roles
  from anon;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('feed_posts', 'search_providers', 'urgent_search', 'stories_feed', 'follower_count',
                         'public_name', 'author_name', 'post_proof', 'provider_public_channel', 'provider_badges',
                         'poster_verified', 'employer_verified')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

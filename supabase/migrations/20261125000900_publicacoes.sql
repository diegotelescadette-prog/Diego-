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

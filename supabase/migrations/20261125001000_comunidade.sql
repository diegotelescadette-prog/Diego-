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
      if old.author_id <> auth.uid() or old.status = 'removido' then
        raise exception 'Comentário não encontrado' using errcode = '42501';
      end if;
      new.post_id := old.post_id; new.author_id := old.author_id; new.author_name := old.author_name;
      new.status := old.status; new.created_at := old.created_at; new.parent_id := old.parent_id;
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

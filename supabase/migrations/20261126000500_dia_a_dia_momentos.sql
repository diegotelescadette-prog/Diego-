-- Próximo · Fase 3 (parte 2): posts do dia a dia e Momentos de 24 horas.
-- Migração aditiva: nada existente é apagado.
--   1. Novo tipo de publicação "dia_a_dia": qualquer conta com nome público conta do seu dia (texto, fotos ou vídeo).
--   2. Momentos: foto ou vídeo curto que some do app em 24 horas, com "visto", denúncia e remoção pela moderação.

-- ---------------------------------------------------------------------------
-- 1. Dia a dia
-- ---------------------------------------------------------------------------
alter table public.posts drop constraint posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in ('trabalho', 'divulgacao', 'pedido', 'dia_a_dia'));

-- Mesmas regras da migração 001000, com o ramo do dia a dia.
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
  elsif new.kind = 'dia_a_dia' then
    if public.public_name(new.author_id) is null then
      raise exception 'Informe seu nome público para publicar' using errcode = '23514';
    end if;
    -- Texto ou mídia: o texto vazio é aceito aqui e a mídia é conferida no app (fotos entram depois do post).
    new.service_id := null; new.category_id := null; new.price_label := null; new.found := false;
    if tg_op = 'INSERT' then new.city_id := coalesce(new.city_id, public.pilot_city_id()); end if;
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

drop policy "publicadas, proprias ou admin" on public.posts;
create policy "publicadas, proprias ou admin" on public.posts for select to anon, authenticated
  using ((status = 'publicado' and (kind in ('pedido', 'dia_a_dia') or public.provider_in_community(author_id)))
         or author_id = auth.uid() or public.is_admin());

-- Feed: o dia a dia entra como os pedidos (qualquer membro); se o autor é prestador na comunidade, mostra o perfil dele.
drop function public.feed_posts(text, uuid, uuid, timestamptz, integer, text, text, integer, boolean, uuid, boolean);
create or replace function public.feed_posts(
  p_city_slug text default null, p_author uuid default null, p_post uuid default null,
  p_before timestamptz default null, p_limit integer default 20,
  p_kind text default null, p_category text default null, p_neighborhood integer default null,
  p_saved boolean default false, p_before_id uuid default null, p_following boolean default false
)
returns table (
  id uuid, kind text, body text, created_at timestamptz, edited_at timestamptz,
  author_id uuid, is_provider boolean, slug text, display_name text, photo_path text,
  service_name text, service_slug text, category_name text, category_slug text, neighborhood_name text,
  area_label text, price_label text, found boolean, available_today boolean, media jsonb,
  reactions bigint, comments bigint, reacted boolean, saved boolean, last_comment jsonb,
  my_reaction text, reaction_counts jsonb, proof jsonb
)
language sql stable set search_path = '' as $$
  select po.id, po.kind, po.body, po.created_at, po.edited_at,
         po.author_id, x.pro, case when x.pro then pr.slug end,
         public.public_name(po.author_id), case when x.pro then pr.photo_path end,
         s.name, s.slug, sc.name, sc.slug, nb.name,
         case when po.kind in ('trabalho', 'divulgacao') then public.provider_area_label(pr.id)
              when po.kind = 'dia_a_dia' then coalesce(nb.name || ', ' || ci.name, ci.name)
              else coalesce(nb.name || ', ' || ci.name, ci.name || ' (cidade toda)') end,
         po.price_label, po.found,
         po.kind in ('trabalho', 'divulgacao') and po.service_id is not null and coalesce(public.urgent_match_area(pr.id, po.service_id, pr.city_id, p_neighborhood), false),
         coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'path', m.path, 'label', m.label) order by m.sort, m.id)
                     from public.post_media m where m.post_id = po.id), '[]'::jsonb),
         (select count(*) from public.post_reactions r where r.post_id = po.id),
         (select count(*) from public.post_comments c where c.post_id = po.id and c.status = 'visivel'),
         exists (select 1 from public.post_reactions r where r.post_id = po.id and r.user_id = auth.uid()),
         exists (select 1 from public.post_saves sv where sv.post_id = po.id and sv.user_id = auth.uid()),
         (select jsonb_build_object('name', c.author_name, 'body', c.body)
            from public.post_comments c where c.post_id = po.id and c.status = 'visivel'
           order by c.created_at desc limit 1),
         (select r.reaction from public.post_reactions r where r.post_id = po.id and r.user_id = auth.uid()),
         coalesce((select jsonb_object_agg(y.reaction, y.n) from (
                     select r.reaction, count(*) as n from public.post_reactions r where r.post_id = po.id group by r.reaction) y), '{}'::jsonb),
         case when po.booking_id is not null then public.post_proof(po.booking_id) end
    from public.posts po
    left join public.provider_profiles pr on pr.id = po.author_id
    cross join lateral (select po.kind in ('trabalho', 'divulgacao')
                               or (po.kind = 'dia_a_dia' and public.provider_in_community(po.author_id)) as pro) x
    left join public.services s on s.id = po.service_id
    left join public.service_categories sc on sc.id = po.category_id
    left join public.neighborhoods nb on nb.id = po.neighborhood_id
    left join public.cities ci on ci.id = po.city_id
   where po.status = 'publicado'
     and (po.kind in ('pedido', 'dia_a_dia') or (pr.status = 'published' and public.provider_coverage(pr.id) <> 'pendente'))
     and (p_city_slug is null or po.city_id is null or po.city_id = (select c.id from public.cities c where c.slug = p_city_slug)
          or (po.kind in ('trabalho', 'divulgacao') and pr.serves_online))
     and (p_author is null or po.author_id = p_author)
     and (p_post is null or po.id = p_post)
     and (p_kind is null or po.kind = p_kind)
     and (p_category is null or sc.slug = p_category)
     and (p_neighborhood is null or (
           case when po.kind in ('pedido', 'dia_a_dia') then po.neighborhood_id is null or po.neighborhood_id = p_neighborhood
                else pr.serves_whole_city or exists (select 1 from public.provider_areas pa where pa.provider_id = pr.id and pa.neighborhood_id = p_neighborhood)
           end))
     and (not coalesce(p_saved, false) or exists (select 1 from public.post_saves sv where sv.post_id = po.id and sv.user_id = auth.uid()))
     and (not coalesce(p_following, false) or exists (select 1 from public.provider_follows f where f.provider_id = po.author_id and f.follower_id = auth.uid()))
     and (p_before is null
          or (p_before_id is null and po.created_at < p_before)
          or (p_before_id is not null and (po.created_at, po.id) < (p_before, p_before_id)))
   order by po.created_at desc, po.id desc
   limit least(coalesce(p_limit, 20), 50)
$$;

-- ---------------------------------------------------------------------------
-- 2. Momentos (24 horas)
--    Arquivos no bucket privado post-media, na pasta da própria conta; o servidor gera links assinados.
-- ---------------------------------------------------------------------------
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('foto', 'video')),
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  caption text not null default '' check (char_length(caption) <= 200),
  status text not null default 'publicado' check (status in ('publicado', 'removido')),
  removed_note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index stories_live_idx on public.stories(expires_at desc) where status = 'publicado';
create index stories_author_idx on public.stories(author_id, created_at desc);

create table public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create table public.story_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references auth.users(id) on delete set null,
  story_id uuid not null references public.stories(id) on delete cascade,
  reason text not null check (reason in ('golpe_ou_cobranca', 'conteudo_improprio', 'ofensa_ou_assedio', 'spam', 'outro')),
  status text not null default 'aberta' check (status in ('aberta', 'procedente', 'improcedente')),
  created_at timestamptz not null default now(),
  unique (reporter_id, story_id)
);

create or replace function public.stories_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Momento não pode ser alterado' using errcode = '42501';
    end if;
    return new;
  end if;
  if auth.uid() is not null and new.author_id <> auth.uid() then
    raise exception 'Publique só com a sua conta' using errcode = '42501';
  end if;
  if public.public_name(new.author_id) is null then
    raise exception 'Informe seu nome público para publicar' using errcode = '23514';
  end if;
  if split_part(new.path, '/', 1) <> new.author_id::text then
    raise exception 'Arquivo fora da sua pasta' using errcode = '42501';
  end if;
  if auth.uid() is not null and (select count(*) from public.stories where author_id = new.author_id and created_at > now() - interval '1 day') >= 15 then
    raise exception 'Limite de 15 momentos por dia' using errcode = '54000';
  end if;
  new.caption := trim(new.caption); new.status := 'publicado'; new.removed_note := null;
  new.created_at := now(); new.expires_at := now() + interval '24 hours';
  return new;
end $$;
create trigger stories_check before insert or update on public.stories for each row execute function public.stories_check();

create or replace function public.story_reports_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.story_reports where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Limite diário de denúncias atingido' using errcode = '54000';
  end if;
  new.status := 'aberta'; new.created_at := now();
  return new;
end $$;
create trigger story_reports_check before insert on public.story_reports for each row execute function public.story_reports_check();

alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.story_reports enable row level security;

create policy "no ar, proprios ou admin" on public.stories for select to anon, authenticated
  using ((status = 'publicado' and expires_at > now()) or author_id = auth.uid() or public.is_admin());
create policy "publica com a propria conta" on public.stories for insert to authenticated with check (author_id = auth.uid());
create policy "apaga o proprio momento" on public.stories for delete to authenticated using (author_id = auth.uid());

-- Quem viu: cada pessoa marca e lê só o próprio; o autor vê quem viu os seus momentos.
create policy "marca visto" on public.story_views for insert to authenticated
  with check (viewer_id = auth.uid() and exists (select 1 from public.stories s where s.id = story_id and s.status = 'publicado' and s.expires_at > now()));
create policy "proprio visto ou do autor" on public.story_views for select to authenticated
  using (viewer_id = auth.uid() or exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid()));

create policy "denuncia logado" on public.story_reports for insert to authenticated
  with check (reporter_id = auth.uid() and exists (select 1 from public.stories s where s.id = story_id));
create policy "admin ou quem denunciou" on public.story_reports for select to authenticated using (public.is_admin() or reporter_id = auth.uid());

revoke all on public.stories, public.story_views, public.story_reports from anon, authenticated;
grant select on public.stories to anon, authenticated;
grant insert (author_id, kind, path, caption), delete on public.stories to authenticated;
grant select, insert (story_id, viewer_id) on public.story_views to authenticated;
grant select on public.story_views to anon; -- a faixa consulta "visto?"; sem política para anon, não retorna linhas
grant select, insert (reporter_id, story_id, reason) on public.story_reports to authenticated;

-- Faixa de Momentos: uma linha por autor com momentos no ar (os próprios primeiro, depois os não vistos, depois os mais novos).
create or replace function public.stories_feed()
returns table (author_id uuid, name text, slug text, photo_path text, is_mine boolean, all_seen boolean, latest timestamptz, items jsonb)
language sql stable set search_path = '' as $$
  select s.author_id, public.public_name(s.author_id),
         case when public.provider_in_community(s.author_id) then max(pr.slug) end,
         case when public.provider_in_community(s.author_id) then max(pr.photo_path) end,
         s.author_id = auth.uid(),
         bool_and(s.author_id = auth.uid() or exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = auth.uid())),
         max(s.created_at),
         jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'path', s.path, 'caption', s.caption, 'created_at', s.created_at,
                     'seen', exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = auth.uid()))
                   order by s.created_at)
    from public.stories s
    left join public.provider_profiles pr on pr.id = s.author_id
   where s.status = 'publicado' and s.expires_at > now()
   group by s.author_id
   order by (s.author_id = auth.uid()) desc,
            bool_and(s.author_id = auth.uid() or exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = auth.uid())) asc,
            max(s.created_at) desc
   limit 60
$$;

create or replace function public.admin_remove_story(p_story uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Informe o motivo' using errcode = '23514'; end if;
  update public.stories set status = 'removido', removed_note = p_note where id = p_story;
  if not found then raise exception 'Momento não encontrado' using errcode = 'P0002'; end if;
  update public.story_reports set status = 'procedente' where story_id = p_story and status = 'aberta';
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'remover_momento', 'story', p_story::text, p_note);
end $$;
revoke execute on function public.admin_remove_story(uuid, text) from public, anon;

create or replace function public.admin_resolve_story_report(p_report bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores' using errcode = '42501'; end if;
  update public.story_reports set status = 'improcedente' where id = p_report and status = 'aberta';
  insert into public.moderation_log(actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'avaliar_denuncia_momento', 'story_report', p_report::text, 'improcedente');
end $$;
revoke execute on function public.admin_resolve_story_report(bigint) from public, anon;

-- Nome público do autor como campo calculado (administração: select=...,author_name).
create or replace function public.author_name(s public.stories)
returns text language sql stable set search_path = '' as $$ select public.public_name(s.author_id) $$;
grant execute on function public.author_name(public.stories) to authenticated;

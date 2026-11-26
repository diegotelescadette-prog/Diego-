-- Próximo · fase 3 (complemento): filtro de ofensas e notificações (migração aditiva, não apaga dados).
--   1. Palavras bloqueadas: post, comentário, legenda de Momento e nome público com palavra da lista não são salvos
--      ("Quer reescrever com mais carinho?"). A equipe edita a lista na administração.
--   2. Notificações: reação, comentário, resposta e novo seguidor, com o sino no topo.

-- ---------------------------------------------------------------------------
-- 1. Palavras bloqueadas
-- ---------------------------------------------------------------------------
create table public.blocked_words (
  word text primary key check (word ~ '^[a-z0-9 ]{2,40}$'),
  created_at timestamptz not null default now()
);
alter table public.blocked_words enable row level security;
create policy "equipe le" on public.blocked_words for select to authenticated using (public.is_admin());
create policy "equipe cria" on public.blocked_words for insert to authenticated with check (public.is_admin());
create policy "equipe apaga" on public.blocked_words for delete to authenticated using (public.is_admin());
revoke all on public.blocked_words from anon, authenticated;
grant select, insert (word), delete on public.blocked_words to authenticated;
insert into public.blocked_words (word) values
  ('porra'), ('caralho'), ('merda'), ('puta'), ('puto'), ('fdp'), ('vagabunda'), ('vagabundo'), ('arrombado'), ('arrombada'),
  ('desgracado'), ('desgracada'), ('otario'), ('otaria'), ('imbecil'), ('idiota'), ('babaca'), ('cuzao'), ('viado'),
  ('piranha'), ('vadia'), ('corno'), ('buceta'), ('pau no cu'), ('filho da puta'), ('vai se foder'), ('foda se')
on conflict do nothing;

-- Texto sem acento, em minúsculas e com espaços simples, para comparar com a lista.
create or replace function public.plain_text(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '\s+', ' ', 'g')
$$;

-- Primeira palavra bloqueada encontrada (palavra inteira) ou null.
create or replace function public.text_offense(t text) returns text
language sql stable security definer set search_path = '' as $$
  select w.word from public.blocked_words w
   where public.plain_text(t) ~ ('(^|[^a-z0-9])' || w.word || '([^a-z0-9]|$)')
   limit 1
$$;
revoke execute on function public.text_offense(text) from public, anon;
grant execute on function public.text_offense(text) to authenticated;

create or replace function public.reject_offense() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A coluna a conferir vem como argumento do gatilho.
  if public.text_offense(to_jsonb(new) ->> tg_argv[0]) is not null then
    raise exception 'Quer reescrever com mais carinho? O texto tem palavras que não usamos aqui.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger posts_offense before insert or update of body on public.posts for each row execute function public.reject_offense('body');
create trigger post_comments_offense before insert or update of body on public.post_comments for each row execute function public.reject_offense('body');
create trigger member_names_offense before insert or update of name on public.member_names for each row execute function public.reject_offense('name');
create trigger stories_offense before insert or update of caption on public.stories for each row execute function public.reject_offense('caption');

-- ---------------------------------------------------------------------------
-- 2. Notificações
-- ---------------------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('reacao', 'comentario', 'resposta', 'seguiu')),
  actor_id uuid references auth.users (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id bigint references public.post_comments (id) on delete cascade,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "proprias" on public.notifications for select to authenticated using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- Cria o aviso (nunca para a própria pessoa). Reação repetida no mesmo post não gera outro aviso não lido.
create or replace function public.notify(p_user uuid, p_kind text, p_actor uuid, p_post uuid, p_comment bigint, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_kind = 'reacao' and exists (select 1 from public.notifications n where n.user_id = p_user and n.kind = 'reacao'
       and n.actor_id = p_actor and n.post_id = p_post and n.read_at is null) then return; end if;
  insert into public.notifications (user_id, kind, actor_id, post_id, comment_id, data)
  values (p_user, p_kind, p_actor, p_post, p_comment, coalesce(p_data, '{}'));
end $$;
revoke execute on function public.notify(uuid, text, uuid, uuid, bigint, jsonb) from public, anon, authenticated;

create or replace function public.notify_reaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify((select author_id from public.posts where id = new.post_id), 'reacao', new.user_id, new.post_id, null,
                        jsonb_build_object('reacao', new.reaction));
  return new;
end $$;
create trigger post_reactions_notify after insert on public.post_reactions for each row execute function public.notify_reaction();

create or replace function public.notify_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid; parent_author uuid;
begin
  select author_id into post_author from public.posts where id = new.post_id;
  if new.parent_id is not null then
    select author_id into parent_author from public.post_comments where id = new.parent_id;
    perform public.notify(parent_author, 'resposta', new.author_id, new.post_id, new.id, '{}');
  end if;
  if parent_author is distinct from post_author then
    perform public.notify(post_author, 'comentario', new.author_id, new.post_id, new.id, '{}');
  end if;
  return new;
end $$;
create trigger post_comments_notify after insert on public.post_comments for each row execute function public.notify_comment();

create or replace function public.notify_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify(new.provider_id, 'seguiu', new.follower_id, null, null, '{}');
  return new;
end $$;
create trigger provider_follows_notify after insert on public.provider_follows for each row execute function public.notify_follow();

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null
$$;
revoke execute on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;

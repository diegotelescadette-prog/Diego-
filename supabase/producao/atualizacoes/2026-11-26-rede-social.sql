-- Atualização do banco que JÁ está em produção: Próximo, fase 3 (parte 1: rede social).
-- Cole no SQL Editor do Supabase e clique em Run (uma vez só). Não apaga dados: publicações, "Útil" e pedidos continuam.
-- Acrescenta: reações Valeu, Inspirou, Tô junto e Indico (o "Útil" de antes vira Valeu); selo "Feito pelo Próximo"
-- em trabalhos ligados a um pedido concluído; seguir prestadores e o filtro "Quem eu sigo".
begin;
-- Próximo · Fase 3 (parte 1): rede social de confiança.
-- Migração aditiva: nada existente é apagado.
--   1. Reações com tipo: Valeu, Inspirou, Tô junto e Indico (o "Útil" que já existia vira "Valeu").
--   2. "Feito pelo Próximo": publicação de trabalho ligada a um pedido concluído pelo app.
--   3. Seguir prestadores e filtro "Quem eu sigo" no feed.

-- ---------------------------------------------------------------------------
-- 1. Reações com tipo (uma por pessoa por publicação; trocar o tipo é um update)
-- ---------------------------------------------------------------------------
alter table public.post_reactions
  add column reaction text not null default 'valeu' check (reaction in ('valeu', 'inspirou', 'to_junto', 'indico'));

create policy "troca a propria reacao" on public.post_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert on public.post_reactions from authenticated;
grant insert (post_id, user_id, reaction), update (reaction) on public.post_reactions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Feito pelo Próximo": o trabalho mostrado no feed foi um pedido concluído pelo app
-- ---------------------------------------------------------------------------
alter table public.posts add column booking_id uuid unique references public.bookings(id) on delete set null;

-- Dispara antes de posts_check (ordem alfabética): confere o pedido e usa o serviço dele.
create or replace function public.posts_booking_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if tg_op = 'UPDATE' then
    -- Depois de publicado, o vínculo com o pedido não muda (só some se o pedido for apagado).
    if auth.uid() is not null and not public.is_admin() and new.booking_id is distinct from old.booking_id then
      new.booking_id := old.booking_id;
    end if;
    return new;
  end if;
  if new.booking_id is null then return new; end if;
  if new.kind <> 'trabalho' then
    raise exception 'Só trabalhos podem ser ligados a um pedido' using errcode = '23514';
  end if;
  select bk.provider_id, bk.status, bk.service_id into b from public.bookings bk where bk.id = new.booking_id;
  if not found or b.provider_id is distinct from new.author_id or b.status <> 'concluido' then
    raise exception 'Escolha um pedido concluído por você' using errcode = '23514';
  end if;
  new.service_id := b.service_id;
  return new;
end $$;
create trigger posts_booking_check before insert or update on public.posts for each row execute function public.posts_booking_check();

grant insert (booking_id) on public.posts to authenticated;

-- Prova pública do trabalho: data de conclusão e a nota que o cliente deu (sem nome nem comentário do cliente).
create or replace function public.post_proof(p_booking uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('done_at', bk.completed_at, 'rating', r.rating)
    from public.bookings bk
    left join public.booking_reviews r on r.booking_id = bk.id
   where bk.id = p_booking and bk.status = 'concluido'
$$;
revoke execute on function public.post_proof(uuid) from public;
grant execute on function public.post_proof(uuid) to anon, authenticated;

-- Pedidos concluídos do prestador que ainda não viraram publicação (para o formulário "Mostrar um trabalho").
create or replace function public.my_bookings_to_show()
returns table (id uuid, service_id integer, service_name text, neighborhood_name text, completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select bk.id, bk.service_id, s.name, n.name, bk.completed_at
    from public.bookings bk
    join public.services s on s.id = bk.service_id
    join public.neighborhoods n on n.id = bk.neighborhood_id
   where bk.provider_id = auth.uid() and bk.status = 'concluido'
     and not exists (select 1 from public.posts p where p.booking_id = bk.id)
   order by bk.completed_at desc nulls last
   limit 30
$$;
revoke execute on function public.my_bookings_to_show() from public, anon;
grant execute on function public.my_bookings_to_show() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Seguir prestadores
-- ---------------------------------------------------------------------------
create table public.provider_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, provider_id),
  check (follower_id <> provider_id)
);
create index provider_follows_provider_idx on public.provider_follows(provider_id);

create or replace function public.provider_follows_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.provider_in_community(new.provider_id) then
    raise exception 'Perfil não encontrado' using errcode = 'P0002';
  end if;
  if auth.uid() is not null and (select count(*) from public.provider_follows
        where follower_id = new.follower_id and created_at > now() - interval '1 day') >= 200 then
    raise exception 'Limite diário de perfis seguidos atingido' using errcode = '54000';
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger provider_follows_check before insert on public.provider_follows for each row execute function public.provider_follows_check();

alter table public.provider_follows enable row level security;
-- Cada pessoa vê só quem ela segue; o total de seguidores sai pela função abaixo.
create policy "quem eu sigo" on public.provider_follows for select to authenticated using (follower_id = auth.uid());
create policy "sigo com a minha conta" on public.provider_follows for insert to authenticated with check (follower_id = auth.uid());
create policy "deixo de seguir" on public.provider_follows for delete to authenticated using (follower_id = auth.uid());
revoke all on public.provider_follows from anon, authenticated;
grant select, insert (follower_id, provider_id), delete on public.provider_follows to authenticated;
grant select on public.provider_follows to anon; -- o feed consulta "sigo?"; sem política para anon, não retorna linhas

create or replace function public.follower_count(p_provider uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.provider_follows where provider_id = p_provider
$$;
grant execute on function public.follower_count(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Feed: tipo da reação, contagem por tipo, prova do pedido e filtro "Quem eu sigo"
-- ---------------------------------------------------------------------------
drop function public.feed_posts(text, uuid, uuid, timestamptz, integer, text, text, integer, boolean, uuid);
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
           order by c.created_at desc limit 1),
         (select r.reaction from public.post_reactions r where r.post_id = po.id and r.user_id = auth.uid()),
         coalesce((select jsonb_object_agg(x.reaction, x.n) from (
                     select r.reaction, count(*) as n from public.post_reactions r where r.post_id = po.id group by r.reaction) x), '{}'::jsonb),
         case when po.booking_id is not null then public.post_proof(po.booking_id) end
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
     and (not coalesce(p_following, false) or exists (select 1 from public.provider_follows f where f.provider_id = po.author_id and f.follower_id = auth.uid()))
     and (p_before is null
          or (p_before_id is null and po.created_at < p_before)
          or (p_before_id is not null and (po.created_at, po.id) < (p_before, p_before_id)))
   order by po.created_at desc, po.id desc
   limit least(coalesce(p_limit, 20), 50)
$$;

notify pgrst, 'reload schema';
commit;

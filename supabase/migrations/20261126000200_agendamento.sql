-- Fase 1 do modelo "serviço com preço fixo": pacotes padronizados, agendamento, escolha do profissional,
-- acompanhamento por status e registro do pagamento na entrega. Tudo aditivo: nada existente é apagado.

-- ---------------------------------------------------------------------------
-- Pacotes (serviço padronizado com preço) e adicionais
-- ---------------------------------------------------------------------------
create table public.service_packages (
  id integer generated always as identity primary key,
  service_id integer not null references public.services(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  name text not null check (char_length(trim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 400),
  includes text[] not null default '{}' check (cardinality(includes) <= 10),
  excludes text[] not null default '{}' check (cardinality(excludes) <= 10),
  duration_min integer not null check (duration_min between 10 and 720),
  price_cents integer not null check (price_cents between 100 and 10000000),
  price_from boolean not null default false,
  featured boolean not null default false,
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_packages_service_idx on public.service_packages(service_id);
create trigger service_packages_touch before update on public.service_packages for each row execute function public.touch_updated_at();
create trigger log_packages after insert or update or delete on public.service_packages for each row execute function public.log_catalog_change();

create table public.package_addons (
  id integer generated always as identity primary key,
  package_id integer not null references public.service_packages(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 80),
  price_cents integer not null check (price_cents between 0 and 10000000),
  active boolean not null default true,
  sort integer not null default 100
);
create index package_addons_package_idx on public.package_addons(package_id);

alter table public.service_packages enable row level security;
alter table public.package_addons enable row level security;
create policy "leitura publica" on public.service_packages for select to anon, authenticated using (active or public.is_admin());
create policy "admin escreve" on public.service_packages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leitura publica" on public.package_addons for select to anon, authenticated using (active or public.is_admin());
create policy "admin escreve" on public.package_addons for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Pacote que pode ser agendado agora: ele, o serviço e a categoria ativos.
create or replace function public.package_bookable(p_package integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.service_packages k
                   join public.services s on s.id = k.service_id
                   join public.service_categories c on c.id = s.category_id
                  where k.id = p_package and k.active and s.active and c.active)
$$;

-- ---------------------------------------------------------------------------
-- Pedidos (agendamentos)
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  client_id uuid not null references auth.users(id) on delete cascade,
  city_id smallint not null references public.cities(id),
  neighborhood_id integer not null references public.neighborhoods(id),
  service_id integer not null references public.services(id),
  scheduled_date date not null,
  time_slot text not null check (time_slot in ('manha', 'tarde', 'noite')),
  notes text check (char_length(notes) <= 600),
  status text not null default 'solicitado'
    check (status in ('solicitado', 'confirmado', 'a_caminho', 'em_andamento', 'concluido', 'cancelado')),
  provider_id uuid references public.provider_profiles(id) on delete set null,
  total_cents integer not null check (total_cents >= 0),
  price_from boolean not null default false,
  payment_method text not null check (payment_method in ('pix_na_entrega', 'dinheiro_na_entrega')),
  commission_pct numeric(5, 2),
  commission_cents integer,
  cancel_kind text check (cancel_kind in ('cliente', 'profissional', 'nao_compareceu', 'equipe')),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  confirmed_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_client_idx on public.bookings(client_id, created_at desc);
create index bookings_provider_idx on public.bookings(provider_id, scheduled_date);
create index bookings_date_idx on public.bookings(scheduled_date, status);
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();

-- Endereço e telefone do cliente: o profissional só vê depois de confirmar o pedido.
create table public.booking_private (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  address_line text not null check (char_length(trim(address_line)) between 5 and 200),
  contact_phone text not null check (contact_phone ~ '^[0-9]{10,11}$')
);

create table public.booking_items (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  package_id integer references public.service_packages(id) on delete set null,
  name text not null,
  qty integer not null check (qty between 1 and 10),
  unit_cents integer not null,
  addons jsonb not null default '[]',
  subtotal_cents integer not null
);
create index booking_items_booking_idx on public.booking_items(booking_id);

create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status text not null,
  actor_role text not null check (actor_role in ('cliente', 'profissional', 'equipe', 'sistema')),
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events(booking_id, created_at);

-- Pagamento: na fase 1 só "na entrega" (Pix ou dinheiro), registrado por quem recebeu.
-- `gateway` e `gateway_ref` ficam prontos para o "Pix garantido" (valor retido até o cliente confirmar).
create table public.payments (
  id bigint generated always as identity primary key,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  method text not null check (method in ('pix_na_entrega', 'dinheiro_na_entrega', 'pix_garantido')),
  gateway text not null default 'na_entrega',
  gateway_ref text,
  status text not null default 'pendente' check (status in ('pendente', 'retido', 'pago', 'estornado')),
  amount_cents integer not null,
  paid_at timestamptz,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.bookings enable row level security;
alter table public.booking_private enable row level security;
alter table public.booking_items enable row level security;
alter table public.booking_events enable row level security;
alter table public.payments enable row level security;

create or replace function public.booking_visible(p_booking uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b
                  where b.id = p_booking and (b.client_id = auth.uid() or b.provider_id = auth.uid() or public.is_admin()))
$$;

create policy "cliente, profissional ou equipe" on public.bookings for select to authenticated
  using (client_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
create policy "cliente, profissional confirmado ou equipe" on public.booking_private for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                  and (b.client_id = auth.uid() or public.is_admin()
                       or (b.provider_id = auth.uid() and b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido')))));
create policy "quem ve o pedido" on public.booking_items for select to authenticated using (public.booking_visible(booking_id));
create policy "quem ve o pedido" on public.booking_events for select to authenticated using (public.booking_visible(booking_id));
create policy "quem ve o pedido" on public.payments for select to authenticated using (public.booking_visible(booking_id));

-- Avaliação do cliente depois do serviço concluído (uma por pedido). Entra na nota usada para sugerir profissionais.
create table public.booking_reviews (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.provider_profiles (id) on delete cascade,
  client_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index booking_reviews_provider_idx on public.booking_reviews (provider_id);
alter table public.booking_reviews enable row level security;
create policy "quem ve o pedido" on public.booking_reviews for select to authenticated using (public.booking_visible(booking_id));
-- Nenhuma política de escrita: tudo passa pelas funções abaixo.

insert into public.app_settings (key, value) values
  ('comissao', '{"percent": 12}'),
  ('prazo_aceite', '{"minutes": 10}')
on conflict (key) do nothing;

-- Data de hoje e hora em Campo Grande.
create or replace function public.cg_now()
returns timestamp language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Campo_Grande')
$$;

-- Faixa ainda dá para hoje: até 1 hora antes do fim (manhã 8h–12h, tarde 12h–18h, noite 18h–21h).
create or replace function public.slot_open(p_date date, p_slot text)
returns boolean language sql stable set search_path = '' as $$
  select case
           when p_date > public.cg_now()::date then p_date <= public.cg_now()::date + 14
           when p_date < public.cg_now()::date then false
           else public.cg_now()::time < case p_slot when 'manha' then time '11:00' when 'tarde' then time '17:00' else time '20:00' end
         end
$$;

-- Alguém confirmou "Atendo hoje" para o serviço do pacote (para destacar "Hoje").
create or replace function public.package_today(p_package integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.service_packages k
                   join public.availability_today a on k.service_id = any (a.service_ids) and a.expires_at > now()
                   join public.provider_profiles p on p.id = a.provider_id and p.status = 'published'
                  where k.id = p_package and public.provider_cleared(p.id))
$$;

-- Profissionais que podem atender o pedido, já ordenados (os 3 melhores).
-- Sem notas na fase 1, a ordem usa: atende hoje, comparecimento, serviços concluídos, selos e se atende o bairro
-- pela lista de bairros (mais perto) em vez da cidade toda.
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

create or replace function public.booking_log(p_booking uuid, p_status text, p_role text, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.booking_events (booking_id, status, actor_role, actor_id, note)
  values (p_booking, p_status, p_role, auth.uid(), p_note)
$$;

-- Cria o pedido com o preço calculado no banco. Se só houver um profissional possível, ele já é escolhido.
create or replace function public.create_booking(
  p_package integer, p_qty integer, p_addons integer[], p_date date, p_slot text, p_neighborhood integer,
  p_address text, p_phone text, p_notes text, p_payment text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k public.service_packages;
  nb public.neighborhoods;
  addon_rows jsonb;
  addon_sum integer;
  unit integer;
  bid uuid;
  only_one uuid;
  n integer;
  phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if uid is null then raise exception 'login_required'; end if;
  if not public.rate_limit_hit('booking', uid::text, 6, 3600) then raise exception 'rate_limited'; end if;
  select * into k from public.service_packages where id = p_package;
  if k.id is null or not public.package_bookable(k.id) then raise exception 'package_unavailable'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'invalid_qty'; end if;
  if p_slot not in ('manha', 'tarde', 'noite') or p_date is null or not public.slot_open(p_date, p_slot) then raise exception 'invalid_slot'; end if;
  select n2.* into nb from public.neighborhoods n2 join public.cities c on c.id = n2.city_id and c.is_pilot where n2.id = p_neighborhood;
  if nb.id is null then raise exception 'invalid_neighborhood'; end if;
  if char_length(trim(coalesce(p_address, ''))) not between 5 and 200 then raise exception 'invalid_address'; end if;
  if phone !~ '^[0-9]{10,11}$' then raise exception 'invalid_phone'; end if;
  if char_length(coalesce(p_notes, '')) > 600 then raise exception 'invalid_notes'; end if;
  if p_payment not in ('pix_na_entrega', 'dinheiro_na_entrega') then raise exception 'invalid_payment'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price_cents', a.price_cents) order by a.sort, a.id), '[]'),
         coalesce(sum(a.price_cents), 0)::int, count(*)::int
    into addon_rows, addon_sum, n
    from public.package_addons a
   where a.package_id = k.id and a.active and a.id = any (coalesce(p_addons, '{}'));
  if n <> cardinality(array(select distinct x from unnest(coalesce(p_addons, '{}')) x)) then raise exception 'invalid_addons'; end if;
  unit := k.price_cents + addon_sum;

  insert into public.bookings (client_id, city_id, neighborhood_id, service_id, scheduled_date, time_slot, notes,
                               total_cents, price_from, payment_method)
  values (uid, nb.city_id, nb.id, k.service_id, p_date, p_slot, nullif(trim(coalesce(p_notes, '')), ''),
          unit * p_qty, k.price_from, p_payment)
  returning id into bid;
  insert into public.booking_private (booking_id, address_line, contact_phone) values (bid, trim(p_address), phone);
  insert into public.booking_items (booking_id, package_id, name, qty, unit_cents, addons, subtotal_cents)
  values (bid, k.id, k.name, p_qty, unit, addon_rows, unit * p_qty);
  insert into public.payments (booking_id, method, amount_cents) values (bid, p_payment, unit * p_qty);
  perform public.booking_log(bid, 'solicitado', 'cliente');

  select count(*)::int, (array_agg(c.provider_id))[1] into n, only_one from public.booking_candidates(bid) c;
  if n = 1 then
    update public.bookings set provider_id = only_one where id = bid;
    perform public.booking_log(bid, 'profissional_escolhido', 'sistema', 'Único profissional disponível');
  end if;
  return bid;
end $$;

-- Cliente escolhe um dos profissionais sugeridos (enquanto o pedido não foi confirmado).
create or replace function public.choose_booking_provider(p_booking uuid, p_provider uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.client_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if b.status <> 'solicitado' then raise exception 'invalid_status'; end if;
  if not exists (select 1 from public.booking_candidates(p_booking) c where c.provider_id = p_provider) then raise exception 'invalid_provider'; end if;
  update public.bookings set provider_id = p_provider where id = p_booking;
  perform public.booking_log(p_booking, 'profissional_escolhido', 'cliente');
end $$;

-- Mudança de status por quem pode:
--   profissional escolhido: confirmar/recusar (solicitado), a_caminho, em_andamento, concluido, pago;
--   cliente: cancelar enquanto solicitado ou confirmado;
--   equipe: qualquer passo, cancelar (com o tipo) e marcar pago.
create or replace function public.booking_action(p_booking uuid, p_action text, p_note text default null, p_cancel_kind text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  uid uuid := auth.uid();
  role text;
  next_status text;
  pct numeric;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then raise exception 'not_found'; end if;
  role := case when public.is_admin() then 'equipe' when b.provider_id = uid then 'profissional'
               when b.client_id = uid then 'cliente' end;
  if role is null then raise exception 'not_allowed'; end if;
  if char_length(coalesce(note, '')) > 300 then raise exception 'invalid_note'; end if;

  if p_action = 'cancelar' then
    if b.status in ('concluido', 'cancelado') then raise exception 'invalid_status'; end if;
    if role = 'cliente' and b.status not in ('solicitado', 'confirmado') then raise exception 'invalid_status'; end if;
    if role = 'profissional' then raise exception 'not_allowed'; end if;
    update public.bookings set status = 'cancelado', canceled_at = now(),
           cancel_kind = case when role = 'cliente' then 'cliente'
                              when p_cancel_kind in ('profissional', 'nao_compareceu', 'equipe', 'cliente') then p_cancel_kind else 'equipe' end,
           cancel_reason = note
     where id = b.id;
    update public.payments set status = 'estornado' where booking_id = b.id and status = 'retido';
    perform public.booking_log(b.id, 'cancelado', role, note);
    return 'cancelado';
  end if;

  if p_action = 'recusar' then
    if role not in ('profissional', 'equipe') or b.status <> 'solicitado' or b.provider_id is null then raise exception 'invalid_status'; end if;
    update public.bookings set provider_id = null where id = b.id;
    perform public.booking_log(b.id, 'recusado', role, note);
    return 'solicitado';
  end if;

  if p_action = 'pago' then
    if role not in ('profissional', 'equipe') or b.status <> 'concluido' then raise exception 'invalid_status'; end if;
    update public.payments set status = 'pago', paid_at = now(), recorded_by = uid where booking_id = b.id and status in ('pendente', 'retido');
    perform public.booking_log(b.id, 'pago', role, note);
    return 'pago';
  end if;

  if role = 'cliente' then raise exception 'not_allowed'; end if;
  next_status := case b.status when 'solicitado' then 'confirmado' when 'confirmado' then 'a_caminho'
                               when 'a_caminho' then 'em_andamento' when 'em_andamento' then 'concluido' end;
  if next_status is null or p_action <> next_status then raise exception 'invalid_status'; end if;
  if b.provider_id is null then raise exception 'no_provider'; end if;
  if next_status = 'concluido' then
    pct := coalesce((select (value->>'percent')::numeric from public.app_settings where key = 'comissao'), 12);
    update public.bookings set status = 'concluido', completed_at = now(), commission_pct = pct,
           commission_cents = round(b.total_cents * pct / 100) where id = b.id;
  else
    update public.bookings set status = next_status,
           confirmed_at = case when next_status = 'confirmado' then now() else confirmed_at end
     where id = b.id;
  end if;
  perform public.booking_log(b.id, next_status, role, note);
  return next_status;
end $$;

-- Equipe atribui ou troca o profissional (qualquer um publicado que faça o serviço).
create or replace function public.admin_assign_booking(p_booking uuid, p_provider uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.status in ('concluido', 'cancelado') then raise exception 'invalid_status'; end if;
  if p_provider is not null and not exists (
    select 1 from public.provider_profiles p join public.provider_services ps on ps.provider_id = p.id and ps.service_id = b.service_id
     where p.id = p_provider and p.status = 'published') then raise exception 'invalid_provider'; end if;
  update public.bookings set provider_id = p_provider,
         status = 'solicitado',
         confirmed_at = null
   where id = b.id;
  perform public.booking_log(b.id, 'profissional_trocado', 'equipe', null);
  insert into public.moderation_log (actor_id, action, target_type, target_id, note)
  values (auth.uid(), 'pedido_atribuir', 'booking', b.id::text, coalesce(p_provider::text, 'sem profissional'));
end $$;

-- Contato do outro lado, só depois da confirmação (o telefone fica mascarado antes disso).
create or replace function public.booking_contacts(p_booking uuid)
returns table (provider_whatsapp text, provider_name text, provider_slug text, client_phone text, address_line text)
language sql stable security definer set search_path = '' as $$
  select case when b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido') and (b.client_id = auth.uid() or public.is_admin()) then pp.whatsapp end,
         p.display_name, p.slug,
         case when b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido') or public.is_admin() then bp.contact_phone end,
         case when b.status in ('confirmado', 'a_caminho', 'em_andamento', 'concluido') or b.client_id = auth.uid() or public.is_admin() then bp.address_line end
    from public.bookings b
    left join public.provider_profiles p on p.id = b.provider_id
    left join public.provider_private pp on pp.provider_id = b.provider_id
    left join public.booking_private bp on bp.booking_id = b.id
   where b.id = p_booking and (b.client_id = auth.uid() or b.provider_id = auth.uid() or public.is_admin())
$$;

-- Cliente avalia o serviço concluído (1 a 5 estrelas e comentário opcional).
create or replace function public.review_booking(p_booking uuid, p_rating integer, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; c text := nullif(trim(coalesce(p_comment, '')), '');
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.client_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if b.status <> 'concluido' or b.provider_id is null then raise exception 'invalid_status'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if c is not null and char_length(c) > 500 then raise exception 'invalid_comment'; end if;
  if exists (select 1 from public.booking_reviews where booking_id = p_booking) then raise exception 'already_reviewed'; end if;
  insert into public.booking_reviews (booking_id, provider_id, client_id, rating, comment) values (p_booking, b.provider_id, b.client_id, p_rating, c);
  perform public.booking_log(p_booking, 'avaliado', 'cliente', p_rating || ' de 5');
end $$;

revoke all on public.bookings, public.booking_private, public.booking_items, public.booking_events, public.payments from anon;
revoke all on public.booking_reviews from anon;
revoke insert, update, delete on public.booking_reviews from authenticated;
revoke execute on function public.review_booking(uuid, integer, text) from public, anon;
grant execute on function public.review_booking(uuid, integer, text) to authenticated;
revoke insert, update, delete on public.bookings, public.booking_private, public.booking_items, public.booking_events, public.payments from authenticated;
revoke execute on function public.booking_log(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_booking(integer, integer, integer[], date, text, integer, text, text, text, text) from public, anon;
grant execute on function public.create_booking(integer, integer, integer[], date, text, integer, text, text, text, text) to authenticated;
revoke execute on function public.booking_candidates(uuid) from public, anon;
grant execute on function public.booking_candidates(uuid) to authenticated, service_role;
revoke execute on function public.choose_booking_provider(uuid, uuid) from public, anon;
grant execute on function public.choose_booking_provider(uuid, uuid) to authenticated;
revoke execute on function public.booking_action(uuid, text, text, text) from public, anon;
grant execute on function public.booking_action(uuid, text, text, text) to authenticated;
revoke execute on function public.admin_assign_booking(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_booking(uuid, uuid) to authenticated;
revoke execute on function public.booking_contacts(uuid) from public, anon;
grant execute on function public.booking_contacts(uuid) to authenticated;
grant execute on function public.package_bookable(integer) to anon, authenticated;
grant execute on function public.package_today(integer) to anon, authenticated;
grant execute on function public.slot_open(date, text) to anon, authenticated;
grant execute on function public.cg_now() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo inicial (valores de referência, editáveis no admin)
-- ---------------------------------------------------------------------------
insert into public.service_packages (service_id, slug, name, description, includes, excludes, duration_min, price_cents, price_from, featured, sort)
select s.id, v.slug, v.name, v.description, v.includes, v.excludes, v.duration_min, v.price_cents, v.price_from, v.featured, v.sort
  from (values
    ('eletricista', 'trocar-chuveiro', 'Trocar chuveiro', 'Troca do chuveiro elétrico por um novo que você já comprou.',
      array['Retirada do chuveiro antigo', 'Instalação e teste do novo', 'Vedação da conexão de água'],
      array['Chuveiro novo', 'Troca de fiação ou disjuntor', 'Quebra de parede'], 60, 9000, false, true, 10),
    ('eletricista', 'instalar-tomada-interruptor', 'Instalar tomada ou interruptor', 'Instalação ou troca de uma tomada ou interruptor em ponto que já existe.',
      array['Instalação de 1 tomada ou interruptor', 'Teste do ponto'],
      array['Material (tomada, espelho)', 'Puxar fiação nova', 'Abrir parede'], 40, 6000, false, false, 20),
    ('eletricista', 'instalar-ventilador-de-teto', 'Instalar ventilador de teto', 'Montagem e instalação de ventilador de teto em ponto com fiação pronta.',
      array['Montagem do ventilador', 'Fixação no teto', 'Ligação e teste'],
      array['Ventilador', 'Suporte especial para forro de gesso', 'Fiação nova'], 90, 15000, false, true, 30),
    ('encanador', 'desentupir-pia', 'Desentupir pia', 'Desentupimento de pia de cozinha ou banheiro.',
      array['Desentupimento do sifão e do cano', 'Teste de escoamento'],
      array['Troca de cano quebrado', 'Caixa de gordura', 'Esgoto da rua'], 60, 12000, false, true, 10),
    ('encanador', 'trocar-torneira', 'Trocar torneira', 'Troca de torneira de pia ou tanque por uma nova que você já comprou.',
      array['Retirada da torneira antiga', 'Instalação e vedação da nova'],
      array['Torneira nova', 'Troca de registro'], 40, 7000, false, true, 20),
    ('encanador', 'consertar-vazamento-simples', 'Consertar vazamento simples', 'Conserto de vazamento aparente em torneira, sifão, flexível ou registro.',
      array['Localização do vazamento aparente', 'Troca de vedação, flexível ou reparo simples'],
      array['Vazamento dentro da parede ou do piso', 'Peças maiores'], 60, 10000, true, false, 30),
    ('diarista', 'diaria-4-horas', 'Diária de 4 horas', 'Limpeza da casa por 4 horas, com as tarefas que você combinar.',
      array['Limpeza de cômodos, banheiro e cozinha', 'Tirar pó e passar pano'],
      array['Produtos de limpeza (pode incluir como adicional)', 'Limpeza pós-obra', 'Passar roupa'], 240, 12000, false, true, 10),
    ('diarista', 'diaria-8-horas', 'Diária de 8 horas', 'Limpeza completa da casa por 8 horas.',
      array['Limpeza completa de cômodos, banheiros e cozinha', 'Organização leve'],
      array['Produtos de limpeza (pode incluir como adicional)', 'Limpeza pós-obra'], 480, 20000, false, false, 20),
    ('diarista', 'faxina-pos-obra', 'Faxina pós-obra', 'Limpeza pesada depois de obra ou reforma. O valor final depende do tamanho do imóvel.',
      array['Retirada de pó de obra', 'Limpeza de pisos, janelas e banheiros'],
      array['Retirada de entulho', 'Produtos especiais para remover cimento'], 480, 30000, true, false, 30),
    ('montador-de-moveis', 'montar-guarda-roupa', 'Montar guarda-roupa', 'Montagem de guarda-roupa novo. O valor final depende do número de portas.',
      array['Montagem completa', 'Regulagem de portas e gavetas'],
      array['Desmontagem de móvel antigo', 'Fixação na parede com furação em azulejo'], 180, 15000, true, false, 10),
    ('montador-de-moveis', 'montar-cama-ou-comoda', 'Montar cama ou cômoda', 'Montagem de uma cama ou uma cômoda nova.',
      array['Montagem completa', 'Conferência das peças'],
      array['Desmontagem de móvel antigo'], 90, 9000, false, false, 20),
    ('chaveiro', 'abertura-de-porta', 'Abertura de porta', 'Abertura de porta residencial trancada, sem danificar a fechadura sempre que possível.',
      array['Ida até o endereço', 'Abertura da porta'],
      array['Troca de fechadura', 'Cópia de chave', 'Portas de carro e cofres'], 40, 10000, false, true, 10),
    ('chaveiro', 'copia-de-chave', 'Cópia de chave', 'Cópia de chave comum, feita no local.',
      array['1 cópia de chave comum'],
      array['Chave tetra, codificada ou de carro'], 20, 1500, false, false, 20)
  ) as v(service_slug, slug, name, description, includes, excludes, duration_min, price_cents, price_from, featured, sort)
  join public.services s on s.slug = v.service_slug
on conflict (slug) do nothing;

insert into public.package_addons (package_id, name, price_cents, sort)
select k.id, v.name, v.price_cents, v.sort
  from (values
    ('diaria-4-horas', 'Levar produtos de limpeza', 3000, 10),
    ('diaria-8-horas', 'Levar produtos de limpeza', 4000, 10),
    ('trocar-chuveiro', 'Trocar a resistência do chuveiro antigo também', 2000, 10),
    ('montar-guarda-roupa', 'Fixar o móvel na parede', 3000, 10)
  ) as v(package_slug, name, price_cents, sort)
  join public.service_packages k on k.slug = v.package_slug
 where not exists (select 1 from public.package_addons a where a.package_id = k.id and a.name = v.name);

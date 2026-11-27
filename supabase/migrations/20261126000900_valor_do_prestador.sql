-- Próximo · v3: o valor do serviço fica a critério do prestador (migração aditiva, não apaga dados).
--   Pedido de Diego (26/11/2026): tirar os preços fixos de todo o app.
--   1. O pedido nasce sem valor. Os pacotes continuam dizendo o que está incluso, mas o preço deles não é mais usado.
--   2. O profissional do pedido informa o valor (set_booking_quote) e pode corrigir até concluir o serviço.
--   3. Só dá para concluir depois de informado o valor; a comissão é calculada sobre ele.
--   Pedidos antigos mantêm o valor que já tinham.

alter table public.bookings add column if not exists quoted_at timestamptz;

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

  -- Sem preço fixo: os adicionais entram só pelo nome; o valor é o que o profissional informar.
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price_cents', 0) order by a.sort, a.id), '[]'),
         0, count(*)::int
    into addon_rows, addon_sum, n
    from public.package_addons a
   where a.package_id = k.id and a.active and a.id = any (coalesce(p_addons, '{}'));
  if n <> cardinality(array(select distinct x from unnest(coalesce(p_addons, '{}')) x)) then raise exception 'invalid_addons'; end if;
  unit := 0;

  insert into public.bookings (client_id, city_id, neighborhood_id, service_id, scheduled_date, time_slot, notes,
                               total_cents, price_from, payment_method)
  values (uid, nb.city_id, nb.id, k.service_id, p_date, p_slot, nullif(trim(coalesce(p_notes, '')), ''),
          0, false, p_payment)
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


create or replace function public.set_booking_quote(p_booking uuid, p_cents integer)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then raise exception 'not_found'; end if;
  if b.provider_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if b.status not in ('solicitado', 'confirmado', 'a_caminho', 'em_andamento') then raise exception 'invalid_status'; end if;
  if p_cents is null or p_cents < 100 or p_cents > 10000000 then raise exception 'invalid_value'; end if;
  update public.bookings set total_cents = p_cents, price_from = false, quoted_at = now() where id = b.id;
  update public.booking_items set unit_cents = 0, subtotal_cents = 0 where booking_id = b.id;
  update public.payments set amount_cents = p_cents where booking_id = b.id and status = 'pendente';
end $$;
revoke execute on function public.set_booking_quote(uuid, integer) from public, anon;
grant execute on function public.set_booking_quote(uuid, integer) to authenticated;

-- Concluir exige o valor informado (pedidos antigos, com valor do pacote, seguem como estavam).
create or replace function public.booking_requires_quote() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'concluido' and old.status <> 'concluido' and coalesce(new.total_cents, 0) = 0 then
    raise exception 'quote_required' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists bookings_requires_quote on public.bookings;
create trigger bookings_requires_quote before update of status on public.bookings for each row execute function public.booking_requires_quote();

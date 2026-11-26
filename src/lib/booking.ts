import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { photoUrl } from '@/lib/data';
import type { BookingStatus, PaymentMethod, ServicePackage, TimeSlot } from '@/lib/booking-shared';

const PKG_FIELDS = 'id, slug, name, description, includes, excludes, duration_min, price_cents, price_from, featured, active, sort, ' +
  'services!inner(id, name, slug, active, service_categories!inner(id, name, slug, active, sort)), package_addons(id, name, price_cents, active, sort)';

type RawPkg = {
  id: number; slug: string; name: string; description: string; includes: string[]; excludes: string[]; duration_min: number;
  price_cents: number; price_from: boolean; featured: boolean; active: boolean; sort: number;
  services: { id: number; name: string; slug: string; active: boolean; service_categories: { id: number; name: string; slug: string; active: boolean; sort: number } };
  package_addons: { id: number; name: string; price_cents: number; active: boolean; sort: number }[];
};

function toPackage(r: RawPkg): ServicePackage {
  const c = r.services.service_categories;
  return {
    id: r.id, slug: r.slug, name: r.name, description: r.description, includes: r.includes, excludes: r.excludes,
    duration_min: r.duration_min, price_cents: r.price_cents, price_from: r.price_from, featured: r.featured,
    service: { id: r.services.id, name: r.services.name, slug: r.services.slug },
    category: { id: c.id, name: c.name, slug: c.slug },
    addons: (r.package_addons ?? []).filter((a) => a.active).sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map(({ id, name, price_cents }) => ({ id, name, price_cents })),
  };
}

/** Pacotes que podem ser agendados (pacote, serviço e categoria ativos), na ordem do catálogo. */
export const getPackages = cache(async (): Promise<(ServicePackage & { catSort: number; sort: number })[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('service_packages').select(PKG_FIELDS).eq('active', true);
  return ((data ?? []) as unknown as RawPkg[])
    .filter((r) => r.services.active && r.services.service_categories.active)
    .map((r) => ({ ...toPackage(r), catSort: r.services.service_categories.sort, sort: r.sort }))
    .sort((a, b) => a.catSort - b.catSort || a.service.name.localeCompare(b.service.name, 'pt-BR') || a.sort - b.sort);
});

export async function getPackage(slug: string): Promise<ServicePackage | null> {
  return (await getPackages()).find((p) => p.slug === slug) ?? null;
}

/** Categorias que têm pacotes, com a contagem e o menor preço. */
export const getPackageCategories = cache(async () => {
  const map = new Map<string, { id: number; name: string; slug: string; count: number; min: number }>();
  for (const p of await getPackages()) {
    const c = map.get(p.category.slug) ?? { ...p.category, count: 0, min: Infinity };
    c.count++; c.min = Math.min(c.min, p.price_cents);
    map.set(p.category.slug, c);
  }
  return [...map.values()];
});

export async function packageToday(id: number): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('package_today', { p_package: id });
  return !!data;
}

export interface BookingView {
  id: string; code: string; status: BookingStatus; scheduled_date: string; time_slot: TimeSlot; notes: string | null;
  total_cents: number; price_from: boolean; payment_method: PaymentMethod; created_at: string; client_id: string;
  provider_id: string | null; neighborhood: string; city: string; service: string; category_slug: string | null;
  cancel_kind: string | null; cancel_reason: string | null; commission_cents: number | null;
  items: { name: string; qty: number; unit_cents: number; addons: { name: string; price_cents: number }[]; subtotal_cents: number }[];
  events: { status: string; actor_role: string; note: string | null; created_at: string }[];
  payment: { method: string; status: string; amount_cents: number; paid_at: string | null } | null;
  review: { rating: number; comment: string | null; created_at: string } | null;
}

const BOOKING_FIELDS = 'id, code, status, scheduled_date, time_slot, notes, total_cents, price_from, payment_method, created_at, client_id, provider_id, ' +
  'cancel_kind, cancel_reason, commission_cents, neighborhoods(name), cities(name), services(name, service_categories(slug)), ' +
  'booking_items(name, qty, unit_cents, addons, subtotal_cents), booking_events(status, actor_role, note, created_at), payments(method, status, amount_cents, paid_at), booking_reviews(rating, comment, created_at)';

type RawBooking = Omit<BookingView, 'neighborhood' | 'city' | 'service' | 'category_slug' | 'items' | 'events' | 'payment' | 'review'> & {
  booking_reviews: BookingView['review'] | BookingView['review'][];
  neighborhoods: { name: string } | null; cities: { name: string } | null;
  services: { name: string; service_categories: { slug: string } | null } | null;
  booking_items: BookingView['items']; booking_events: BookingView['events'];
  payments: BookingView['payment'] | BookingView['payment'][];
};

function toBooking(r: RawBooking): BookingView {
  const { neighborhoods, cities, services, booking_items, booking_events, payments, booking_reviews, ...rest } = r;
  return {
    ...rest,
    neighborhood: neighborhoods?.name ?? '', city: cities?.name ?? '', service: services?.name ?? '',
    category_slug: services?.service_categories?.slug ?? null,
    items: booking_items ?? [],
    events: [...(booking_events ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    payment: Array.isArray(payments) ? payments[0] ?? null : payments,
    review: Array.isArray(booking_reviews) ? booking_reviews[0] ?? null : booking_reviews ?? null,
  };
}

export async function getBooking(id: string): Promise<BookingView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('bookings').select(BOOKING_FIELDS).eq('id', id).maybeSingle();
  return data ? toBooking(data as unknown as RawBooking) : null;
}

export async function listBookings(filter: { client?: string; provider?: string; status?: string; date?: string; category?: string; neighborhood?: number; limit?: number }) {
  const supabase = await createClient();
  let q = supabase.from('bookings').select(BOOKING_FIELDS).order('scheduled_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(filter.limit ?? 50);
  if (filter.client) q = q.eq('client_id', filter.client);
  if (filter.provider) q = q.eq('provider_id', filter.provider);
  if (filter.status === 'abertos') q = q.in('status', ['solicitado', 'confirmado', 'a_caminho', 'em_andamento']);
  else if (filter.status) q = q.eq('status', filter.status);
  if (filter.date) q = q.eq('scheduled_date', filter.date);
  if (filter.neighborhood) q = q.eq('neighborhood_id', filter.neighborhood);
  const { data } = await q;
  const out = ((data ?? []) as unknown as RawBooking[]).map(toBooking);
  return filter.category ? out.filter((b) => b.category_slug === filter.category) : out;
}

export interface Candidate {
  provider_id: string; slug: string; display_name: string; photo: string | null; available_today: boolean;
  completed: number; show_rate: number | null; identity_checked: boolean; refs_confirmed: number; near: boolean;
  rating: number | null; reviews: number;
}

export async function getCandidates(bookingId: string): Promise<Candidate[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('booking_candidates', { p_booking: bookingId });
  return ((data ?? []) as (Omit<Candidate, 'photo'> & { photo_path: string | null })[])
    .map(({ photo_path, rating, ...c }) => ({ ...c, rating: rating === null ? null : Number(rating), photo: photoUrl(photo_path) }));
}

export async function getContacts(bookingId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('booking_contacts', { p_booking: bookingId });
  return ((data ?? []) as { provider_whatsapp: string | null; provider_name: string | null; provider_slug: string | null; client_phone: string | null; address_line: string | null }[])[0] ?? null;
}

/** Próximos compromissos (pedidos em aberto de hoje em diante), como cliente e como profissional. */
export async function getUpcoming(userId: string, limit = 20) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Campo_Grande' }).format(new Date());
  const supabase = await createClient();
  const { data } = await supabase.from('bookings').select(BOOKING_FIELDS)
    .or(`client_id.eq.${userId},provider_id.eq.${userId}`)
    .in('status', ['solicitado', 'confirmado', 'a_caminho', 'em_andamento'])
    .gte('scheduled_date', today)
    .order('scheduled_date', { ascending: true }).order('created_at', { ascending: true }).limit(limit);
  const order = { manha: 0, tarde: 1, noite: 2 } as const;
  return ((data ?? []) as unknown as RawBooking[]).map(toBooking)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || order[a.time_slot] - order[b.time_slot]);
}

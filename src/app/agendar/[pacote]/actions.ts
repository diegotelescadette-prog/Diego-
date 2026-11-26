'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { bookingError } from '@/lib/booking-shared';

export type BookState = { error?: string } | undefined;

export async function createBooking(_prev: BookState, form: FormData): Promise<BookState> {
  const user = await getUser();
  const slug = String(form.get('package_slug') ?? '');
  if (!user) redirect(`/entrar?motivo=agendar&next=${encodeURIComponent(`/agendar/${slug}`)}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_booking', {
    p_package: Number(form.get('package_id')),
    p_qty: Number(form.get('qty') || 1),
    p_addons: form.getAll('addon').map(Number).filter(Number.isFinite),
    p_date: String(form.get('date') ?? ''),
    p_slot: String(form.get('slot') ?? ''),
    p_neighborhood: Number(form.get('neighborhood') || 0),
    p_address: String(form.get('address') ?? ''),
    p_phone: String(form.get('phone') ?? ''),
    p_notes: String(form.get('notes') ?? ''),
    p_payment: String(form.get('payment') ?? ''),
  });
  if (error || !data) return { error: bookingError(error?.message) };
  redirect(`/pedidos/${data}?novo=1`);
}

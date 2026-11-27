'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { bookingError } from '@/lib/booking-shared';

/** Volta para a página de origem (só caminhos internos de pedidos), com uma mensagem. */
function back(form: FormData, msg: string): never {
  const raw = String(form.get('back') ?? '');
  const target = /^\/(pedidos|painel\/pedidos|admin\/pedidos)(\/[0-9a-f-]{36})?(\?|$)/.test(raw) ? raw.split('?')[0] : '/pedidos';
  revalidatePath(target);
  redirect(`${target}?msg=${encodeURIComponent(msg)}`);
}

const DONE: Record<string, string> = {
  confirmado: 'Pedido confirmado. O endereço e o telefone do cliente já aparecem.',
  a_caminho: 'Status: a caminho.',
  em_andamento: 'Status: em andamento.',
  concluido: 'Serviço concluído.',
  cancelado: 'Pedido cancelado.',
  solicitado: 'Você recusou o pedido. Ele volta para outro profissional.',
  pago: 'Pagamento registrado.',
};

export async function chooseProvider(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('choose_booking_provider', { p_booking: String(form.get('id')), p_provider: String(form.get('provider')) });
  back(form, error ? bookingError(error.message) : 'Profissional escolhido. Agora é só aguardar a confirmação.');
}

export async function bookingAction(form: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('booking_action', {
    p_booking: String(form.get('id')), p_action: String(form.get('action')),
    p_note: String(form.get('note') ?? ''), p_cancel_kind: form.get('cancel_kind') ? String(form.get('cancel_kind')) : null,
  });
  back(form, error ? bookingError(error.message) : DONE[String(data)] ?? 'Pedido atualizado.');
}

/** O profissional informa (ou corrige) o valor que cobra pelo pedido. Aceita "150", "150,00" ou "R$ 1.250,50". */
export async function setBookingQuote(form: FormData) {
  const raw = String(form.get('valor') ?? '').replace(/[^\d,.]/g, '');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const cents = Math.round(Number(normalized) * 100);
  const supabase = await createClient();
  const { error } = Number.isFinite(cents) && cents > 0
    ? await supabase.rpc('set_booking_quote', { p_booking: String(form.get('id')), p_cents: cents })
    : { error: { message: 'invalid_value' } };
  back(form, error ? bookingError(error.message) : 'Valor informado ao cliente.');
}

export async function reviewBooking(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_booking', {
    p_booking: String(form.get('id')), p_rating: Number(form.get('rating') ?? 0), p_comment: String(form.get('comment') ?? ''),
  });
  back(form, error ? bookingError(error.message) : 'Obrigado pela avaliação! Ela ajuda outras pessoas a escolher bem.');
}

export async function assignProvider(form: FormData) {
  const supabase = await createClient();
  const provider = String(form.get('provider') ?? '');
  const { error } = await supabase.rpc('admin_assign_booking', { p_booking: String(form.get('id')), p_provider: provider || null });
  back(form, error ? bookingError(error.message) : provider ? 'Profissional atribuído. Ele precisa confirmar o pedido.' : 'Profissional retirado do pedido.');
}

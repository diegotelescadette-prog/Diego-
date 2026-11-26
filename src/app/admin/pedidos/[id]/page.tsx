import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assignProvider, bookingAction } from '@/app/pedidos/actions';
import { BookingItems, BookingTimeline, EventList } from '@/components/BookingTimeline';
import { Restricted } from '@/components/Restricted';
import { getBooking, getCandidates, getContacts } from '@/lib/booking';
import { dateLabel, SLOT_LABEL, STATUS_STEPS } from '@/lib/booking-shared';
import { getIsAdmin } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Pedido' };
export const dynamic = 'force-dynamic';

/** Detalhe do pedido para a equipe: atribuir ou trocar o profissional, avançar status, cancelar e ver o histórico. */
export default async function AdminPedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  if (!(await getIsAdmin())) return <Restricted what="Pedidos e endereços de clientes" />;
  const { id } = await params;
  const { msg } = await searchParams;
  const b = await getBooking(id);
  if (!b) notFound();
  const supabase = await createClient();
  const [candidates, contacts, { data: others }] = await Promise.all([
    b.status === 'solicitado' ? getCandidates(id) : Promise.resolve([]),
    getContacts(id),
    supabase.from('provider_services').select('provider_profiles!inner(id, display_name, status)').eq('service_id',
      (await supabase.from('bookings').select('service_id').eq('id', id).single()).data!.service_id).eq('provider_profiles.status', 'published'),
  ]);
  const everyone = ((others ?? []) as unknown as { provider_profiles: { id: string; display_name: string } }[]).map((r) => r.provider_profiles)
    .sort((a, c) => a.display_name.localeCompare(c.display_name, 'pt-BR'));
  const here = `/admin/pedidos/${id}`;
  const idx = STATUS_STEPS.findIndex((s) => s.key === b.status);
  const next = idx >= 0 && idx < STATUS_STEPS.length - 1 ? STATUS_STEPS[idx + 1] : null;
  const closed = b.status === 'concluido' || b.status === 'cancelado';
  const Hidden = ({ action }: { action?: string }) => (<><input type="hidden" name="id" value={b.id} /><input type="hidden" name="back" value={here} />{action && <input type="hidden" name="action" value={action} />}</>);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/pedidos" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><span aria-hidden="true">←</span> Pedidos</Link>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900" data-testid="admin-booking-msg">{msg}</p>}
      <section className="card p-4 sm:p-5">
        <p className="text-sm font-semibold text-stone-500">Pedido #{b.code}</p>
        <h1 className="text-xl font-bold">{b.items[0]?.name ?? b.service}</h1>
        <p className="text-stone-700">{dateLabel(b.scheduled_date)}, {SLOT_LABEL[b.time_slot].toLowerCase()} · {b.neighborhood}</p>
        <p className="mt-1 text-sm text-stone-600">Endereço: {contacts?.address_line ?? '—'} · WhatsApp do cliente: {contacts?.client_phone ?? '—'}</p>
        {b.notes && <p className="mt-1 text-sm text-stone-600">Observações: {b.notes}</p>}
        <div className="mt-4"><BookingTimeline status={b.status} events={b.events} /></div>
      </section>

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="atr-t">
        <h2 id="atr-t" className="font-bold">Profissional</h2>
        <p data-testid="admin-provider">{contacts?.provider_name ? <Link className="font-semibold underline" href={`/p/${contacts.provider_slug}`}>{contacts.provider_name}</Link> : 'Nenhum ainda'}</p>
        {candidates.length > 0 && <p className="text-sm text-stone-600">Sugeridos para o dia e o bairro: {candidates.map((c) => c.display_name).join(', ')}.</p>}
        {!closed && (
          <form action={assignProvider} className="flex flex-wrap items-end gap-2" data-testid="assign-form">
            <Hidden />
            <div className="min-w-0 flex-1">
              <label htmlFor="provider" className="label">Atribuir ou trocar</label>
              <select id="provider" name="provider" className="input" defaultValue={b.provider_id ?? ''}>
                <option value="">Sem profissional</option>
                {candidates.length > 0 && <optgroup label="Sugeridos">{candidates.map((c) => <option key={c.provider_id} value={c.provider_id}>{c.display_name}</option>)}</optgroup>}
                <optgroup label="Todos que fazem o serviço">{everyone.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</optgroup>
              </select>
            </div>
            <button type="submit" className="btn-primary min-h-11 px-4">Salvar</button>
          </form>
        )}
      </section>

      {!closed && (
        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="st-t">
          <h2 id="st-t" className="font-bold">Situação</h2>
          <div className="flex flex-wrap gap-2">
            {next && b.provider_id && (
              <form action={bookingAction}><Hidden action={next.key} /><button type="submit" className="btn-primary min-h-11 px-4">Marcar: {next.label}</button></form>
            )}
          </div>
          <form action={bookingAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Hidden action="cancelar" />
            <div><label htmlFor="ck" className="label">Cancelar por</label>
              <select id="ck" name="cancel_kind" className="input" defaultValue="equipe">
                <option value="equipe">Decisão da equipe</option><option value="cliente">Pedido do cliente</option>
                <option value="profissional">Profissional desistiu</option><option value="nao_compareceu">Profissional não compareceu</option>
              </select></div>
            <div><label htmlFor="cn" className="label">Motivo</label><input id="cn" name="note" className="input" maxLength={300} /></div>
            <button type="submit" className="btn-danger min-h-11 px-4">Cancelar pedido</button>
          </form>
        </section>
      )}
      {b.status === 'concluido' && b.payment?.status !== 'pago' && (
        <form action={bookingAction}><Hidden action="pago" /><button type="submit" className="btn-outline min-h-11 px-4">Registrar pagamento recebido</button></form>
      )}

      <section className="card p-4 sm:p-5"><h2 className="font-bold">Valores</h2><BookingItems b={b} />
        {b.commission_cents !== null && <p className="mt-2 text-sm text-stone-600">Comissão: {(b.commission_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>}
      </section>
      <section className="card p-4 sm:p-5"><h2 className="mb-2 font-bold">Histórico</h2><EventList events={b.events} /></section>
    </div>
  );
}

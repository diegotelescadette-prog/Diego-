import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { bookingAction } from '@/app/pedidos/actions';
import { BookingItems } from '@/components/BookingTimeline';
import { getContacts, listBookings, type BookingView } from '@/lib/booking';
import { dateLabel, formatPrice, SLOT_LABEL, STATUS_LABEL } from '@/lib/booking-shared';
import { getSetting, getUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Pedidos para mim' };
export const dynamic = 'force-dynamic';

const NEXT: Record<string, { action: string; label: string }> = {
  confirmado: { action: 'a_caminho', label: 'Estou a caminho' },
  a_caminho: { action: 'em_andamento', label: 'Comecei o serviço' },
  em_andamento: { action: 'concluido', label: 'Terminei o serviço' },
};

function Act({ b, action, label, cls = 'btn-primary' }: { b: BookingView; action: string; label: string; cls?: string }) {
  return (
    <form action={bookingAction}>
      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="action" value={action} /><input type="hidden" name="back" value="/painel/pedidos" />
      <button type="submit" className={`${cls} min-h-11 w-full px-4`}>{label}</button>
    </form>
  );
}

async function Card({ b }: { b: BookingView }) {
  const c = await getContacts(b.id);
  const confirmed = b.status !== 'solicitado';
  return (
    <li className="card space-y-3 p-4" data-testid="provider-booking" data-status={b.status}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-stone-900">{b.items[0]?.name ?? b.service}</p>
          <p className="text-sm text-stone-600">{dateLabel(b.scheduled_date)}, {SLOT_LABEL[b.time_slot].toLowerCase()} · {b.neighborhood}</p>
        </div>
        <span className={`st-tag st-${b.status}`}>{STATUS_LABEL[b.status]}</span>
      </div>
      <BookingItems b={b} />
      <div className="rounded-xl bg-paper p-3 text-sm text-stone-700" data-testid="client-contact">
        {confirmed ? (
          <>
            <p><strong>Endereço:</strong> {c?.address_line ?? '—'}</p>
            <p><strong>WhatsApp do cliente:</strong> {c?.client_phone ?? '—'}</p>
          </>
        ) : (
          <p>O endereço e o WhatsApp do cliente aparecem quando você confirmar.</p>
        )}
        {b.notes && <p className="mt-1"><strong>Observações:</strong> {b.notes}</p>}
      </div>
      {b.status === 'solicitado' && (
        <div className="grid grid-cols-2 gap-2">
          <Act b={b} action="confirmado" label="Confirmar" />
          <Act b={b} action="recusar" label="Não posso" cls="btn-outline" />
        </div>
      )}
      {NEXT[b.status] && <Act b={b} action={NEXT[b.status].action} label={NEXT[b.status].label} />}
      {b.status === 'concluido' && b.payment?.status !== 'pago' && <Act b={b} action="pago" label={`Recebi ${formatPrice(b.total_cents)}`} cls="btn-outline" />}
      {b.status === 'concluido' && b.commission_cents !== null && (
        <p className="text-sm text-stone-600">Comissão da plataforma: {formatPrice(b.commission_cents)} · você recebe {formatPrice(b.total_cents - b.commission_cents)}</p>
      )}
    </li>
  );
}

/** Pedidos atribuídos ao profissional: confirmar ou recusar e avançar o status até concluir. */
export default async function PedidosParaMim({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/entrar?next=%2Fpainel%2Fpedidos');
  const { msg } = await searchParams;
  const [list, pct] = await Promise.all([listBookings({ provider: user.id, limit: 100 }), getSetting<{ percent: number }>('comissao')]);
  const groups = [
    { title: 'Esperando sua confirmação', items: list.filter((b) => b.status === 'solicitado') },
    { title: 'Próximos e em andamento', items: list.filter((b) => ['confirmado', 'a_caminho', 'em_andamento'].includes(b.status)) },
    { title: 'Concluídos e cancelados', items: list.filter((b) => ['concluido', 'cancelado'].includes(b.status)).slice(0, 20) },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-stone-800">Pedidos para mim</h1>
        <p className="text-stone-600">Você não paga para receber pedidos. A plataforma cobra {pct?.percent ?? 12}% só dos serviços concluídos.</p>
      </header>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900" data-testid="provider-msg">{msg}</p>}
      {!list.length && <p className="card p-5 text-stone-700">Nenhum pedido ainda. Os pedidos chegam aqui quando um cliente agenda um serviço que você faz, no seu bairro de atendimento.</p>}
      {groups.filter((g) => g.items.length).map((g) => (
        <section key={g.title} className="space-y-2">
          <h2 className="font-bold text-stone-800">{g.title}</h2>
          <ul className="space-y-3">{g.items.map((b) => <Card key={b.id} b={b} />)}</ul>
        </section>
      ))}
    </div>
  );
}

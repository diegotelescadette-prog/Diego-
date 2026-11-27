import { EVENT_LABEL, formatPrice, PAYMENT_LABEL, STATUS_LABEL, STATUS_STEPS, type BookingStatus } from '@/lib/booking-shared';
import type { BookingView } from '@/lib/booking';

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Campo_Grande', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Linha do tempo: Solicitado → Confirmado → A caminho → Em andamento → Concluído → Avaliação. */
export function BookingTimeline({ status, events, reviewed = false }: { status: BookingStatus; events: { status: string; created_at: string }[]; reviewed?: boolean }) {
  if (status === 'cancelado') {
    const ev = events.find((e) => e.status === 'cancelado');
    return <p className="st-tag st-cancelado" data-testid="status-now">{STATUS_LABEL.cancelado}{ev ? ` em ${fmt(ev.created_at)}` : ''}</p>;
  }
  const steps = [...STATUS_STEPS, { key: 'avaliado' as const, label: 'Avaliação', hint: 'Conte como foi o serviço.' }];
  const idx = status === 'concluido' ? (reviewed ? steps.length - 1 : steps.length - 2) : steps.findIndex((s) => s.key === status);
  return (
    <ol className="timeline" aria-label="Andamento do pedido" data-testid="timeline">
      {steps.map((s, i) => {
        const at = [...events].reverse().find((e) => e.status === s.key)?.created_at;
        const state = i < idx ? 'done' : i === idx ? (status === 'concluido' ? 'done' : 'now') : status === 'concluido' && i === idx + 1 ? 'now' : '';
        return (
          <li key={s.key} className={`tl-step ${state}`} aria-current={i === idx ? 'step' : undefined} data-testid={i === idx ? 'status-now' : undefined}>
            <span className="tl-dot" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
            <span className="min-w-0">
              <span className={`block font-semibold ${i <= idx ? 'text-stone-900' : 'text-stone-500'}`}>{s.label}</span>
              <span className="block text-sm text-stone-500">{at ? fmt(at) : state ? s.hint : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function EventList({ events }: { events: { status: string; actor_role: string; note: string | null; created_at: string }[] }) {
  return (
    <ul className="space-y-1 text-sm text-stone-700">
      {events.map((e, i) => (
        <li key={i}><span className="text-stone-500">{fmt(e.created_at)}</span> · {EVENT_LABEL[e.status] ?? e.status} <span className="text-stone-500">({e.actor_role})</span>{e.note ? `: ${e.note}` : ''}</li>
      ))}
    </ul>
  );
}

/** Itens, adicionais, total e forma de pagamento do pedido. */
export function BookingItems({ b }: { b: BookingView }) {
  return (
    <div className="divide-y divide-line text-stone-700" data-testid="booking-items">
      {b.items.map((it, i) => (
        <div key={i}>
          <div className="summary-row"><span>{it.name} × {it.qty}</span></div>
          {it.addons.map((a) => <div key={a.name} className="summary-row text-sm"><span>+ {a.name} × {it.qty}</span></div>)}
        </div>
      ))}
      <div className="summary-row items-baseline pt-3">
        <span className="font-bold text-stone-900">Valor</span>
        {b.total_cents > 0
          ? <span className="price-md" data-testid="booking-total">{formatPrice(b.total_cents)}</span>
          : <span className="text-right text-stone-600" data-testid="booking-total">O profissional informa o valor</span>}
      </div>
      <div className="summary-row text-sm"><span>Pagamento</span><span>{PAYMENT_LABEL[b.payment_method]}{b.payment?.status === 'pago' ? ' · pago' : ' · depois do serviço'}</span></div>
    </div>
  );
}


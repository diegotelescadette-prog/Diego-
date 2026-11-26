import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUpcoming } from '@/lib/booking';
import { dayBox, SLOT_LABEL, STATUS_LABEL } from '@/lib/booking-shared';
import { getUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Minha agenda' };
export const dynamic = 'force-dynamic';

/** Agenda unificada. Hoje: os serviços agendados (como cliente ou profissional). Reuniões, entrevistas e palestras entram nas fases 3 e 4. */
export default async function Agenda() {
  const user = await getUser();
  if (!user) redirect('/entrar?next=%2Fagenda');
  const list = await getUpcoming(user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-3xl text-stone-900">Minha agenda</h1>
        <Link href="/pedidos" className="text-sm font-semibold text-brand-700 hover:underline">Todos os pedidos</Link>
      </div>
      {list.length ? (
        <ul className="space-y-2" data-testid="agenda-list">
          {list.map((b) => {
            const d = dayBox(b.scheduled_date);
            const mine = b.client_id === user.id;
            return (
              <li key={b.id}>
                <Link href={mine ? `/pedidos/${b.id}` : '/painel/pedidos'} className="card flex items-center gap-4 p-4 hover:border-brand-300" data-testid="agenda-item">
                  <span className="date-box" aria-hidden="true"><small>{d.weekday}</small><strong>{d.day}</strong><small>{d.month}</small></span>
                  <span className="min-w-0 flex-1">
                    <span className="soft-tag mod-servicos text-xs">{mine ? 'Serviço' : 'Atendimento'}</span>
                    <span className="mt-1 block font-bold text-stone-900">{b.items[0]?.name ?? b.service}</span>
                    <span className="block text-sm text-stone-600">{d.weekday}, {d.day} de {d.month} · {SLOT_LABEL[b.time_slot].toLowerCase()} · {b.neighborhood}</span>
                    <span className="block text-sm font-semibold text-stone-700">{STATUS_LABEL[b.status]}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="card p-5 text-stone-700" data-testid="agenda-empty">
          <p>Nada marcado por enquanto. Quando você agendar um serviço, ele aparece aqui com a data em destaque.</p>
          <Link href="/servicos" className="btn-hoje mt-3 min-h-11 px-4">Ver serviços</Link>
        </div>
      )}
    </div>
  );
}

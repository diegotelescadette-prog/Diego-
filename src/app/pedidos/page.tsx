import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listBookings } from '@/lib/booking';
import { dateLabel, formatPrice, SLOT_LABEL, STATUS_LABEL } from '@/lib/booking-shared';
import { getUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Meus pedidos' };
export const dynamic = 'force-dynamic';

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/entrar?next=%2Fpedidos');
  const { msg } = await searchParams;
  const list = await listBookings({ client: user.id });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-stone-800">Meus pedidos</h1>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{msg}</p>}
      {list.length ? (
        <ul className="space-y-2">
          {list.map((b) => (
            <li key={b.id}>
              <Link href={`/pedidos/${b.id}`} className="card flex items-center gap-3 p-4 hover:border-brand-400" data-testid="my-booking">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-stone-900">{b.items[0]?.name ?? b.service}</span>
                  <span className="block text-sm text-stone-600">{dateLabel(b.scheduled_date)}, {SLOT_LABEL[b.time_slot].split(' (')[0].toLowerCase()} · {b.neighborhood}</span>
                </span>
                <span className="text-right">
                  <span className={`st-tag st-${b.status}`}>{STATUS_LABEL[b.status]}</span>
                  <span className="mt-1 block font-bold">{b.total_cents > 0 ? formatPrice(b.total_cents) : 'Valor a informar'}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card p-5 text-stone-700">
          <p>Você ainda não fez nenhum pedido.</p>
          <Link href="/servicos" className="btn-hoje mt-3 min-h-11 px-4">Ver serviços</Link>
        </div>
      )}
    </div>
  );
}

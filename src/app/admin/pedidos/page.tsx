import type { Metadata } from 'next';
import Link from 'next/link';
import { Restricted } from '@/components/Restricted';
import { listBookings } from '@/lib/booking';
import { dateLabel, formatPrice, SLOT_LABEL, STATUS_LABEL, type BookingStatus } from '@/lib/booking-shared';
import { getCatalog, getIsAdmin, getNeighborhoods, getPilotCity } from '@/lib/data';

export const metadata: Metadata = { title: 'Pedidos' };
export const dynamic = 'force-dynamic';

type SP = { status?: string; data?: string; categoria?: string; bairro?: string; msg?: string };

/** Lista de pedidos para a equipe, com filtros por situação, data, categoria e bairro. */
export default async function AdminPedidos({ searchParams }: { searchParams: Promise<SP> }) {
  if (!(await getIsAdmin())) return <Restricted what="Pedidos e endereços de clientes" />;
  const sp = await searchParams;
  const city = await getPilotCity();
  const [cats, hoods] = await Promise.all([getCatalog(), getNeighborhoods(city.id)]);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.data ?? '') ? sp.data : undefined;
  const list = await listBookings({ status: sp.status || undefined, date, category: sp.categoria || undefined, neighborhood: Number(sp.bairro) || undefined, limit: 200 });
  const noProvider = list.filter((b) => b.status === 'solicitado' && !b.provider_id).length;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Pedidos</h1>
          <p className="text-stone-600">{list.length} {list.length === 1 ? 'pedido' : 'pedidos'}{noProvider ? ` · ${noProvider} sem profissional` : ''}</p>
        </div>
        <Link href="/admin/pacotes" className="btn-outline min-h-11 px-4">Pacotes</Link>
      </header>
      {sp.msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{sp.msg}</p>}
      <form method="get" className="card grid gap-2 p-3 sm:grid-cols-5" aria-label="Filtrar pedidos">
        <div><label htmlFor="f-st" className="label text-sm">Situação</label>
          <select id="f-st" name="status" className="input" defaultValue={sp.status ?? ''}>
            <option value="">Todas</option><option value="abertos">Em aberto</option>
            {(Object.keys(STATUS_LABEL) as BookingStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></div>
        <div><label htmlFor="f-dt" className="label text-sm">Data</label><input id="f-dt" type="date" name="data" className="input" defaultValue={date ?? ''} /></div>
        <div><label htmlFor="f-cat" className="label text-sm">Categoria</label>
          <select id="f-cat" name="categoria" className="input" defaultValue={sp.categoria ?? ''}>
            <option value="">Todas</option>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select></div>
        <div><label htmlFor="f-nb" className="label text-sm">Bairro</label>
          <select id="f-nb" name="bairro" className="input" defaultValue={sp.bairro ?? ''}>
            <option value="">Todos</option>{hoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select></div>
        <button type="submit" className="btn-primary min-h-11 self-end">Filtrar</button>
      </form>
      {list.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-stone-500"><tr><th className="p-3">Pedido</th><th className="p-3">Quando</th><th className="p-3">Bairro</th><th className="p-3">Situação</th><th className="p-3 text-right">Total</th></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-0" data-testid="admin-booking">
                  <td className="p-3"><Link href={`/admin/pedidos/${b.id}`} className="font-semibold text-brand-800 hover:underline">#{b.code} · {b.items[0]?.name ?? b.service}</Link></td>
                  <td className="p-3">{dateLabel(b.scheduled_date)}, {SLOT_LABEL[b.time_slot].split(' (')[0].toLowerCase()}</td>
                  <td className="p-3">{b.neighborhood}</td>
                  <td className="p-3"><span className={`st-tag st-${b.status}`}>{STATUS_LABEL[b.status]}</span>{b.status === 'solicitado' && !b.provider_id && <span className="ml-1 text-xs font-bold text-hoje-700">sem profissional</span>}</td>
                  <td className="p-3 text-right font-semibold">{b.total_cents > 0 ? formatPrice(b.total_cents) : 'A informar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="card p-5 text-stone-700">Nenhum pedido com esses filtros.</p>}
    </div>
  );
}

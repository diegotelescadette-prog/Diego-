import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AgendaCard } from '@/components/AgendaCard';
import { getAgenda } from '@/lib/agenda';
import { getUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Minha agenda' };
export const dynamic = 'force-dynamic';

/** Agenda unificada: serviços agendados (como cliente ou profissional) e entrevistas de emprego. Reuniões e palestras entram nas fases 3 e 4. */
export default async function Agenda() {
  const user = await getUser();
  if (!user) redirect('/entrar?next=%2Fagenda');
  const list = await getAgenda(user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-3xl text-stone-900">Minha agenda</h1>
        <Link href="/pedidos" className="text-sm font-semibold text-brand-700 hover:underline">Todos os pedidos</Link>
      </div>
      {list.length ? (
        <ul className="space-y-2" data-testid="agenda-list">
          {list.map((it) => <li key={it.key}><AgendaCard item={it} testId="agenda-item" /></li>)}
        </ul>
      ) : (
        <div className="card p-5 text-stone-700" data-testid="agenda-empty">
          <p>Nada marcado por enquanto. Quando você agendar um serviço ou marcar uma entrevista, ele aparece aqui com a data em destaque.</p>
          <Link href="/servicos" className="btn-hoje mt-3 min-h-11 px-4">Ver serviços</Link>
        </div>
      )}
    </div>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { after } from 'next/server';
import { JobCard, type JobCardData } from '@/components/jobs/JobCard';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { EMPLOYMENT_LABEL, WORK_MODE_LABEL } from '@/lib/jobs';
import { JOB_LIST_FIELDS, normalizeQuery, placeOf, purgeOldResumes } from '@/lib/jobs-data';

export const metadata: Metadata = { title: 'Vagas de emprego' };
export const dynamic = 'force-dynamic';

type SP = { q?: string; tipo?: string; formato?: string; pagina?: string };
const PAGE = 20;

export default async function Vagas({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getUser();
  const supabase = await createClient();
  const page = Math.max(1, Number(sp.pagina) || 1);
  const q = normalizeQuery(sp.q ?? '').slice(0, 80);
  const tipo = sp.tipo && sp.tipo in EMPLOYMENT_LABEL ? sp.tipo : '';
  const formato = sp.formato && sp.formato in WORK_MODE_LABEL ? sp.formato : '';

  let query = supabase.from('jobs').select(JOB_LIST_FIELDS, { count: 'exact' })
    .eq('status', 'aberta').gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (q) for (const word of q.split(' ').slice(0, 5)) query = query.ilike('search_norm', `%${word}%`);
  if (tipo) query = query.eq('employment_type', tipo);
  if (formato) query = query.eq('work_mode', formato);
  const { data, count, error } = await query;
  const jobs: JobCardData[] = (data ?? []).map((j) => ({ ...(j as unknown as JobCardData), place: placeOf(j) }));
  const total = count ?? 0;
  const filtered = !!(q || tipo || formato);
  const pageHref = (p: number) => `/vagas?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(tipo ? { tipo } : {}), ...(formato ? { formato } : {}), pagina: String(p) })}`;

  after(purgeOldResumes);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Vagas de emprego</h1>
          <p className="text-stone-700">Oportunidades em Campo Grande. Candidate-se enviando seu currículo em PDF.</p>
        </div>
        <Link href={user ? '/vagas/nova' : '/entrar?next=/vagas/nova'} className="btn-primary">Anunciar uma vaga</Link>
      </div>

      <form action="/vagas" method="get" role="search" className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <div>
          <label htmlFor="q" className="label">Cargo ou empresa</label>
          <input id="q" name="q" className="input" defaultValue={sp.q ?? ''} placeholder="Ex.: vendedor, cozinha, motorista" />
        </div>
        <div>
          <label htmlFor="tipo" className="label">Contratação</label>
          <select id="tipo" name="tipo" className="input" defaultValue={tipo}>
            <option value="">Todas</option>
            {Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="formato" className="label">Formato</label>
          <select id="formato" name="formato" className="input" defaultValue={formato}>
            <option value="">Todos</option>
            {Object.entries(WORK_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <button className="btn-outline" type="submit">Buscar vagas</button>
      </form>

      {user && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link className="underline" href="/minhas-candidaturas">Minhas candidaturas</Link>
          <Link className="underline" href="/minhas-vagas">Vagas que publiquei</Link>
        </p>
      )}

      {error && <p role="alert" className="card p-4 text-red-800">Não foi possível carregar as vagas. Tente novamente.</p>}
      {!error && (
        <p className="text-stone-700" role="status" data-testid="vagas-total">
          {total === 0 ? (filtered ? 'Nenhuma vaga com esses filtros.' : 'Ainda não há vagas abertas.') : total === 1 ? '1 vaga aberta' : `${total} vagas abertas`}
        </p>
      )}
      {total === 0 && filtered && <Link href="/vagas" className="btn-ghost">Ver todas as vagas</Link>}
      <ul className="grid gap-3">{jobs.map((j) => <JobCard key={j.id} job={j} />)}</ul>
      {total > PAGE && (
        <nav className="flex justify-between" aria-label="Páginas">
          {page > 1 ? <Link className="btn-outline" href={pageHref(page - 1)}>Anteriores</Link> : <span />}
          {page * PAGE < total && <Link className="btn-outline" href={pageHref(page + 1)}>Próximas</Link>}
        </nav>
      )}
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        Atenção: nenhuma vaga deve cobrar taxa, curso ou exame pago do candidato. Se isso acontecer, denuncie a vaga.
      </p>
    </div>
  );
}

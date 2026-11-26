import Link from 'next/link';
import type { Metadata } from 'next';
import { after } from 'next/server';
import { JobCard, type JobCardData } from '@/components/jobs/JobCard';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { AREA_LABEL, EMPLOYMENT_LABEL, SALARY_RANGES, WORK_MODE_LABEL } from '@/lib/jobs';
import { getNeighborhoods, getPilotCity } from '@/lib/data';
import { JOB_LIST_FIELDS, normalizeQuery, placeOf, purgeOldResumes } from '@/lib/jobs-data';

export const metadata: Metadata = { title: 'Vagas de emprego' };
export const dynamic = 'force-dynamic';

type SP = { q?: string; tipo?: string; formato?: string; pagina?: string; area?: string; bairro?: string; salario?: string };
const PAGE = 20;

export default async function Vagas({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getUser();
  const supabase = await createClient();
  const page = Math.max(1, Number(sp.pagina) || 1);
  const q = normalizeQuery(sp.q ?? '').slice(0, 80);
  const tipo = sp.tipo && sp.tipo in EMPLOYMENT_LABEL ? sp.tipo : '';
  const formato = sp.formato && sp.formato in WORK_MODE_LABEL ? sp.formato : '';
  const area = sp.area && sp.area in AREA_LABEL ? sp.area : '';
  const salario = sp.salario && sp.salario in SALARY_RANGES ? (sp.salario as keyof typeof SALARY_RANGES) : '';
  const city = await getPilotCity();
  const hoods = await getNeighborhoods(city.id);
  const bairro = hoods.find((h) => String(h.id) === sp.bairro) ? String(sp.bairro) : '';

  let query = supabase.from('jobs').select(JOB_LIST_FIELDS, { count: 'exact' })
    .eq('status', 'aberta').eq('held', false).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (q) for (const word of q.split(' ').slice(0, 5)) query = query.ilike('search_norm', `%${word}%`);
  if (tipo) query = query.eq('employment_type', tipo);
  if (formato) query = query.eq('work_mode', formato);
  if (area) query = query.eq('area', area);
  // bairro escolhido: vagas nesse bairro e as sem bairro (cidade toda)
  if (bairro) query = query.or(`neighborhood_id.eq.${Number(bairro)},neighborhood_id.is.null`);
  if (salario) {
    const r = SALARY_RANGES[salario];
    query = query.or(`salary_max.gte.${r.min},and(salary_max.is.null,salary_min.gte.${r.min})`).or(`salary_min.lte.${r.max},and(salary_min.is.null,salary_max.lte.${r.max})`);
  }
  const { data, count, error } = await query;
  const jobs: JobCardData[] = (data ?? []).map((j) => ({ ...(j as unknown as JobCardData), place: placeOf(j) }));
  const total = count ?? 0;
  const filtered = !!(q || tipo || formato || area || bairro || salario);
  const keepQ = { ...(sp.q ? { q: sp.q } : {}), ...(tipo ? { tipo } : {}), ...(formato ? { formato } : {}), ...(area ? { area } : {}), ...(bairro ? { bairro } : {}), ...(salario ? { salario } : {}) };
  const pageHref = (p: number) => `/vagas?${new URLSearchParams({ ...keepQ, pagina: String(p) })}`;

  after(purgeOldResumes);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl text-stone-900">Trabalho</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="enviar-titulo" className="home-side" data-testid="area-curriculo">
          <h2 id="enviar-titulo" className="text-xl text-stone-900">Enviar currículo</h2>
          <p className="text-stone-700">Monte seu currículo aqui e candidate-se com um toque. Sem pagar nada.</p>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Link href={user ? '/curriculo' : '/entrar?next=/curriculo'} className="btn-primary">Meu currículo</Link>
            {user && <Link href="/minhas-candidaturas" className="btn-outline">Minhas candidaturas</Link>}
            <Link href={user ? '/vagas/meu-curriculo' : '/entrar?next=/vagas/meu-curriculo'} className="btn-ghost">Deixar meu currículo</Link>
          </div>
        </section>
        <section aria-labelledby="oferecer-titulo" className="home-side" data-testid="area-oferecer">
          <h2 id="oferecer-titulo" className="text-xl text-stone-900">Oferecer trabalho</h2>
          <p className="text-stone-700">Está contratando? Anuncie grátis, receba currículos, compare e convide para entrevista.</p>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Link href={user ? '/vagas/nova' : '/entrar?next=/vagas/nova'} className="btn-primary">Anunciar uma vaga</Link>
            {user && <Link href="/minhas-vagas" className="btn-outline">Vagas que publiquei</Link>}
            <Link href={user ? '/vagas/banco' : '/entrar?next=/vagas/banco'} className="btn-ghost">Banco de currículos</Link>
          </div>
        </section>
      </div>
      <h2 id="vagas-abertas" className="pt-2 text-xl text-stone-900">Vagas abertas em Campo Grande</h2>

      <form action="/vagas" method="get" role="search" className="card grid gap-3 p-4 sm:grid-cols-3" data-testid="job-filters">
        <div className="sm:col-span-3">
          <label htmlFor="q" className="label">Cargo ou empresa</label>
          <input id="q" name="q" className="input" defaultValue={sp.q ?? ''} placeholder="Ex.: vendedor, cozinha, motorista" />
        </div>
        <div>
          <label htmlFor="area" className="label">Área</label>
          <select id="area" name="area" className="input" defaultValue={area}>
            <option value="">Todas</option>
            {Object.entries(AREA_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="bairro" className="label">Bairro</label>
          <select id="bairro" name="bairro" className="input" defaultValue={bairro}>
            <option value="">Toda {city.name}</option>
            {hoods.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tipo" className="label">Tipo</label>
          <select id="tipo" name="tipo" className="input" defaultValue={tipo}>
            <option value="">Todos</option>
            {Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="salario" className="label">Faixa salarial</label>
          <select id="salario" name="salario" className="input" defaultValue={salario}>
            <option value="">Qualquer</option>
            {Object.entries(SALARY_RANGES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="formato" className="label">Presencial ou remoto</label>
          <select id="formato" name="formato" className="input" defaultValue={formato}>
            <option value="">Todos</option>
            {Object.entries(WORK_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="flex items-end"><button className="btn-primary w-full" type="submit">Buscar vagas</button></div>
      </form>

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
      <p className="safety text-sm">
        Aqui nenhuma vaga pode cobrar taxa, curso ou exame pago do candidato. Se isso acontecer, denuncie a vaga.
      </p>
    </div>
  );
}

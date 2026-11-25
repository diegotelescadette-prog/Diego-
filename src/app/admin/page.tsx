import Link from 'next/link';
import type { Metadata } from 'next';
import { addSynonym, createService, removeSynonym, resolveReport, resolveSuggestion, saveCpfSetting, toggleCategory, toggleService, toggleUrgent } from './actions';
import { ConfirmStatus } from './ConfirmStatus';
import { SubmitButton } from '@/components/SubmitButton';
import { getCatalog, getCities, getIsAdmin, getPilotCity, getSetting, getUser, type CpfSetting } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { ADMIN_SECTIONS, adminSection } from '@/lib/nav';
import { STATUS_LABEL, type City, type ProviderStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Administração' };
export const dynamic = 'force-dynamic';

const REASON: Record<string, string> = {
  informacoes_falsas: 'Informações falsas', golpe_ou_cobranca: 'Golpe ou cobrança', comportamento_inadequado: 'Comportamento inadequado',
  conteudo_improprio: 'Conteúdo impróprio', outro: 'Outro',
};
const REPORT_STATUS: Record<string, string> = { aberta: 'Em análise', procedente: 'Procedente', improcedente: 'Improcedente' };
const COVERAGE_LABEL: Record<string, string> = { cidade: 'Cidade inteira', bairros: 'Bairros selecionados', online: 'Só online', pendente: 'Área pendente' };
const STATUS_STYLE: Record<string, string> = { draft: 'bg-stone-200 text-stone-900', published: 'bg-green-100 text-green-900', paused: 'bg-amber-100 text-amber-900', suspended: 'bg-red-100 text-red-900' };

type SP = { aba?: string; msg?: string; q?: string; cidade?: string; status?: string; categoria?: string; cobertura?: string; hoje?: string; pendente?: string; pagina?: string };

/** Endereço de uma lista do admin com os filtros informados (o mesmo usado nos indicadores). */
function adminHref(aba: string, f: Partial<SP> = {}) {
  const qs = new URLSearchParams({ aba });
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  return `/admin?${qs}`;
}

export default async function Admin({ searchParams }: { searchParams: Promise<SP> }) {
  if (!(await getIsAdmin())) {
    const user = await getUser();
    return (
      <div className="mx-auto max-w-xl card p-6" role="alert" data-testid="acesso-restrito">
        <h1 className="text-2xl font-extrabold">Acesso restrito</h1>
        <p className="mt-2 text-stone-700">Esta área é exclusiva da equipe de administração{user ? '. Sua conta não tem essa permissão.' : '.'}</p>
        <Link className="btn-primary mt-4" href="/">Voltar ao início</Link>
      </div>
    );
  }
  const sp = await searchParams;
  const aba = adminSection(sp.aba);
  const sb = await createClient();
  const [cities, pilot] = await Promise.all([getCities(), getPilotCity()]);
  // Cidade selecionada: Campo Grande por padrão; "todas" desliga o filtro.
  const city = sp.cidade === 'todas' ? null : cities.find((c) => c.slug === (sp.cidade ?? pilot.slug)) ?? pilot;
  const label = ADMIN_SECTIONS.find((x) => x.key === aba)!.label;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{label}</h1>
      {sp.msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{sp.msg}</p>}
      {aba === 'visao' && <Visao sb={sb} city={city} cities={cities} />}
      {aba === 'catalogo' && <Catalogo sb={sb} />}
      {aba === 'sugestoes' && <Sugestoes sb={sb} />}
      {aba === 'denuncias' && <Denuncias sb={sb} sp={sp} city={city} cities={cities} />}
      {aba === 'perfis' && <Perfis sb={sb} sp={sp} city={city} cities={cities} />}
      {aba === 'historico' && <Historico sb={sb} />}
      {aba === 'config' && <Config />}
    </div>
  );
}

type SB = Awaited<ReturnType<typeof createClient>>;

function CitySelect({ aba, city, cities, extra }: { aba: string; city: City | null; cities: City[]; extra?: Record<string, string | undefined> }) {
  return (
    <form action="/admin" method="get" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="aba" value={aba} />
      {Object.entries(extra ?? {}).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <div>
        <label htmlFor={`cidade-${aba}`} className="label">Cidade</label>
        <select id={`cidade-${aba}`} name="cidade" defaultValue={city?.slug ?? 'todas'} className="input">
          {cities.map((c) => <option key={c.id} value={c.slug}>{c.name}–{c.uf}</option>)}
          <option value="todas">Todas as cidades</option>
        </select>
      </div>
      <button className="btn-outline" type="submit">Aplicar</button>
    </form>
  );
}

type Counted = { total_count: number }[] | null;
const totalOf = (r: { data: unknown; error: unknown }) => (r.error ? null : Number((r.data as Counted)?.[0]?.total_count ?? 0));

async function Visao({ sb, city, cities }: { sb: SB; city: City | null; cities: City[] }) {
  const c = city?.slug ?? null;
  const cidade = city?.slug ?? 'todas';
  // Cada indicador usa a mesma função e os mesmos filtros da lista que ele abre.
  const [pub, hoje, pend, rep, cov] = await Promise.all([
    sb.rpc('admin_providers', { p_city_slug: c, p_status: 'published', p_limit: 1 }),
    sb.rpc('admin_providers', { p_city_slug: c, p_today: true, p_limit: 1 }),
    sb.rpc('admin_providers', { p_city_slug: c, p_area_pending: true, p_limit: 1 }),
    sb.rpc('admin_open_reports', { p_city_slug: c }),
    sb.rpc('admin_category_coverage', { p_city_slug: c }),
  ]);
  const kpis = [
    { label: 'Prestadores publicados', n: totalOf(pub), href: adminHref('perfis', { cidade, status: 'published' }), hint: 'Perfis distintos com status Publicado.' },
    { label: 'Disponíveis hoje', n: totalOf(hoje), href: adminHref('perfis', { cidade, hoje: '1' }), hint: 'Publicados, com área confirmada e “Atendo hoje” vigente.' },
    { label: 'Perfis sem área confirmada', n: totalOf(pend), href: adminHref('perfis', { cidade, pendente: '1' }), hint: 'Têm endereço de referência e ainda não declararam a cobertura.' },
    { label: 'Denúncias abertas', n: rep.error ? null : Number(rep.data ?? 0), href: adminHref('denuncias', { cidade, status: 'aberta' }), hint: 'Aguardando análise.' },
  ];
  const rows = (cov.data ?? []) as { category_id: number; name: string; slug: string; active: boolean; published: number; available_today: number }[];
  return (
    <div className="space-y-5">
      <CitySelect aba="visao" city={city} cities={cities} />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores">
        {kpis.map((k) => (
          <li key={k.label}>
            <Link href={k.href} className="kpi" data-testid={`kpi-${k.label}`}>
              <span className="text-sm font-semibold text-stone-700">{k.label}</span>
              {k.n === null
                ? <span className="mt-1 block font-semibold text-red-700" role="alert">Não foi possível carregar</span>
                : <span className="kpi-num" data-testid="kpi-num">{k.n}</span>}
              <span className="mt-1 block text-xs text-stone-600">{k.hint}</span>
              <span className="mt-2 block text-sm font-semibold text-brand-700 underline">Ver lista</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="card overflow-x-auto p-2" aria-labelledby="cobertura">
        <h2 id="cobertura" className="px-2 pt-2 text-lg font-bold">Cobertura por categoria</h2>
        <p className="px-2 text-sm text-stone-600">Cada profissional conta uma vez por categoria, mesmo com mais de um serviço nela.</p>
        {cov.error ? (
          <p role="alert" className="m-2 rounded-xl bg-red-50 p-3 text-red-900">Não foi possível carregar a cobertura. <Link className="underline" href={adminHref('visao', { cidade })}>Tentar novamente</Link></p>
        ) : (
          <table className="mt-2 w-full text-left text-sm" data-testid="coverage-table">
            <thead><tr className="text-stone-600"><th className="p-2">Categoria</th><th className="p-2 text-right">Publicados</th><th className="p-2 text-right">Disponíveis hoje</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category_id} className="border-t border-stone-100">
                  <th scope="row" className="p-2 font-semibold">{r.name}{!r.active && <span className="ml-1 font-normal text-stone-500">(desativada)</span>}</th>
                  <td className="p-2 text-right tabular-nums"><Link className="underline" href={adminHref('perfis', { cidade, status: 'published', categoria: r.slug })}>{r.published}</Link></td>
                  <td className="p-2 text-right tabular-nums"><Link className="underline" href={adminHref('perfis', { cidade, hoje: '1', categoria: r.slug })}>{r.available_today}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

async function Catalogo({ sb }: { sb: SB }) {
  const catalog = await getCatalog(true);
  const { data: syns } = await sb.from('service_synonyms').select('id, service_id, term').order('term');
  return (
    <div className="space-y-3">
      <form action={createService} className="card grid gap-2 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div><label className="label" htmlFor="ns-cat">Categoria</label>
          <select id="ns-cat" name="category_id" className="input">{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="ns-name">Novo serviço</label><input id="ns-name" name="name" className="input" required /></div>
        <div><label className="label" htmlFor="ns-mode">Modo</label>
          <select id="ns-mode" name="mode" className="input"><option value="presencial">Presencial</option><option value="online">Online</option><option value="ambos">Ambos</option></select></div>
        <SubmitButton>Adicionar</SubmitButton>
      </form>
      {catalog.map((c) => (
        <details key={c.id} className="card p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-2 font-bold">
            <span>{c.name} {!c.active && <span className="text-sm font-normal text-red-700">(desativada)</span>}</span>
            <span className="text-sm font-normal text-stone-600">{c.services.length} serviços</span>
          </summary>
          <form action={toggleCategory} className="mt-2">
            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? '0' : '1'} />
            <SubmitButton className="btn-ghost">{c.active ? 'Desativar categoria' : 'Reativar categoria'}</SubmitButton>
          </form>
          <ul className="mt-2 divide-y divide-stone-100">
            {c.services.map((s) => (
              <li key={s.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${s.active ? '' : 'text-stone-400 line-through'}`}>{s.name}</span>
                  <span className="text-xs text-stone-500">{s.mode}</span>
                  <span className={`tag text-xs ${s.active ? 'bg-green-100 text-green-900' : 'bg-stone-200 text-stone-700'}`}>{s.active ? 'Ativo' : 'Inativo'}</span>
                  {s.mode !== 'online' && (
                    <span className={`tag text-xs ${s.urgent_pilot ? 'bg-orange-100 text-orange-900' : 'bg-stone-100 text-stone-600'}`}>{s.urgent_pilot ? 'No “Preciso para hoje”' : 'Fora do “Preciso para hoje”'}</span>
                  )}
                  <span className="ml-auto flex flex-wrap gap-1">
                    {s.mode !== 'online' && (
                      <form action={toggleUrgent}>
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="urgent" value={s.urgent_pilot ? '0' : '1'} />
                        <SubmitButton className="btn-ghost min-h-9 py-1 text-sm">{s.urgent_pilot ? 'Tirar do “Preciso para hoje”' : 'Incluir no “Preciso para hoje”'}</SubmitButton>
                      </form>
                    )}
                    <form action={toggleService}>
                      <input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={s.active ? '0' : '1'} />
                      <SubmitButton className="btn-ghost min-h-9 py-1 text-sm">{s.active ? 'Desativar' : 'Reativar'}</SubmitButton>
                    </form>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {(syns ?? []).filter((x) => x.service_id === s.id).map((x) => (
                    <form key={x.id} action={removeSynonym} className="inline">
                      <input type="hidden" name="id" value={x.id} />
                      <button className="chip text-xs" aria-label={`Remover sinônimo ${x.term}`}>{x.term} ✕</button>
                    </form>
                  ))}
                  <form action={addSynonym} className="inline-flex gap-1">
                    <input type="hidden" name="service_id" value={s.id} />
                    <label className="sr-only" htmlFor={`syn-${s.id}`}>Novo sinônimo para {s.name}</label>
                    <input id={`syn-${s.id}`} name="term" placeholder="+ sinônimo" className="w-32 rounded-lg border border-stone-300 px-2 py-1 text-sm" />
                    <button className="rounded-lg bg-stone-100 px-2 text-sm" type="submit">Adicionar</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
      <p className="text-sm text-stone-600">Desativar oculta da seleção e da busca por termo, sem apagar os vínculos dos perfis existentes. Serviços só online não entram no “Preciso para hoje”.</p>
    </div>
  );
}

async function Sugestoes({ sb }: { sb: SB }) {
  const [{ data }, catalog] = await Promise.all([
    sb.from('service_suggestions').select('id, name, note, status, created_at').order('created_at', { ascending: false }).limit(100),
    getCatalog(),
  ]);
  const pend = (data ?? []).filter((s) => s.status === 'pendente');
  return (
    <div className="space-y-3">
      {pend.length === 0 && <p className="card p-4">Nenhuma sugestão pendente.</p>}
      {pend.map((s) => (
        <div key={s.id} className="card space-y-3 p-4">
          <p className="font-bold">{s.name}</p>
          {s.note && <p className="text-stone-700">{s.note}</p>}
          <form action={resolveSuggestion} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="incorporar" />
            <div><label className="label" htmlFor={`n-${s.id}`}>Nome final</label><input id={`n-${s.id}`} name="name" defaultValue={s.name} className="input" /></div>
            <div><label className="label" htmlFor={`c-${s.id}`}>Categoria</label>
              <select id={`c-${s.id}`} name="category_id" className="input">{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <select name="mode" className="input w-auto" aria-label="Modo"><option value="presencial">Presencial</option><option value="online">Online</option><option value="ambos">Ambos</option></select>
            <SubmitButton>Incorporar ao catálogo</SubmitButton>
          </form>
          <form action={resolveSuggestion} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="associar" />
            <div><label className="label" htmlFor={`a-${s.id}`}>Associar como sinônimo de</label>
              <select id={`a-${s.id}`} name="service_id" className="input">
                {catalog.map((c) => <optgroup key={c.id} label={c.name}>{c.services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
              </select></div>
            <SubmitButton className="btn-outline">Associar</SubmitButton>
          </form>
          <form action={resolveSuggestion}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="recusar" />
            <SubmitButton className="btn-ghost">Recusar</SubmitButton></form>
        </div>
      ))}
    </div>
  );
}

async function Denuncias({ sb, sp, city, cities }: { sb: SB; sp: SP; city: City | null; cities: City[] }) {
  const status = ['aberta', 'procedente', 'improcedente', 'todas'].includes(sp.status ?? '') ? sp.status! : 'aberta';
  let q = sb.from('reports').select('id, reason, details, status, created_at, provider_id, provider_profiles!inner(display_name, slug, status, city_id)')
    .order('created_at', { ascending: false }).limit(100);
  if (status !== 'todas') q = q.eq('status', status);
  if (city) q = q.eq('provider_profiles.city_id', city.id);
  const { data, error } = await q;
  const cidade = city?.slug ?? 'todas';
  const back = adminHref('denuncias', { cidade, status });
  return (
    <div className="space-y-3">
      <form action="/admin" method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="aba" value="denuncias" />
        <div><label className="label" htmlFor="d-cidade">Cidade</label>
          <select id="d-cidade" name="cidade" defaultValue={cidade} className="input">
            {cities.map((c) => <option key={c.id} value={c.slug}>{c.name}–{c.uf}</option>)}
            <option value="todas">Todas as cidades</option>
          </select></div>
        <div><label className="label" htmlFor="d-status">Status</label>
          <select id="d-status" name="status" defaultValue={status} className="input">
            <option value="aberta">Em análise</option><option value="procedente">Procedente</option><option value="improcedente">Improcedente</option><option value="todas">Todas</option>
          </select></div>
        <button className="btn-outline" type="submit">Filtrar</button>
      </form>
      {error && <p role="alert" className="card p-4 text-red-800">Não foi possível carregar as denúncias. Tente novamente.</p>}
      {!error && (data ?? []).length === 0 && <p className="card p-4">Nenhuma denúncia {status === 'todas' ? '' : `com status “${REPORT_STATUS[status]}”`}.</p>}
      {(data ?? []).map((r) => {
        const p = r.provider_profiles as unknown as { display_name: string; slug: string; status: ProviderStatus };
        return (
          <div key={r.id} className="card p-4">
            <p className="flex flex-wrap items-center gap-2 font-bold">#{r.id} · {REASON[r.reason]}
              <span className={`tag ${r.status === 'aberta' ? 'bg-amber-100 text-amber-900' : 'bg-stone-200 text-stone-800'}`}>{REPORT_STATUS[r.status] ?? r.status}</span></p>
            <p className="mt-1">Perfil: <Link className="underline" href={`/p/${p?.slug}`}>{p?.display_name}</Link> ({STATUS_LABEL[p?.status]})</p>
            <p className="text-sm text-stone-600">Recebida em {new Date(r.created_at).toLocaleString('pt-BR', { timeZone: 'America/Campo_Grande' })}</p>
            {r.details && <p className="mt-1 text-stone-700">{r.details}</p>}
            {r.status === 'aberta' && (
              <form action={resolveReport} className="mt-3 space-y-2">
                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="provider_id" value={r.provider_id} />
                <input type="hidden" name="back" value={back} />
                <label className="label" htmlFor={`note-${r.id}`}>Nota da avaliação</label>
                <input id={`note-${r.id}`} name="note" className="input" />
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="suspend" className="h-5 w-5" /> Suspender o perfil</label>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="status" value="procedente" className="btn-danger">Procedente</SubmitButton>
                  <SubmitButton name="status" value="improcedente" className="btn-outline">Improcedente</SubmitButton>
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

const PAGE = 50;
async function Perfis({ sb, sp, city, cities }: { sb: SB; sp: SP; city: City | null; cities: City[] }) {
  const catalog = await getCatalog(true);
  const cidade = city?.slug ?? 'todas';
  const status = ['draft', 'published', 'paused', 'suspended'].includes(sp.status ?? '') ? sp.status : undefined;
  const cobertura = ['cidade', 'bairros', 'online', 'pendente'].includes(sp.cobertura ?? '') ? sp.cobertura : undefined;
  const category = catalog.find((c) => c.slug === sp.categoria);
  const page = Math.max(1, Number(sp.pagina) || 1);
  const filters = { cidade, q: sp.q, status, categoria: category?.slug, cobertura, hoje: sp.hoje === '1' ? '1' : undefined, pendente: sp.pendente === '1' ? '1' : undefined };
  const { data, error } = await sb.rpc('admin_providers', {
    p_city_slug: city?.slug ?? null, p_q: sp.q || null, p_status: status ?? null, p_category_slug: category?.slug ?? null,
    p_coverage: cobertura ?? null, p_today: filters.hoje === '1', p_area_pending: filters.pendente === '1',
    p_limit: PAGE, p_offset: (page - 1) * PAGE,
  });
  const rows = (data ?? []) as { id: string; slug: string; display_name: string; status: ProviderStatus; coverage: string; area_pending: boolean; available_today: boolean; area_label: string | null; categories: string | null; total_count: number }[];
  const total = rows[0]?.total_count ?? 0;
  const back = adminHref('perfis', { ...filters, pagina: page > 1 ? String(page) : undefined });
  const active: { label: string; remove: Partial<SP> }[] = [];
  if (filters.q) active.push({ label: `Nome: ${filters.q}`, remove: { q: undefined } });
  if (status) active.push({ label: `Status: ${STATUS_LABEL[status as ProviderStatus]}`, remove: { status: undefined } });
  if (category) active.push({ label: `Categoria: ${category.name}`, remove: { categoria: undefined } });
  if (cobertura) active.push({ label: `Cobertura: ${COVERAGE_LABEL[cobertura]}`, remove: { cobertura: undefined } });
  if (filters.hoje) active.push({ label: 'Atende hoje', remove: { hoje: undefined } });
  if (filters.pendente) active.push({ label: 'Sem área confirmada', remove: { pendente: undefined } });

  return (
    <div className="space-y-3">
      <form className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3" action="/admin" method="get" aria-label="Filtros de prestadores">
        <input type="hidden" name="aba" value="perfis" />
        <div><label htmlFor="pq" className="label">Nome profissional</label>
          <input id="pq" name="q" defaultValue={sp.q} className="input" placeholder="Nome do prestador" /></div>
        <div><label htmlFor="ps" className="label">Status</label>
          <select id="ps" name="status" defaultValue={status ?? ''} className="input">
            <option value="">Todos</option>
            {(['published', 'draft', 'paused', 'suspended'] as const).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select></div>
        <div><label htmlFor="pc" className="label">Categoria</label>
          <select id="pc" name="categoria" defaultValue={category?.slug ?? ''} className="input">
            <option value="">Todas</option>
            {catalog.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select></div>
        <div><label htmlFor="pcob" className="label">Cobertura</label>
          <select id="pcob" name="cobertura" defaultValue={cobertura ?? ''} className="input">
            <option value="">Todas</option>
            {Object.entries(COVERAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label htmlFor="pcid" className="label">Cidade</label>
          <select id="pcid" name="cidade" defaultValue={cidade} className="input">
            {cities.map((c) => <option key={c.id} value={c.slug}>{c.name}–{c.uf}</option>)}
            <option value="todas">Todas as cidades</option>
          </select></div>
        <fieldset className="flex flex-col justify-end">
          <legend className="sr-only">Disponibilidade e pendências</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="hoje" value="1" defaultChecked={!!filters.hoje} className="h-5 w-5" /> Atende hoje</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="pendente" value="1" defaultChecked={!!filters.pendente} className="h-5 w-5" /> Sem área confirmada</label>
        </fieldset>
        <div className="sm:col-span-2 lg:col-span-3"><button className="btn-primary" type="submit">Buscar</button></div>
      </form>

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <p className="font-semibold" data-testid="admin-total">{error ? 'Erro ao carregar' : total === 1 ? '1 prestador' : `${total} prestadores`}</p>
        {active.map((f) => (
          <Link key={f.label} href={adminHref('perfis', { ...filters, ...f.remove })} className="chip" aria-label={`Remover filtro ${f.label}`}>
            {f.label} <span aria-hidden="true">✕</span>
          </Link>
        ))}
      </div>

      {error ? (
        <p role="alert" className="card p-4 text-red-800">Não foi possível carregar a lista. <Link className="underline" href={back}>Tentar novamente</Link></p>
      ) : rows.length === 0 ? (
        <p className="card p-4">Nenhum prestador com esses filtros.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start" data-testid="admin-provider">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/p/${p.slug}`} className="font-bold underline">{p.display_name || '(sem nome)'}</Link>
                  <span className={`tag ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  {p.available_today && <span className="badge-hoje">● Atende hoje</span>}
                  {p.area_pending && <span className="tag bg-amber-100 text-amber-900">Área pendente</span>}
                </p>
                <p className="mt-1 text-sm text-stone-700">{COVERAGE_LABEL[p.coverage]}{p.area_label ? ` · ${p.area_label}` : ''}</p>
                {p.categories && <p className="text-sm text-stone-600">{p.categories}</p>}
              </div>
              {p.status !== 'draft' && (
                <ConfirmStatus providerId={p.id} name={p.display_name || '(sem nome)'} suspended={p.status === 'suspended'} back={back} />
              )}
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Paginação" className="flex justify-between">
        {page > 1 ? <Link className="btn-ghost" href={adminHref('perfis', { ...filters, pagina: String(page - 1) })}>← Anterior</Link> : <span />}
        {page * PAGE < total && <Link className="btn-ghost" href={adminHref('perfis', { ...filters, pagina: String(page + 1) })}>Próxima →</Link>}
      </nav>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  suspender_perfil: 'Suspendeu perfil', reativar_perfil: 'Reativou perfil', avaliar_denuncia: 'Avaliou denúncia',
  insert: 'Criou', update: 'Alterou', delete: 'Removeu',
};
const TARGET_LABEL: Record<string, string> = {
  provider: 'Perfil', report: 'Denúncia', services: 'Serviço', service_categories: 'Categoria', service_synonyms: 'Sinônimo',
  app_settings: 'Configuração', service_suggestions: 'Sugestão',
};

async function Historico({ sb }: { sb: SB }) {
  const { data, error } = await sb.rpc('admin_moderation_log', { p_limit: 150 });
  const rows = (data ?? []) as { id: number; action: string; target_type: string; target_id: string; target_name: string | null; note: string | null; actor_email: string | null; created_at: string }[];
  if (error) return <p role="alert" className="card p-4 text-red-800">Não foi possível carregar o histórico. Tente novamente.</p>;
  return (
    <div className="card overflow-x-auto p-2">
      <table className="w-full text-left text-sm">
        <thead><tr className="text-stone-600"><th className="p-2">Quando</th><th className="p-2">Responsável</th><th className="p-2">Ação</th><th className="p-2">Alvo</th><th className="p-2">Motivo ou detalhe</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td className="p-2" colSpan={5}>Nenhuma ação registrada.</td></tr>}
          {rows.map((l) => (
            <tr key={l.id} className="border-t border-stone-100 align-top">
              <td className="whitespace-nowrap p-2">{new Date(l.created_at).toLocaleString('pt-BR', { timeZone: 'America/Campo_Grande' })}</td>
              <td className="p-2">{l.actor_email ?? '—'}</td>
              <td className="p-2">{ACTION_LABEL[l.action] ?? l.action}</td>
              <td className="p-2">{TARGET_LABEL[l.target_type] ?? l.target_type}{l.target_name ? `: ${l.target_name}` : ` #${l.target_id.slice(0, 8)}`}</td>
              <td className="p-2">{l.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Config() {
  const cpf = await getSetting<CpfSetting>('cpf_collection');
  return (
    <form action={saveCpfSetting} className="card max-w-2xl space-y-3 p-5">
      <h2 className="text-lg font-bold">Coleta de CPF dos prestadores</h2>
      <p className="text-stone-700">Desligada por padrão (princípio da necessidade, LGPD art. 6º, III). Para habilitar, o responsável pela operação define a finalidade e confirma a necessidade. O texto da finalidade aparece no aviso ao prestador.</p>
      <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={cpf?.enabled} className="h-5 w-5" /> Coletar CPF no cadastro</label>
      <label htmlFor="purpose" className="label">Finalidade</label>
      <textarea id="purpose" name="purpose" rows={3} defaultValue={cpf?.purpose ?? ''} className="input" />
      <label className="flex items-start gap-2"><input type="checkbox" name="necessity_confirmed" defaultChecked={cpf?.necessity_confirmed} className="mt-1 h-5 w-5" /> Confirmo que o CPF é necessário para essa finalidade e que não há alternativa menos invasiva.</label>
      <SubmitButton>Salvar</SubmitButton>
    </form>
  );
}

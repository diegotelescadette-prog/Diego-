import Link from 'next/link';
import type { Metadata } from 'next';
import { FiltersPanel } from '@/components/FiltersPanel';
import { ContinueContact, ProviderCard } from '@/components/ProviderCard';
import { getAllServices, getCatalog, getCities, getNeighborhoods, getPilotCity, getUser, photoUrl } from '@/lib/data';
import { generalMessage } from '@/lib/whatsapp';
import { createClient } from '@/lib/supabase/server';
import type { ProviderCardData } from '@/lib/types';
import { track } from '@/lib/usage';

export const metadata: Metadata = { title: 'Buscar serviços' };
export const dynamic = 'force-dynamic';

type SP = { q?: string; servico?: string; categoria?: string; cidade?: string; bairro?: string; online?: string; hoje?: string; pagina?: string; chamar?: string };
const PAGE = 20;

function href(sp: SP, patch: Partial<SP>) {
  const merged = { ...sp, ...patch, pagina: patch.pagina };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, String(v));
  const s = qs.toString();
  return `/buscar${s ? `?${s}` : ''}`;
}

export default async function BuscarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const online = sp.online === '1';
  const today = sp.hoje === '1';
  const page = Math.max(1, Number(sp.pagina) || 1);

  const [catalog, services, cities, pilot, user] = await Promise.all([getCatalog(), getAllServices(), getCities(), getPilotCity(), getUser()]);
  // Campo Grande já vem selecionada; "todas" desliga o filtro de cidade.
  const city = sp.cidade === 'todas' ? undefined : cities.find((c) => c.slug === (sp.cidade ?? pilot.slug));
  const category = catalog.find((c) => c.slug === sp.categoria);
  const neighborhoods = city ? await getNeighborhoods(city.id) : [];
  const neighborhood = neighborhoods.find((n) => n.slug === sp.bairro);
  const service = services.find((s) => s.slug === sp.servico);

  const supabase = await createClient();
  const [{ data, error }, matched] = await Promise.all([
    supabase.rpc('search_providers', {
      p_q: q || null, p_service_slug: service?.slug ?? null, p_city_slug: city?.slug ?? null,
      p_neighborhood_slug: neighborhood?.slug ?? null, p_online: online, p_today: today, p_category_slug: category?.slug ?? null,
      p_limit: PAGE, p_offset: (page - 1) * PAGE,
    }),
    q ? supabase.rpc('query_service_ids', { p_q: q }) : Promise.resolve({ data: [] as { service_id: number }[] }),
  ]);
  const results = (data ?? []) as (ProviderCardData & { total_count: number })[];
  const total = results[0]?.total_count ?? 0;
  if (!error && page === 1 && (q || service || category)) {
    const only = (matched.data ?? []).length === 1 ? (matched.data as { service_id: number }[])[0].service_id : null;
    await track('busca', { serviceId: service?.id ?? only, categoryId: category?.id ?? null, cityId: city?.id ?? null, results: total });
  }
  const matchedNames = services.filter((s) => (matched.data ?? []).some((m: { service_id: number }) => m.service_id === s.id)).map((s) => s.name);

  const applied: { label: string; remove: Partial<SP> }[] = [];
  if (service) applied.push({ label: `Serviço: ${service.name}`, remove: { servico: undefined } });
  if (category) applied.push({ label: `Categoria: ${category.name}`, remove: { categoria: undefined } });
  if (city && city.slug !== pilot.slug) applied.push({ label: `Cidade: ${city.name}–${city.uf}`, remove: { cidade: undefined, bairro: undefined } });
  if (neighborhood) applied.push({ label: `Bairro: ${neighborhood.name}`, remove: { bairro: undefined } });
  if (online) applied.push({ label: 'Atendimento online', remove: { online: undefined } });
  if (today) applied.push({ label: 'Atende hoje', remove: { hoje: undefined } });

  const ctx = new URLSearchParams();
  if (service) ctx.set('servico', service.slug);
  if (neighborhood) ctx.set('bairro', neighborhood.slug);
  if (city) ctx.set('cidade', city.slug);
  if (online) ctx.set('online', '1');

  // Mensagem do card (busca geral). Local: bairro + cidade, ou só a cidade.
  const place = neighborhood ? `${neighborhood.name}, ${city?.name}` : city?.name ?? null;
  const messageFor = (p: ProviderCardData) => generalMessage(service?.name ?? p.main_service ?? 'um serviço', place, online || (!place && p.serves_online));
  const returnTo = href({ ...sp, chamar: undefined }, { pagina: sp.pagina });
  const pending = user && sp.chamar ? results.find((r) => r.slug === sp.chamar) : undefined;
  ctx.set('voltar', returnTo); // "Voltar aos resultados" no perfil mantém todos os filtros
  const ctxStr = `?${ctx}`;
  const countText = error ? null : total === 1 ? '1 prestador encontrado' : `${total} prestadores encontrados`;

  return (
    <div>
      <h1 className="text-2xl font-extrabold sm:text-3xl">Buscar serviços</h1>
      <form action="/buscar" method="get" role="search" className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="q" className="sr-only">Nome, serviço ou problema</label>
        <input id="q" name="q" defaultValue={q} className="input" placeholder="Nome, serviço ou problema (ex.: vazamento)" />
        {service && <input type="hidden" name="servico" value={service.slug} />}
        {category && <input type="hidden" name="categoria" value={category.slug} />}
        {city && <input type="hidden" name="cidade" value={city.slug} />}
        {neighborhood && <input type="hidden" name="bairro" value={neighborhood.slug} />}
        {online && <input type="hidden" name="online" value="1" />}
        {today && <input type="hidden" name="hoje" value="1" />}
        <button className="btn-primary" type="submit">Buscar</button>
      </form>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="lg:order-2">
          <FiltersPanel count={applied.length} summary={countText ? <span data-testid="result-count">{countText}</span> : null}>
            <form action="/buscar" method="get" className="space-y-4">
              {q && <input type="hidden" name="q" value={q} />}
              <div>
                <label htmlFor="f-categoria" className="label">Categoria</label>
                <select id="f-categoria" name="categoria" defaultValue={category?.slug ?? ''} className="input">
                  <option value="">Todas as categorias</option>
                  {catalog.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="f-servico" className="label">Serviço</label>
                <select id="f-servico" name="servico" defaultValue={service?.slug ?? ''} className="input">
                  <option value="">Todos os serviços</option>
                  {catalog.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      {c.services.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="f-cidade" className="label">Cidade</label>
                <select id="f-cidade" name="cidade" defaultValue={city?.slug ?? 'todas'} className="input">
                  <option value="todas">Todas as cidades</option>
                  {cities.map((c) => <option key={c.id} value={c.slug}>{c.name}–{c.uf}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="f-bairro" className="label">Bairro</label>
                <select id="f-bairro" name="bairro" defaultValue={neighborhood?.slug ?? ''} className="input" disabled={!city}>
                  <option value="">{city ? 'Todos os bairros' : 'Escolha a cidade primeiro'}</option>
                  {neighborhoods.map((n) => <option key={n.id} value={n.slug}>{n.name}</option>)}
                </select>
              </div>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="online" value="1" defaultChecked={online} className="h-5 w-5" /> Atendimento online
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="hoje" value="1" defaultChecked={today} className="h-5 w-5" /> Atende hoje
              </label>
              <button className="btn-primary w-full" type="submit">Aplicar filtros</button>
            </form>
          </FiltersPanel>
        </div>

        <section aria-labelledby="resultados" aria-live="polite" className="min-w-0 lg:order-1">
          <h2 id="resultados" className="sr-only">Resultados</h2>
          {pending && <ContinueContact providerId={pending.id} message={messageFor(pending)} cleanUrl={returnTo} />}
          {applied.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {applied.map((f) => (
                <Link key={f.label} href={href(sp, f.remove)} className="chip" aria-label={`Remover filtro ${f.label}`}>
                  {f.label} <span aria-hidden="true">✕</span>
                </Link>
              ))}
              <Link href={href({ q }, {})} className="text-sm font-semibold text-brand-700 underline">Limpar filtros</Link>
            </div>
          )}
          {q && matchedNames.length > 0 && (
            <p className="mb-3 text-sm text-stone-700">“{q}” inclui: {matchedNames.join(', ')}</p>
          )}
          {online && (city || neighborhood) && (
            <p className="mb-3 text-sm text-stone-700">Atendimento online vale para qualquer cidade, por isso o local não restringe esses resultados.</p>
          )}

          {error ? (
            <div className="card p-5" role="alert">
              <p className="font-semibold">Não conseguimos carregar a busca.</p>
              <Link className="btn-outline mt-3" href={href(sp, {})}>Tentar novamente</Link>
            </div>
          ) : results.length === 0 ? (
            <div className="card p-6" data-testid="empty-search">
              {service && !q && !neighborhood && !today && !online ? (
                <p className="text-lg font-semibold" data-testid="cadastrando">Estamos cadastrando profissionais para este serviço.</p>
              ) : (
                <p className="text-lg font-semibold">Nenhum prestador encontrado{q ? ` para “${q}”` : ''}.</p>
              )}
              <p className="mt-1 text-stone-700">Tente retirar um filtro ou procurar na cidade inteira:</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {neighborhood && <li><Link className="btn-primary" href={href(sp, { bairro: undefined })}>Buscar em toda {city?.name}</Link></li>}
                {applied.filter((f) => !f.label.startsWith('Bairro')).map((f) => (
                  <li key={f.label}><Link className="btn-outline" href={href(sp, f.remove)}>Retirar “{f.label}”</Link></li>
                ))}
                {q && <li><Link className="btn-ghost" href={href({ ...sp, q: undefined }, {})}>Buscar sem o termo “{q}”</Link></li>}
              </ul>
            </div>
          ) : (
            <>
              <p className="mb-3 hidden font-semibold text-stone-800 lg:block">{countText}</p>
              <ul className="grid gap-3 xl:grid-cols-2">
                {results.map((p) => (
                  <ProviderCard key={p.id} p={p} photo={photoUrl(p.photo_path)} query={ctxStr}
                    contact={{ loggedIn: !!user, message: messageFor(p), returnTo }} />
                ))}
              </ul>
              {neighborhood && total < 3 && (
                <p className="mt-4 rounded-xl bg-brand-50 p-3">
                  Poucos resultados no bairro. <Link className="font-semibold text-brand-700 underline" href={href(sp, { bairro: undefined })}>Ampliar para toda {city?.name}</Link>
                </p>
              )}
              <nav aria-label="Paginação" className="mt-4 flex justify-between">
                {page > 1 ? <Link className="btn-ghost" href={href(sp, { pagina: String(page - 1) })}>← Anterior</Link> : <span />}
                {page * PAGE < total && <Link className="btn-ghost" href={href(sp, { pagina: String(page + 1) })}>Próxima →</Link>}
              </nav>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

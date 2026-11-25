import Link from 'next/link';
import { UrgentForm, toUrgentList } from '@/components/UrgentForm';
import { CategoryIcon, Glyph, PIN_PATH } from '@/components/CategoryIcon';
import { getCatalog, getNeighborhoods, getPilotCity, getSynonymsByService, getUrgentCatalog } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { PILOT_CITY_LABEL, URGENT_TAGLINE } from '@/config/brand';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const city = await getPilotCity();
  const supabase = await createClient();
  const [urgent, catalog, synonyms, neighborhoods, live] = await Promise.all([
    getUrgentCatalog(), getCatalog(), getSynonymsByService(), getNeighborhoods(city.id),
    supabase.rpc('search_providers', { p_city_slug: city.slug, p_today: true, p_limit: 1 }),
  ]);
  const online = Number((live.data as { total_count: number }[] | null)?.[0]?.total_count ?? 0);
  // Primeiras categorias sempre à vista; o resto abre em "Ver mais categorias".
  const SHOWN = 6;
  const catLink = (c: (typeof catalog)[number]) => (
    <li key={c.slug}>
      <Link href={`/buscar?categoria=${c.slug}&cidade=${city.slug}`} className="catbtn">
        <CategoryIcon slug={c.slug} />
        <span>{c.name}</span>
      </Link>
    </li>
  );
  return (
    <div className="space-y-8">
      <div id="preciso-para-hoje">
        <section aria-labelledby="hoje-titulo" className="band">
          <span className="chip-dark"><Glyph d={PIN_PATH} size={16} /> {PILOT_CITY_LABEL}</span>
          <h1 id="hoje-titulo" className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Preciso para hoje</h1>
          <p className="mt-2 max-w-xl text-lg text-white/90">{URGENT_TAGLINE}</p>
          {online > 0 && (
            <p className="live mt-3"><span className="dot" />{online === 1 ? '1 profissional disponível' : `${online} profissionais disponíveis`} hoje na cidade</p>
          )}
        </section>
        <div className="card lift p-5 sm:p-6">
          <UrgentForm categories={toUrgentList(urgent, synonyms)} neighborhoods={neighborhoods} home />
        </div>
      </div>

      <section aria-labelledby="busca-titulo" id="categorias">
        <h2 id="busca-titulo" className="text-xl font-bold">Sem pressa? Busque e compare</h2>
        <p className="mt-1 text-stone-700">Veja perfis e fotos dos profissionais e escolha com calma.</p>
        <form action="/buscar" method="get" role="search" className="mt-3">
          <div className="sb-row">
            <Glyph d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={20} />
            <input id="q-home" name="q" aria-label="O que você procura?" placeholder="Serviço ou nome do profissional" />
            <input type="hidden" name="cidade" value={city.slug} />
            <button className="btn-primary min-h-10 px-4 text-sm" type="submit" aria-label="Buscar prestadores">Buscar</button>
          </div>
        </form>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{catalog.slice(0, SHOWN).map(catLink)}</ul>
        {catalog.length > SHOWN && (
          <details className="morecats mt-2">
            <summary className="cursor-pointer py-2 text-sm font-semibold text-brand-700 underline">Ver mais {catalog.length - SHOWN} categorias</summary>
            <ul className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">{catalog.slice(SHOWN).map(catLink)}</ul>
          </details>
        )}
      </section>

      <section aria-label="Mais no Resolve Aqui" className="grid gap-3 sm:grid-cols-2">
        <div className="card p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold">Vagas de emprego</h2>
          <p className="mt-1 text-stone-700">Contratando ou procurando trabalho em Campo Grande? É grátis.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/vagas/nova" className="btn-primary px-3 text-center text-sm">Oferecer trabalho</Link>
            <Link href="/vagas" className="btn-outline px-3 text-center text-sm">Enviar currículo</Link>
          </div>
        </div>
        <div className="card pro p-5">
          <h2 className="text-lg font-bold">Você é prestador?</h2>
          <p className="mt-1 text-stone-700">Crie seu perfil grátis pelo celular e receba clientes no WhatsApp.</p>
          <Link href="/sou-prestador" className="btn-hoje mt-3 w-full text-sm">Quero oferecer meus serviços</Link>
        </div>
      </section>
    </div>
  );
}

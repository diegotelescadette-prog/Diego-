import Link from 'next/link';
import { UrgentForm, toUrgentList } from '@/components/UrgentForm';
import { CategoryIcon, Glyph, PIN_PATH, WhatsAppIcon } from '@/components/CategoryIcon';
import { getCatalog, getNeighborhoods, getPilotCity, getSynonymsByService, getUrgentCatalog } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { PILOT_CITY_LABEL, PILOT_TAGLINE, URGENT_TAGLINE } from '@/config/brand';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const city = await getPilotCity();
  const supabase = await createClient();
  const [urgent, catalog, synonyms, neighborhoods, live] = await Promise.all([
    getUrgentCatalog(), getCatalog(), getSynonymsByService(), getNeighborhoods(city.id),
    supabase.rpc('search_providers', { p_city_slug: city.slug, p_today: true, p_limit: 1 }),
  ]);
  const online = Number((live.data as { total_count: number }[] | null)?.[0]?.total_count ?? 0);
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{PILOT_TAGLINE}</h1>
      <div id="preciso-para-hoje">
        <section aria-labelledby="hoje-titulo" className="band">
          <span className="chip-dark"><Glyph d={PIN_PATH} size={16} /> {PILOT_CITY_LABEL}</span>
          <h2 id="hoje-titulo" className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Preciso para hoje</h2>
          <p className="mt-2 max-w-xl text-lg text-white/90">{URGENT_TAGLINE}</p>
          {online > 0 && (
            <p className="live mt-3"><span className="dot" />{online === 1 ? '1 profissional disponível' : `${online} profissionais disponíveis`} hoje na cidade</p>
          )}
        </section>
        <div className="card lift p-5 sm:p-6">
          <UrgentForm categories={toUrgentList(urgent, synonyms)} neighborhoods={neighborhoods} />
          <p className="mt-4 flex items-center gap-2 text-sm text-stone-600">
            <span className="text-zap-600"><WhatsAppIcon size={20} /></span>Sem cadastro: um toque e você fala com o profissional.
          </p>
        </div>
      </div>

      <section aria-labelledby="busca-titulo">
        <form action="/buscar" method="get" role="search">
          <label htmlFor="q-home" className="mb-2 block text-xl font-bold" id="busca-titulo">Buscar prestadores</label>
          <div className="sb-row">
            <Glyph d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={20} />
            <input id="q-home" name="q" aria-label="O que você procura?" placeholder="Serviço, nome ou problema: vazamento, pintor…" />
            <input type="hidden" name="cidade" value={city.slug} />
            <button className="btn-primary min-h-10 px-3 text-sm" type="submit">Buscar prestadores</button>
          </div>
        </form>
      </section>

      <section aria-labelledby="cats-titulo" id="categorias">
        <h2 id="cats-titulo" className="text-xl font-bold">Explore por categoria</h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {catalog.map((c) => (
            <li key={c.slug}>
              <Link href={`/buscar?categoria=${c.slug}&cidade=${city.slug}`} className="catbtn">
                <CategoryIcon slug={c.slug} />
                <span>{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="prestador-titulo" className="card pro flex flex-wrap items-center gap-4 p-5 sm:p-6">
        <div className="min-w-0 flex-1">
          <h2 id="prestador-titulo" className="text-xl font-bold">Você é prestador?</h2>
          <p className="mt-1 text-stone-700">Crie seu perfil pelo celular em duas etapas, diga quais bairros você atende e avise quando estiver disponível hoje.</p>
        </div>
        <Link href="/sou-prestador" className="btn-hoje">Quero oferecer meus serviços</Link>
      </section>
    </div>
  );
}

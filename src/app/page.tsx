import Link from 'next/link';
import { UrgentForm } from '@/components/UrgentForm';
import { getNeighborhoods, getPilotCity, getUrgentServices } from '@/lib/data';
import { PILOT_CITY_LABEL, PILOT_TAGLINE } from '@/config/brand';

export default async function Home() {
  const city = await getPilotCity();
  const [services, neighborhoods] = await Promise.all([getUrgentServices(), getNeighborhoods(city.id)]);
  return (
    <div className="space-y-8">
      <section aria-labelledby="hoje-titulo" className="card overflow-hidden border-hoje-500/40">
        <div className="bg-gradient-to-br from-orange-50 to-white p-5 sm:p-8">
          <p className="chip mb-3 border-hoje-500 bg-white text-hoje-700">📍 {PILOT_CITY_LABEL}</p>
          <h1 id="hoje-titulo" className="text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl">Preciso para hoje</h1>
          <p className="mt-2 max-w-2xl text-lg text-stone-700">{PILOT_TAGLINE}</p>
          <div className="mt-6"><UrgentForm services={services} neighborhoods={neighborhoods} /></div>
          <p className="mt-4 text-sm text-stone-600">Sem cadastro: você fala direto com o profissional pelo WhatsApp.</p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="busca-titulo" className="card p-5 sm:p-6">
          <h2 id="busca-titulo" className="text-xl font-bold">Buscar prestadores</h2>
          <p className="mt-1 text-stone-700">Pesquise por serviço, nome, bairro ou problema — como “vazamento”, “limpar piscina” ou “formatar computador” — e combine com antecedência.</p>
          <form action="/buscar" method="get" className="mt-4 flex flex-col gap-2 sm:flex-row" role="search">
            <label htmlFor="q-home" className="sr-only">O que você procura?</label>
            <input id="q-home" name="q" className="input" placeholder="Ex.: pintor, diarista, vazamento" />
            <input type="hidden" name="cidade" value={city.slug} />
            <button className="btn-primary" type="submit">Buscar prestadores</button>
          </form>
        </section>
        <section aria-labelledby="prestador-titulo" className="card p-5 sm:p-6">
          <h2 id="prestador-titulo" className="text-xl font-bold">Sou prestador</h2>
          <p className="mt-1 text-stone-700">Crie seu perfil pelo celular em duas etapas, diga quais bairros você atende e marque quando estiver disponível hoje.</p>
          <Link href="/sou-prestador" className="btn-outline mt-4">Quero oferecer meus serviços</Link>
        </section>
      </div>
    </div>
  );
}

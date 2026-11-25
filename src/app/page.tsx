import Link from 'next/link';
import { FeedPost } from '@/components/FeedPost';
import { Avatar } from '@/components/Avatar';
import { Glyph } from '@/components/CategoryIcon';
import { getCatalog, getPilotCity, getUser } from '@/lib/data';
import { getFeed, getLatestJobs } from '@/lib/feed';
import { generalMessage } from '@/lib/whatsapp';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const BOLT = 'M13 2 4 14h7l-1 8 9-12h-7z';
const CAMERA = 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 1 0 .01 0';

/** Tela inicial: busca no topo e, embaixo, os trabalhos que os prestadores da cidade publicam. */
export default async function Home() {
  const city = await getPilotCity();
  const user = await getUser();
  const supabase = await createClient();
  const [catalog, feed, jobs, own] = await Promise.all([
    getCatalog(), getFeed(city.slug), getLatestJobs(),
    user ? supabase.from('provider_profiles').select('id').eq('id', user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const isProvider = !!own.data;
  const today = feed.filter((p) => p.availableToday);
  const place = `${city.name}`;

  return (
    <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
      <div className="min-w-0 space-y-4">
        <h1 className="sr-only">Resolve Aqui: prestadores de serviço em {city.name}</h1>
        <section aria-label="Buscar" className="space-y-3">
          <form action="/buscar" method="get" role="search">
            <div className="sb-row sb-big">
              <Glyph d={SEARCH} size={22} />
              <input name="q" aria-label="Que serviço você procura?" placeholder="Que serviço você procura?" enterKeyHint="search" />
              <input type="hidden" name="cidade" value={city.slug} />
              <button className="btn-primary min-h-11 px-4" type="submit" aria-label="Buscar prestadores">Buscar</button>
            </div>
          </form>
          <nav aria-label="Atalhos" className="chips-row">
            <Link href="/hoje" className="qchip qchip-hot"><Glyph d={BOLT} size={16} /> Preciso para hoje</Link>
            {catalog.slice(0, 10).map((c) => (
              <Link key={c.slug} href={`/buscar?categoria=${c.slug}&cidade=${city.slug}`} className="qchip">{c.name}</Link>
            ))}
            <Link href="/buscar" className="qchip">Todas as categorias</Link>
          </nav>
        </section>

        <Link href={isProvider ? '/painel/servicos' : '/sou-prestador'} className="post composer" data-testid="composer">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-brand-50 text-brand-700"><Glyph d={CAMERA} size={22} /></span>
          <span className="composer-in">{isProvider ? 'Mostre um trabalho seu: adicione fotos' : 'É prestador? Mostre seus trabalhos aqui'}</span>
        </Link>

        <section aria-labelledby="feed-titulo" className="space-y-4">
          <h2 id="feed-titulo" className="px-1 text-lg font-bold">Trabalhos em {city.name}</h2>
          {feed.length ? feed.map((p) => (
            <FeedPost key={p.id} post={p} loggedIn={!!user} message={generalMessage(p.service ?? 'um serviço', place, false)} />
          )) : (
            <div className="post p-5 text-stone-700">Ainda não há prestadores publicados. <Link href="/sou-prestador" className="font-semibold text-brand-700 underline">Seja o primeiro</Link>.</div>
          )}
          {feed.length > 0 && <Link href="/buscar" className="btn-outline w-full">Ver todos os prestadores</Link>}
        </section>
      </div>

      <aside className="mt-6 space-y-4 lg:sticky lg:top-20 lg:mt-0 lg:self-start" aria-label="Destaques">
        <section className="post p-4" aria-labelledby="hoje-lado">
          <h2 id="hoje-lado" className="flex items-center gap-2 font-bold text-hoje-700"><Glyph d={BOLT} size={18} /> Atendem hoje</h2>
          {today.length ? (
            <ul className="mt-2 space-y-1">
              {today.slice(0, 5).map((p) => (
                <li key={p.id}><Link href={`/p/${p.slug}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-stone-50">
                  <Avatar src={p.avatar} name={p.name} size={36} />
                  <span className="min-w-0 text-sm"><span className="block truncate font-semibold">{p.name}</span><span className="block truncate text-stone-600">{p.service}</span></span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-stone-600">Ninguém confirmou ainda hoje.</p>}
          <Link href="/hoje" className="btn-hoje mt-3 w-full text-sm">Preciso para hoje</Link>
        </section>
        <section className="post p-4" aria-labelledby="vagas-lado">
          <h2 id="vagas-lado" className="font-bold">Vagas de emprego</h2>
          {jobs.length > 0 && (
            <ul className="mt-2 space-y-2 text-sm">
              {jobs.map((j) => <li key={j.id}><Link href={`/vagas/${j.id}`} className="block hover:underline"><span className="font-semibold">{j.title}</span><span className="block text-stone-600">{j.company}{j.place ? ` · ${j.place}` : ''}</span></Link></li>)}
            </ul>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/vagas/nova" className="btn-primary px-2 text-center text-sm">Oferecer trabalho</Link>
            <Link href="/vagas" className="btn-outline px-2 text-center text-sm">Enviar currículo</Link>
          </div>
        </section>
      </aside>
    </div>
  );
}

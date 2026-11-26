import Link from 'next/link';
import { PostCard } from '@/components/PostCard';
import { Avatar } from '@/components/Avatar';
import { CategoryIcon, Glyph } from '@/components/CategoryIcon';
import { Guarantee, HowItWorks, PackageCard } from '@/components/PackageCard';
import { getPackageCategories, getPackages } from '@/lib/booking';
import { formatPrice } from '@/lib/booking-shared';
import { getPilotCity, getUser } from '@/lib/data';
import { getFeed, getLatestJobs } from '@/lib/feed';
import { getPosts } from '@/lib/posts';
import { createClient } from '@/lib/supabase/server';
import { generalMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';

function greeting(timeZone: string) {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

async function firstName(userId: string | undefined) {
  if (!userId) return null;
  const supabase = await createClient();
  const [{ data: nm }, { data: prof }] = await Promise.all([
    supabase.from('member_names').select('name').eq('user_id', userId).maybeSingle(),
    supabase.from('provider_profiles').select('display_name').eq('id', userId).maybeSingle(),
  ]);
  const name = (nm?.name ?? prof?.display_name ?? '').trim();
  return name ? name.split(/\s+/)[0] : null;
}

/**
 * Tela inicial: busca e "Preciso para hoje", categorias, serviços com preço fixo mais pedidos, como funciona e garantia.
 * Comunidade, profissionais e vagas ficam no fim, e cada seção só aparece quando tem conteúdo.
 */
export default async function Home() {
  const city = await getPilotCity();
  const user = await getUser();
  const [cats, pkgs, feed, jobs, posts, name] = await Promise.all([
    getPackageCategories(), getPackages(), getFeed(city.slug), getLatestJobs(), getPosts({ citySlug: city.slug, limit: 3 }), firstName(user?.id),
  ]);
  const featured = [...pkgs.filter((p) => p.featured), ...pkgs.filter((p) => !p.featured)].slice(0, 6);
  const near = feed.slice(0, 12);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-4">
        <div>
          <p className="font-semibold text-stone-500">{greeting(city.timezone || 'America/Campo_Grande')}{name ? `, ${name}` : ''}</p>
          <h1 className="text-[28px] font-bold leading-tight text-stone-900 sm:text-4xl">O que você precisa resolver hoje?</h1>
        </div>
        <form action="/buscar" method="get" role="search" data-testid="home-search">
          <div className="home-search">
            <Glyph d={SEARCH} size={20} />
            <input name="q" aria-label="Buscar serviço ou profissional" placeholder="Ex.: trocar chuveiro, diarista, chaveiro" enterKeyHint="search" />
            <input type="hidden" name="cidade" value={city.slug} />
            <button className="btn-primary min-h-10 rounded-xl px-4" type="submit">Buscar</button>
          </div>
        </form>
        <Link href="/hoje" className="hero-today sm:max-w-xs" data-testid="cta-hoje">Preciso para hoje <span aria-hidden="true">⚡</span></Link>
      </header>

      {cats.length > 0 && (
        <section aria-labelledby="cat-t" data-testid="home-categories">
          <h2 id="cat-t" className="mb-3 text-lg font-bold text-stone-800">Categorias</h2>
          <nav aria-label="Categorias de serviço" className="cat-grid">
            {cats.map((c) => (
              <Link key={c.slug} href={`/servicos/${c.slug}`} className="cat-tile">
                <CategoryIcon slug={c.slug} />{c.name}<small>a partir de {formatPrice(c.min)}</small>
              </Link>
            ))}
          </nav>
        </section>
      )}

      {featured.length > 0 && (
        <section aria-labelledby="mais-t" data-testid="most-requested">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="mais-t" className="text-lg font-bold text-stone-800">Mais pedidos em {city.name}</h2>
            <Link href="/servicos" className="text-sm font-semibold text-brand-700 hover:underline">Ver todos</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p) => <PackageCard key={p.id} p={p} compact />)}
          </div>
        </section>
      )}

      <HowItWorks />
      <Guarantee />

      {near.length > 0 && (
        <section aria-labelledby="perto-t" data-testid="near-you">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="perto-t" className="text-lg font-bold text-stone-800">Profissionais perto de você</h2>
            <Link href={`/buscar?cidade=${city.slug}`} className="text-sm font-semibold text-brand-700 hover:underline">Ver todos</Link>
          </div>
          <ul className="near-row">
            {near.map((p) => (
              <li key={p.id}>
                <Link href={`/p/${p.slug}`} className="near-item" data-testid="near-item">
                  <span className={`near-ring${p.availableToday ? ' near-today' : ''}`}><Avatar src={p.avatar} name={p.name} size={68} round /></span>
                  <span className="near-name">{p.name}</span>
                  <span className="near-svc">{p.availableToday ? <span className="text-hoje-700">● Atende hoje</span> : p.service}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {posts.length > 0 && (
        <section aria-labelledby="feed-titulo" className="space-y-4" data-testid="home-community">
          <div className="flex items-baseline justify-between">
            <h2 id="feed-titulo" className="text-lg font-bold text-stone-800">Da comunidade</h2>
            <Link href="/comunidade" className="text-sm font-semibold text-brand-700 hover:underline">Ver comunidade</Link>
          </div>
          {posts.map((p) => (
            <PostCard key={p.id} post={p} viewerId={user?.id ?? null} message={generalMessage(p.service ?? p.category ?? 'um serviço', city.name, false)} />
          ))}
        </section>
      )}

      {jobs.length > 0 && (
        <section aria-labelledby="vagas-t" className="post p-4" data-testid="home-jobs">
          <div className="flex items-baseline justify-between">
            <h2 id="vagas-t" className="font-bold text-stone-800">Vagas de emprego</h2>
            <Link href="/vagas" className="text-sm font-semibold text-brand-700 hover:underline">Ver vagas</Link>
          </div>
          <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            {jobs.map((j) => <li key={j.id}><Link href={`/vagas/${j.id}`} className="block rounded-xl p-1.5 hover:bg-paper"><span className="font-semibold">{j.title}</span><span className="block text-stone-600">{j.company}{j.place ? ` · ${j.place}` : ''}</span></Link></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

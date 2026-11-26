import Link from 'next/link';
import { PostCard } from '@/components/PostCard';
import { Avatar } from '@/components/Avatar';
import { Glyph } from '@/components/CategoryIcon';
import { getCatalog, getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { getFeed, getLatestJobs } from '@/lib/feed';
import { getPosts } from '@/lib/posts';
import { encodeCursor, feedHref, hasFilters, KIND_LABEL, readFilters, type PostView } from '@/lib/posts-shared';
import { createClient } from '@/lib/supabase/server';
import { generalMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const BOLT = 'M13 2 4 14h7l-1 8 9-12h-7z';
const PAGE = 12;
const MAX_PAGES = 8;
/** Atalhos de serviço da tela inicial, na ordem de procura mais comum. Só entram os que existem no catálogo. */
const QUICK_SERVICES = ['encanador', 'eletricista', 'diarista', 'pedreiro', 'pintor', 'chaveiro', 'montador-de-moveis', 'jardineiro'];

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

/** Tela inicial limpa: saudação, busca, atalhos de serviço, profissionais perto de você e publicações da comunidade. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = readFilters(sp);
  const pages = Math.min(MAX_PAGES, Math.max(1, Number(Array.isArray(sp.pagina) ? sp.pagina[0] : sp.pagina) || 1));
  const city = await getPilotCity();
  const user = await getUser();
  const filtered = hasFilters(f);

  // "Carregar mais" mantém tudo na mesma URL (?pagina=N): voltar de uma publicação devolve a lista e a posição.
  async function loadPosts(): Promise<{ posts: PostView[]; more: boolean }> {
    const out: PostView[] = [];
    let cursor: PostView | null = null;
    for (let i = 0; i < pages; i++) {
      const page: PostView[] = await getPosts({
        citySlug: city.slug, kind: f.kind, category: f.category, neighborhood: f.neighborhood, limit: PAGE + (i === pages - 1 ? 1 : 0),
        ...(cursor ? { before: cursor.createdAt, beforeId: cursor.id } : {}),
      });
      const more = i === pages - 1 && page.length > PAGE;
      out.push(...page.slice(0, PAGE));
      if (page.length < PAGE || more) return { posts: out, more };
      cursor = page[PAGE - 1];
    }
    return { posts: out, more: false };
  }

  const [catalog, hoods, feed, jobs, { posts, more }, name] = await Promise.all([
    getCatalog(), getNeighborhoods(city.id), getFeed(city.slug), getLatestJobs(), loadPosts(), firstName(user?.id),
  ]);
  const services = catalog.flatMap((c) => c.services);
  const quick = QUICK_SERVICES.flatMap((slug) => services.filter((s) => s.slug === slug)).slice(0, 6);
  const near = feed.slice(0, 12);
  const today = feed.filter((p) => p.availableToday);
  const catName = catalog.find((c) => c.slug === f.category)?.name;
  const hoodName = hoods.find((n) => n.id === f.neighborhood)?.name;
  const publishHref = (tipo: string) => `/publicar?tipo=${tipo}${f.category ? `&categoria=${f.category}` : ''}`;

  return (
    <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
      <div className="min-w-0 space-y-6">
        <header className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold leading-tight text-stone-800 sm:text-3xl">{greeting(city.timezone || 'America/Campo_Grande')}{name ? `, ${name}` : ''}</h1>
            <p className="mt-0.5 text-stone-600">O que você precisa hoje em {city.name}?</p>
          </div>
          <form action="/buscar" method="get" role="search" data-testid="home-search">
            <div className="home-search">
              <Glyph d={SEARCH} size={20} />
              <input name="q" aria-label="Buscar serviço ou profissional" placeholder="Buscar serviço ou profissional" enterKeyHint="search" />
              <input type="hidden" name="cidade" value={city.slug} />
              <button className="btn-primary min-h-10 rounded-xl px-4" type="submit">Buscar</button>
            </div>
          </form>
          <nav aria-label="Atalhos de serviço" className="chips-row" data-testid="quick-services">
            <Link href="/hoje" className="soft-chip soft-chip-hoje" data-testid="cta-hoje"><Glyph d={BOLT} size={15} /> Para hoje</Link>
            {quick.map((s) => <Link key={s.slug} href={`/buscar?servico=${s.slug}&cidade=${city.slug}`} className="soft-chip">{s.name}</Link>)}
            <Link href={`/buscar?cidade=${city.slug}`} className="soft-chip">Todos os serviços</Link>
          </nav>
        </header>

        {near.length > 0 && !filtered && (
          <section aria-labelledby="perto-t" data-testid="near-you">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="perto-t" className="text-lg font-bold text-stone-800">Perto de você</h2>
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

        <section aria-labelledby="feed-titulo" className="space-y-4" id="feed">
          <h2 id="feed-titulo" className="text-lg font-bold text-stone-800">Da comunidade</h2>
          {filtered && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="active-filters">
              <span className="font-semibold text-stone-700">Mostrando:</span>
              {f.kind && <Link href={feedHref(f, { kind: null })} className="filter-chip" aria-label={`Tirar filtro ${KIND_LABEL[f.kind]}`}>{KIND_LABEL[f.kind]} ✕</Link>}
              {catName && <Link href={feedHref(f, { category: null })} className="filter-chip" aria-label={`Tirar filtro ${catName}`}>{catName} ✕</Link>}
              {hoodName && <Link href={feedHref(f, { neighborhood: null })} className="filter-chip" aria-label={`Tirar filtro ${hoodName}`}>{hoodName} ✕</Link>}
              <Link href="/" className="font-semibold text-brand-700 underline">Ver tudo</Link>
            </div>
          )}

          {posts.map((p) => (
            <PostCard key={p.id} post={p} viewerId={user?.id ?? null} message={generalMessage(p.service ?? p.category ?? 'um serviço', hoodName ?? city.name, false)} />
          ))}
          {more && (
            <Link href={feedHref(f, { pages: pages + 1 })} scroll={false} className="btn-outline w-full" data-testid="load-more"
              data-cursor={posts.length ? encodeCursor(posts[posts.length - 1]) : undefined}>Carregar mais</Link>
          )}

          {!posts.length && filtered && (
            <div className="post p-5 text-stone-700" data-testid="feed-empty-filter">
              <p>Nenhuma publicação assim ainda.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/" className="btn-primary min-h-11 px-4">Tirar os filtros</Link>
                <Link href={user ? publishHref('pedido') : `/entrar?motivo=publicar&next=${encodeURIComponent(publishHref('pedido'))}`} className="btn-outline min-h-11 px-4">Pedir uma indicação</Link>
              </div>
            </div>
          )}
          {!posts.length && !filtered && (
            <div className="post p-5 text-stone-700" data-testid="feed-empty">
              <p className="text-lg font-bold text-stone-900">A comunidade está começando</p>
              <p className="mt-1">Seja a primeira pessoa a mostrar um trabalho ou pedir uma indicação em {city.name}.</p>
              <Link href="/publicar" className="btn-primary mt-3 min-h-11 px-4">Criar publicação</Link>
            </div>
          )}
        </section>
      </div>

      <aside className="mt-6 hidden space-y-4 lg:sticky lg:top-20 lg:mt-0 lg:block lg:self-start" aria-label="Destaques">
        <section className="post p-4" aria-labelledby="hoje-lado">
          <h2 id="hoje-lado" className="font-bold text-stone-800">Atendem hoje</h2>
          {today.length ? (
            <ul className="mt-2 space-y-1">
              {today.slice(0, 5).map((p) => (
                <li key={p.id}><Link href={`/p/${p.slug}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-paper">
                  <Avatar src={p.avatar} name={p.name} size={38} round />
                  <span className="min-w-0 text-sm"><span className="block truncate font-semibold">{p.name}</span><span className="block truncate text-stone-600">{p.service}</span></span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-stone-600">Ninguém confirmou ainda hoje. Peça no “Preciso para hoje” e veja quem pode ir.</p>}
          <Link href="/hoje" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">Preciso para hoje →</Link>
        </section>
        <section className="post p-4" aria-labelledby="vagas-lado">
          <h2 id="vagas-lado" className="font-bold text-stone-800">Vagas novas</h2>
          {jobs.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm">
              {jobs.map((j) => <li key={j.id}><Link href={`/vagas/${j.id}`} className="block rounded-xl p-1.5 hover:bg-paper"><span className="font-semibold">{j.title}</span><span className="block text-stone-600">{j.company}{j.place ? ` · ${j.place}` : ''}</span></Link></li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-stone-600">Nenhuma vaga aberta agora.</p>}
          <Link href="/vagas" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">Ver vagas →</Link>
        </section>
      </aside>
    </div>
  );
}

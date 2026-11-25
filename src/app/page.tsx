import Link from 'next/link';
import { FeedPost } from '@/components/FeedPost';
import { PostCard } from '@/components/PostCard';
import { Avatar } from '@/components/Avatar';
import { Glyph } from '@/components/CategoryIcon';
import { getCatalog, getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { getFeed, getLatestJobs } from '@/lib/feed';
import { getPosts } from '@/lib/posts';
import { encodeCursor, feedHref, hasFilters, KIND_LABEL, POST_KINDS, readFilters, type PostView } from '@/lib/posts-shared';
import { generalMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const BOLT = 'M13 2 4 14h7l-1 8 9-12h-7z';
const PLUS = 'M12 5v14M5 12h14';
const PAGE = 12;
const MAX_PAGES = 8;

/** Comunidade de Campo Grande: publicações de prestadores e moradores, com filtros, e atalhos para urgência e busca. */
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

  const [catalog, hoods, feed, jobs, { posts, more }] = await Promise.all([
    getCatalog(), getNeighborhoods(city.id), getFeed(city.slug), getLatestJobs(), loadPosts(),
  ]);
  const posted = new Set(posts.filter((p) => p.author.isProvider).map((p) => p.author.id));
  const showcase = !filtered && pages === 1 && posts.length < 6 ? feed.filter((p) => !posted.has(p.id)).slice(0, 6) : [];
  const today = feed.filter((p) => p.availableToday);
  const catName = catalog.find((c) => c.slug === f.category)?.name;
  const hoodName = hoods.find((n) => n.id === f.neighborhood)?.name;
  const publishHref = (tipo: string) => `/publicar?tipo=${tipo}${f.category ? `&categoria=${f.category}` : ''}`;

  return (
    <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
      <div className="min-w-0 space-y-4">
        <header className="space-y-3">
          <div>
            <h1 className="text-2xl font-extrabold leading-tight">Comunidade de {city.name}</h1>
            <p className="hidden text-stone-700 sm:block">Trabalhos de prestadores da cidade, divulgações e pedidos de indicação dos vizinhos.</p>
          </div>
          <form action="/buscar" method="get" role="search" className="md:hidden">
            <div className="sb-row">
              <Glyph d={SEARCH} size={20} />
              <input name="q" aria-label="Que serviço você procura?" placeholder="Que serviço você procura?" enterKeyHint="search" />
              <input type="hidden" name="cidade" value={city.slug} />
              <button className="btn-primary min-h-11 px-4" type="submit">Buscar</button>
            </div>
          </form>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/hoje" className="btn-hoje min-h-12 gap-2 px-3" data-testid="cta-hoje"><Glyph d={BOLT} size={18} /> Preciso para hoje</Link>
            <Link href="/publicar" className="btn-primary min-h-12 gap-2 px-3" data-testid="cta-publicar"><Glyph d={PLUS} size={18} /> Criar publicação</Link>
          </div>
        </header>

        <section className="post p-3 sm:p-4" aria-labelledby="share-t" data-testid="composer">
          <h2 id="share-t" className="font-bold">O que você quer compartilhar?</h2>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {POST_KINDS.map((k) => (
              <Link key={k.key} href={user ? publishHref(k.key) : `/entrar?motivo=publicar&next=${encodeURIComponent(publishHref(k.key))}`} className="kind-opt">
                <span className="block text-sm font-bold leading-tight sm:text-base">{k.cta}</span>
                <span className="hidden text-sm text-stone-600 sm:block">{k.hint}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="feed-titulo" className="space-y-4" id="feed">
          <h2 id="feed-titulo" className="sr-only">Publicações da comunidade</h2>
          <nav aria-label="Tipo de publicação" className="chips-row" data-testid="feed-tabs">
            <Link href={feedHref(f, { kind: null })} className="qchip" aria-current={!f.kind ? 'page' : undefined} scroll={false}>Todos</Link>
            {POST_KINDS.map((k) => (
              <Link key={k.key} href={feedHref(f, { kind: k.key })} className="qchip" aria-current={f.kind === k.key ? 'page' : undefined} scroll={false}>{k.plural}</Link>
            ))}
          </nav>
          <details className="post" open={!!(f.category || f.neighborhood)} data-testid="feed-filters">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold">Filtrar por categoria e bairro</summary>
            <form method="get" action="/" className="grid gap-2 border-t border-stone-200 p-3 sm:grid-cols-[1fr_1fr_auto]" aria-label="Filtrar publicações">
              {f.kind && <input type="hidden" name="tipo" value={f.kind} />}
              <div>
                <label htmlFor="f-cat" className="label text-sm">Categoria</label>
                <select id="f-cat" name="categoria" className="input" defaultValue={f.category ?? ''}>
                  <option value="">Todas as categorias</option>
                  {catalog.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="f-bairro" className="label text-sm">Bairro</label>
                <select id="f-bairro" name="bairro" className="input" defaultValue={f.neighborhood ?? ''}>
                  <option value="">Todos os bairros</option>
                  {hoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
              <button type="submit" className="btn-outline min-h-11 self-end px-4">Filtrar</button>
            </form>
          </details>
          {filtered && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="active-filters">
              <span className="font-semibold text-stone-700">Filtros:</span>
              {f.kind && <Link href={feedHref(f, { kind: null })} className="filter-chip" aria-label={`Tirar filtro ${KIND_LABEL[f.kind]}`}>{KIND_LABEL[f.kind]} ✕</Link>}
              {catName && <Link href={feedHref(f, { category: null })} className="filter-chip" aria-label={`Tirar filtro ${catName}`}>{catName} ✕</Link>}
              {hoodName && <Link href={feedHref(f, { neighborhood: null })} className="filter-chip" aria-label={`Tirar filtro ${hoodName}`}>{hoodName} ✕</Link>}
              <Link href="/" className="font-semibold text-brand-700 underline">Limpar filtros</Link>
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
              <p>Nenhuma publicação com esses filtros ainda.</p>
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

          {showcase.length > 0 && (
            <section aria-labelledby="vitrine-t" className="space-y-4" data-testid="showcase">
              <h2 id="vitrine-t" className="px-1 pt-2 text-lg font-bold">Prestadores da cidade</h2>
              {showcase.map((p) => (
                <FeedPost key={p.id} post={p} loggedIn={!!user} message={generalMessage(p.service ?? 'um serviço', city.name, false)} />
              ))}
              <Link href={`/buscar?cidade=${city.slug}`} className="btn-outline w-full">Ver todos os prestadores</Link>
            </section>
          )}
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
          ) : <p className="mt-2 text-sm text-stone-600">Ninguém confirmou ainda hoje. Peça no “Preciso para hoje” e veja quem pode ir.</p>}
          <Link href="/hoje" className="btn-hoje mt-3 w-full text-sm">Preciso para hoje</Link>
        </section>
        <section className="post p-4" aria-labelledby="vagas-lado">
          <h2 id="vagas-lado" className="font-bold">Vagas recentes</h2>
          {jobs.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm">
              {jobs.map((j) => <li key={j.id}><Link href={`/vagas/${j.id}`} className="block hover:underline"><span className="font-semibold">{j.title}</span><span className="block text-stone-600">{j.company}{j.place ? ` · ${j.place}` : ''}</span></Link></li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-stone-600">Nenhuma vaga aberta agora.</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/vagas" className="btn-outline px-2 text-center text-sm">Ver vagas</Link>
            <Link href="/vagas/meu-curriculo" className="btn-outline px-2 text-center text-sm">Meu currículo</Link>
          </div>
        </section>
      </aside>
    </div>
  );
}

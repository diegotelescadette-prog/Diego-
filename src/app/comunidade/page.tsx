import type { Metadata } from 'next';
import Link from 'next/link';
import { PostCard } from '@/components/PostCard';
import { StoriesBar } from '@/components/StoriesBar';
import { getStories } from '@/lib/stories';
import { Glyph } from '@/components/CategoryIcon';
import { getCatalog, getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { getPosts } from '@/lib/posts';
import { encodeCursor, feedHref, hasFilters, KIND_LABEL, POST_KINDS, readFilters, type PostView } from '@/lib/posts-shared';
import { generalMessage } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Comunidade' };
export const dynamic = 'force-dynamic';

const PLUS = 'M12 5v14M5 12h14';
const PAGE = 12;
const MAX_PAGES = 8;

/** Comunidade de Campo Grande: trabalhos, divulgações e pedidos de indicação, com filtros. */
export default async function Comunidade({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
        citySlug: city.slug, kind: f.kind, category: f.category, neighborhood: f.neighborhood, following: f.following && !!user, limit: PAGE + (i === pages - 1 ? 1 : 0),
        ...(cursor ? { before: cursor.createdAt, beforeId: cursor.id } : {}),
      });
      const more = i === pages - 1 && page.length > PAGE;
      out.push(...page.slice(0, PAGE));
      if (page.length < PAGE || more) return { posts: out, more };
      cursor = page[PAGE - 1];
    }
    return { posts: out, more: false };
  }

  const [catalog, hoods, { posts, more }, stories] = await Promise.all([getCatalog(), getNeighborhoods(city.id), loadPosts(), getStories()]);
  const catName = catalog.find((c) => c.slug === f.category)?.name;
  const hoodName = hoods.find((n) => n.id === f.neighborhood)?.name;
  const publishHref = (tipo: string) => `/publicar?tipo=${tipo}${f.category ? `&categoria=${f.category}` : ''}`;
  const gated = (href: string) => (user ? href : `/entrar?motivo=publicar&next=${encodeURIComponent(href)}`);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Comunidade de {city.name}</h1>
          <p className="text-stone-600">O dia a dia da cidade, trabalhos de profissionais, divulgações e pedidos de indicação.</p>
        </div>
        <Link href={gated('/publicar')} className="btn-primary min-h-11 gap-2 px-4" data-testid="cta-publicar"><Glyph d={PLUS} size={18} /> Criar publicação</Link>
      </header>

      {(stories.length > 0 || user) && <StoriesBar groups={stories} loggedIn={!!user} />}

      <nav aria-label="Tipo de publicação" className="chips-row" data-testid="feed-tabs">
        <Link href={feedHref(f, { kind: null })} className="qchip" aria-current={!f.kind ? 'page' : undefined} scroll={false}>Todos</Link>
        <Link href={user ? feedHref(f, { following: !f.following }) : `/entrar?motivo=seguir&next=${encodeURIComponent('/comunidade?seguindo=1')}`}
          className="qchip" aria-current={f.following ? 'page' : undefined} aria-pressed={f.following} scroll={false} data-testid="tab-following">Quem eu sigo</Link>
        {POST_KINDS.map((k) => (
          <Link key={k.key} href={feedHref(f, { kind: k.key })} className="qchip" aria-current={f.kind === k.key ? 'page' : undefined} scroll={false}>{k.plural}</Link>
        ))}
      </nav>
      <details className="post" open={!!(f.category || f.neighborhood)} data-testid="feed-filters">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold">Filtrar por categoria e bairro</summary>
        <form method="get" action="/comunidade" className="grid gap-2 border-t border-line p-3 sm:grid-cols-[1fr_1fr_auto]" aria-label="Filtrar publicações">
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
          {f.following && <Link href={feedHref(f, { following: false })} className="filter-chip" aria-label="Tirar filtro Quem eu sigo">Quem eu sigo ✕</Link>}
          {hoodName && <Link href={feedHref(f, { neighborhood: null })} className="filter-chip" aria-label={`Tirar filtro ${hoodName}`}>{hoodName} ✕</Link>}
          <Link href="/comunidade" className="font-semibold text-brand-700 underline">Limpar filtros</Link>
        </div>
      )}

      <section aria-labelledby="feed-titulo" className="space-y-4" id="feed">
        <h2 id="feed-titulo" className="sr-only">Publicações da comunidade</h2>
        {posts.map((p) => (
          <PostCard key={p.id} post={p} viewerId={user?.id ?? null} message={generalMessage(p.service ?? p.category ?? 'um serviço', hoodName ?? city.name, false)} />
        ))}
        {more && (
          <Link href={feedHref(f, { pages: pages + 1 })} scroll={false} className="btn-outline w-full" data-testid="load-more"
            data-cursor={posts.length ? encodeCursor(posts[posts.length - 1]) : undefined}>Carregar mais</Link>
        )}
        {posts.length > 0 && !more && (
          <p className="feed-end" data-testid="feed-end">Você está em dia. Vai lá viver o seu dia.</p>
        )}
        {!posts.length && f.following && (
          <div className="post p-5 text-stone-700" data-testid="feed-empty-following">
            <p className="font-bold text-stone-900">Você ainda não segue ninguém por aqui</p>
            <p className="mt-1">Abra o perfil de um profissional e toque em Seguir. Os trabalhos dele aparecem nesta aba.</p>
            <Link href={feedHref(f, { following: false })} className="btn-primary mt-3 min-h-11 px-4">Ver toda a comunidade</Link>
          </div>
        )}
        {!posts.length && filtered && !f.following && (
          <div className="post p-5 text-stone-700" data-testid="feed-empty-filter">
            <p>Nenhuma publicação com esses filtros ainda.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/comunidade" className="btn-primary min-h-11 px-4">Tirar os filtros</Link>
              <Link href={gated(publishHref('pedido'))} className="btn-outline min-h-11 px-4">Pedir uma indicação</Link>
            </div>
          </div>
        )}
        {!posts.length && !filtered && (
          <div className="post p-5 text-stone-700" data-testid="feed-empty">
            <p className="text-lg font-bold text-stone-900">A comunidade está começando</p>
            <p className="mt-1">Seja a primeira pessoa a mostrar um trabalho ou pedir uma indicação em {city.name}.</p>
            <Link href={gated('/publicar')} className="btn-primary mt-3 min-h-11 px-4">Criar publicação</Link>
          </div>
        )}
      </section>
    </div>
  );
}

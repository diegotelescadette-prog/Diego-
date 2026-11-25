'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Avatar } from './Avatar';
import { WhatsAppIcon } from './CategoryIcon';
import { PostGallery } from './PostGallery';
import { useWhatsApp } from './useWhatsApp';
import { deletePost, toggleFound, toggleSave, toggleUseful } from '@/app/comunidade/actions';
import { KIND_LABEL, timeAgo, type PostView } from '@/lib/posts-shared';

const KIND_CLASS = { trabalho: 'kind-trabalho', divulgacao: 'kind-divulgacao', pedido: 'kind-pedido' } as const;

/** Volta para a tela atual depois do login (mantém filtros e a publicação). */
const here = () => (typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search);

/** Publicação da comunidade: trabalho, divulgação ou pedido de indicação, com Útil, Comentar, Salvar, Compartilhar e WhatsApp. */
export function PostCard({ post, viewerId, message, detail = false }: {
  post: PostView; viewerId: string | null; message: string; detail?: boolean;
}) {
  const router = useRouter();
  const profile = post.author.slug ? `/p/${post.author.slug}` : null;
  const page = `/comunidade/${post.id}`;
  const mine = viewerId === post.author.id;
  const pro = post.author.isProvider;
  const { open: whatsapp, busy, err } = useWhatsApp(post.author.id, page, !!viewerId, message);
  const [useful, setUseful] = useState({ on: post.reacted, n: post.reactions });
  const [saved, setSaved] = useState(post.saved);
  const [found, setFound] = useState(post.found);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const photos = post.media.filter((m) => m.kind === 'foto');
  const video = post.media.find((m) => m.kind === 'video');
  const subject = post.service ?? post.category;

  function needLogin(motivo: string) {
    router.push(`/entrar?motivo=${motivo}&next=${encodeURIComponent(here())}`);
  }
  function toggle() {
    if (!viewerId) return needLogin('util');
    const next = { on: !useful.on, n: useful.n + (useful.on ? -1 : 1) };
    setUseful(next);
    start(async () => { const r = await toggleUseful(post.id, next.on); if (!r.ok) setUseful(useful); });
  }
  function save() {
    if (!viewerId) return needLogin('salvar');
    const next = !saved;
    setSaved(next);
    start(async () => {
      const r = await toggleSave(post.id, next);
      if (!r.ok) setSaved(!next); else setNote(next ? 'Salvo em Favoritos.' : 'Tirado dos salvos.');
    });
  }
  function markFound() {
    const next = !found;
    setFound(next);
    start(async () => { const r = await toggleFound(post.id, next); if (!r.ok) setFound(!next); else router.refresh(); });
  }
  async function share() {
    const url = `${window.location.origin}${page}`;
    const title = pro ? `${KIND_LABEL[post.kind]} de ${post.author.name}` : `Pedido de indicação: ${subject ?? 'serviço'}`;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      setNote('Link copiado.');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setNote(`Copie o link: ${url}`);
    }
  }
  function remove() {
    start(async () => {
      const r = await deletePost(post.id);
      if (r.ok) { if (detail) router.push('/'); else router.refresh(); }
    });
  }

  return (
    <article className="post" data-testid="post" data-kind={post.kind} aria-labelledby={`pt-${post.id}`}>
      <header className="flex items-center gap-3 px-4 pt-4">
        {profile
          ? <Link href={profile} tabIndex={-1} aria-hidden="true"><Avatar src={post.author.avatar} name={post.author.name} size={44} /></Link>
          : <Avatar src={null} name={post.author.name} size={44} />}
        <div className="min-w-0 flex-1">
          <h3 id={`pt-${post.id}`} className="truncate font-bold leading-tight">
            {profile ? <Link href={profile} className="hover:underline">{post.author.name}</Link> : post.author.name}
          </h3>
          <p className="truncate text-sm text-stone-600">
            <Link href={page} className="hover:underline"><time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time></Link>
            {post.editedAt && <> · editado</>}
            {post.author.area && <> · {post.author.area}</>}
          </p>
        </div>
        {post.author.availableToday && <span className="today-badge"><span className="dot" />Atende hoje</span>}
        <div className="relative">
          <button type="button" className="grid h-11 w-11 place-items-center rounded-full text-xl text-stone-600 hover:bg-stone-100"
            aria-label="Mais opções da publicação" aria-expanded={menu} onClick={() => { setMenu(!menu); setConfirm(false); }}>⋯</button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
              {mine && <Link href={`${page}/editar`} className="block rounded-lg px-3 py-2 hover:bg-stone-50">Editar publicação</Link>}
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-stone-50" onClick={() => { setMenu(false); void share(); }}>Copiar ou compartilhar link</button>
              {mine ? (
                confirm ? (
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left font-semibold text-red-700 hover:bg-red-50" onClick={remove} disabled={pending}>
                    {pending ? 'Apagando…' : 'Confirmar: apagar'}
                  </button>
                ) : (
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-stone-50" onClick={() => setConfirm(true)}>Apagar publicação</button>
                )
              ) : (
                <Link href={`${page}#denunciar`} className="block rounded-lg px-3 py-2 hover:bg-stone-50">Denunciar publicação</Link>
              )}
              {profile && <Link href={profile} className="block rounded-lg px-3 py-2 hover:bg-stone-50">Ver perfil de {post.author.name}</Link>}
            </div>
          )}
        </div>
      </header>

      <p className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
        <span className={`kind-tag ${KIND_CLASS[post.kind]}`}>{KIND_LABEL[post.kind]}</span>
        {subject && <span className="font-semibold text-stone-800">{subject}</span>}
        {post.neighborhood && post.kind !== 'pedido' && <span className="text-stone-600">· Bairro {post.neighborhood}</span>}
        {post.price && <span className="price-tag">{post.price}</span>}
        {post.kind === 'pedido' && found && <span className="found-tag" data-testid="found">✓ Indicação encontrada</span>}
      </p>

      {post.body && <p className={`post-body px-4 pt-2${detail ? '' : ' clamp'}`}>{post.body}</p>}
      {!detail && post.body.length > 300 && <Link href={page} className="px-4 text-sm font-semibold text-brand-700 hover:underline">Ver mais</Link>}

      {video && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={video.url} controls playsInline preload="metadata" className="mt-3 max-h-[70vh] w-full bg-black" aria-label={`Vídeo de ${post.author.name}`} />
      )}
      {photos.length > 0 && <PostGallery photos={photos} author={post.author.name} all={detail} />}

      {mine && post.kind === 'pedido' && (
        <div className="px-4 pt-3">
          <button type="button" className={`btn-outline min-h-10 w-full px-3 text-sm${found ? ' border-green-700 text-green-800' : ''}`} aria-pressed={found} onClick={markFound} disabled={pending}>
            {found ? '✓ Indicação encontrada (desmarcar)' : 'Marcar: indicação encontrada'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between px-4 pt-3 text-sm text-stone-600">
        <span data-testid="useful-count">{useful.n > 0 ? `👍 ${useful.n} ${useful.n === 1 ? 'achou útil' : 'acharam útil'}` : ''}</span>
        {post.comments > 0 && <Link href={`${page}#comentarios`} className="hover:underline">{post.comments === 1 ? '1 comentário' : `${post.comments} comentários`}</Link>}
      </div>
      <div className="post-row">
        <button type="button" className={`post-act${useful.on ? ' on' : ''}`} aria-pressed={useful.on} onClick={toggle}>👍 Útil</button>
        <Link href={`${page}#comentar`} className="post-act">💬 {post.kind === 'pedido' ? 'Indicar' : 'Comentar'}</Link>
        <button type="button" className={`post-act${saved ? ' on' : ''}`} aria-pressed={saved} onClick={save}>{saved ? '★ Salvo' : '☆ Salvar'}</button>
        <button type="button" className="post-act" onClick={share} aria-label="Compartilhar publicação">↗ <span className="hidden sm:inline">Compartilhar</span></button>
      </div>
      {pro && !mine && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-3">
          {profile && <Link href={profile} className="btn-outline min-h-11 px-3 text-sm">Ver perfil</Link>}
          <button type="button" className="post-btn post-zap" onClick={whatsapp} disabled={busy}>
            <WhatsAppIcon size={18} /> {busy ? 'Abrindo…' : 'Chamar no WhatsApp'}
          </button>
        </div>
      )}
      {note && <p role="status" className="px-4 pb-2 text-sm text-stone-700">{note}</p>}
      {err && <p role="alert" className="px-4 pb-2 text-sm text-red-700">{err}</p>}
      {!detail && post.lastComment && (
        <Link href={`${page}#comentarios`} className="mx-4 mb-4 block rounded-2xl bg-stone-100 px-3 py-2 text-sm" data-testid="last-comment">
          <span className="font-bold">{post.lastComment.name}</span> {post.lastComment.body.length > 160 ? `${post.lastComment.body.slice(0, 160)}…` : post.lastComment.body}
        </Link>
      )}
      {!detail && !post.lastComment && <div className="h-2" />}
    </article>
  );
}

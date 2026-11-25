'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Avatar } from './Avatar';
import { WhatsAppIcon } from './CategoryIcon';
import { useWhatsApp } from './useWhatsApp';
import { deletePost, toggleUseful } from '@/app/publicacoes/actions';
import { timeAgo, type PostView } from '@/lib/posts-shared';

/** Publicação no estilo Facebook: texto, fotos ou vídeo, "Útil", comentários e WhatsApp. */
export function PostCard({ post, viewerId, message, detail = false }: {
  post: PostView; viewerId: string | null; message: string; detail?: boolean;
}) {
  const router = useRouter();
  const profile = `/p/${post.author.slug}`;
  const page = `/publicacoes/${post.id}`;
  const mine = viewerId === post.author.id;
  const { open: whatsapp, busy, err } = useWhatsApp(post.author.id, profile, !!viewerId, message);
  const [useful, setUseful] = useState({ on: post.reacted, n: post.reactions });
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const photos = post.media.filter((m) => m.kind === 'foto');
  const video = post.media.find((m) => m.kind === 'video');
  const shown = detail ? photos : photos.slice(0, 4);
  const extra = photos.length - shown.length;

  function toggle() {
    if (!viewerId) { router.push(`/entrar?motivo=util&next=${encodeURIComponent(window.location.pathname)}`); return; }
    const next = { on: !useful.on, n: useful.n + (useful.on ? -1 : 1) };
    setUseful(next);
    start(async () => {
      const r = await toggleUseful(post.id, next.on);
      if (!r.ok) setUseful(useful);
    });
  }

  function remove() {
    start(async () => {
      const r = await deletePost(post.id);
      if (r.ok) { if (detail) router.push('/'); else router.refresh(); }
    });
  }

  return (
    <article className="post" data-testid="post" aria-labelledby={`pt-${post.id}`}>
      <header className="flex items-center gap-3 px-4 pt-4">
        <Link href={profile} tabIndex={-1} aria-hidden="true"><Avatar src={post.author.avatar} name={post.author.name} size={44} /></Link>
        <div className="min-w-0 flex-1">
          <h3 id={`pt-${post.id}`} className="truncate font-bold leading-tight"><Link href={profile} className="hover:underline">{post.author.name}</Link></h3>
          <p className="truncate text-sm text-stone-600">
            {post.author.service && <>{post.author.service} · </>}<Link href={page} className="hover:underline"><time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time></Link>
          </p>
        </div>
        {post.author.availableToday && <span className="today-badge"><span className="dot" />Atende hoje</span>}
        <div className="relative">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full text-xl text-stone-600 hover:bg-stone-100"
            aria-label="Mais opções da publicação" aria-expanded={menu} onClick={() => { setMenu(!menu); setConfirm(false); }}>⋯</button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
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
              <Link href={profile} className="block rounded-lg px-3 py-2 hover:bg-stone-50">Ver perfil de {post.author.name}</Link>
            </div>
          )}
        </div>
      </header>

      {post.body && <p className={`post-body px-4 pt-3${detail ? '' : ' clamp'}`}>{post.body}</p>}

      {video && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={video.url} controls playsInline preload="metadata" className="mt-3 max-h-[70vh] w-full bg-black" aria-label={`Vídeo de ${post.author.name}`} />
      )}
      {shown.length > 0 && (
        <div className={`gallery g${Math.min(shown.length, 4)} mt-3${detail && shown.length > 4 ? ' gallery-all' : ''}`}>
          {shown.map((m, i) => (
            <a key={m.url} href={detail ? m.url : page} target={detail ? '_blank' : undefined} rel="noreferrer" className="relative block overflow-hidden"
              aria-label={detail ? `Abrir foto ${i + 1}` : `Ver a publicação de ${post.author.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              {i === shown.length - 1 && extra > 0 && <span className="more">+{extra}</span>}
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-4 pt-3 text-sm text-stone-600">
        <span data-testid="useful-count">{useful.n > 0 ? `👍 ${useful.n} ${useful.n === 1 ? 'achou útil' : 'acharam útil'}` : ''}</span>
        {post.comments > 0 && <Link href={`${page}#comentarios`} className="hover:underline">{post.comments === 1 ? '1 comentário' : `${post.comments} comentários`}</Link>}
      </div>
      <div className="post-row">
        <button type="button" className={`post-act${useful.on ? ' on' : ''}`} aria-pressed={useful.on} onClick={toggle}>👍 Útil</button>
        <Link href={`${page}#comentar`} className="post-act">💬 Comentar</Link>
        {!mine && (
          <button type="button" className="post-act zap" onClick={whatsapp} disabled={busy}>
            <WhatsAppIcon size={18} /> {busy ? 'Abrindo…' : 'WhatsApp'}
          </button>
        )}
      </div>
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

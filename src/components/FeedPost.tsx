'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from './Avatar';
import { WhatsAppIcon } from './CategoryIcon';
import type { FeedPost as Post } from '@/lib/feed';

/** Publicação do feed da tela inicial: texto do prestador, fotos de trabalho e contato. */
export function FeedPost({ post, loggedIn, message }: { post: Post; loggedIn: boolean; message: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const profile = `/p/${post.slug}`;
  const extra = post.photoCount - post.photos.length;

  async function whatsapp() {
    if (!loggedIn) { window.location.assign(`/entrar?motivo=contato&next=${encodeURIComponent(profile)}`); return; }
    setBusy(true); setErr(null);
    const res = await fetch('/api/contact/general', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: post.id, message }),
    }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => ({})) : {};
    if (body.url) { window.location.assign(body.url); return; }
    setBusy(false);
    setErr(res?.status === 429 ? 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.' : 'Não foi possível abrir o WhatsApp agora. Tente novamente.');
  }

  return (
    <article className="post" data-testid="feed-post" aria-labelledby={`post-${post.id}`}>
      <header className="flex items-center gap-3 px-4 pt-4">
        <Link href={profile} tabIndex={-1} aria-hidden="true"><Avatar src={post.avatar} name={post.name} size={44} /></Link>
        <div className="min-w-0 flex-1">
          <h3 id={`post-${post.id}`} className="truncate font-bold leading-tight"><Link href={profile} className="hover:underline">{post.name}</Link></h3>
          <p className="truncate text-sm text-stone-600">
            {[post.service, post.area].filter(Boolean).join(' · ')}
          </p>
        </div>
        {post.availableToday && <span className="today-badge"><span className="dot" />Atende hoje</span>}
      </header>
      {post.bio && <p className="post-text px-4 pt-3">{post.bio}</p>}
      {post.photos.length > 0 ? (
        <Link href={profile} className={`gallery g${post.photos.length} mt-3`} aria-label={`Ver ${post.photoCount === 1 ? 'a foto' : `as ${post.photoCount} fotos`} de ${post.name}`}>
          {post.photos.map((src, i) => (
            <span key={src} className="relative block overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              {i === post.photos.length - 1 && extra > 0 && <span className="more">+{extra}</span>}
            </span>
          ))}
        </Link>
      ) : (
        <p className="mx-4 mt-3 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">Ainda sem fotos de trabalhos.</p>
      )}
      <div className="post-actions">
        <Link href={profile} className="post-btn">Ver perfil</Link>
        <button type="button" className="post-btn post-zap" onClick={whatsapp} disabled={busy}>
          <WhatsAppIcon size={18} /> {busy ? 'Abrindo…' : 'Chamar no WhatsApp'}
        </button>
      </div>
      {err && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{err}</p>}
    </article>
  );
}

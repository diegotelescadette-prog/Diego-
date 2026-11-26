'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Avatar } from '@/components/Avatar';
import { deleteStory, markSeen, reportStory } from '@/app/momentos/actions';
import { POST_REPORT_REASON, timeAgo } from '@/lib/posts-shared';
import { STORY_LIMITS } from '@/lib/stories-shared';
import type { StoryGroup } from '@/lib/stories';

/** Mostra os momentos um a um: barra de progresso, toque à esquerda volta e à direita avança; foto passa sozinha. */
export function StoryViewer({ group, views, start, nextHref, loggedIn }: {
  group: StoryGroup; views: Record<string, number>; start: number; nextHref: string; loggedIn: boolean;
}) {
  const router = useRouter();
  const [i, setI] = useState(start);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState<'report' | 'delete' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const item = group.items[i];
  const profile = group.slug ? `/p/${group.slug}` : null;

  function next() { if (i < group.items.length - 1) setI(i + 1); else router.push(nextHref); }
  function prev() { if (i > 0) setI(i - 1); }

  useEffect(() => { if (loggedIn && !group.mine && !item.seen) void markSeen(item.id); }, [item, loggedIn, group.mine]);
  useEffect(() => {
    if (item.kind !== 'foto' || paused || menu) return;
    const t = setTimeout(next, STORY_LIMITS.photoSeconds * 1000);
    return () => clearTimeout(t);
  }, [i, paused, menu]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); if (e.key === 'Escape') router.push('/comunidade'); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  function remove() {
    run(async () => {
      const r = await deleteStory(item.id);
      if (!r.ok) { setNote(r.message ?? 'Não foi possível apagar.'); return; }
      if (group.items.length === 1) router.push('/comunidade'); else router.refresh();
    });
  }
  function report(reason: string) {
    run(async () => { const r = await reportStory(item.id, reason); setNote(r.message ?? null); setMenu(null); });
  }

  return (
    <section className="story-view" aria-label={`Momentos de ${group.name}`} data-testid="story-viewer">
      <div className="story-bars" aria-hidden="true">
        {group.items.map((it, n) => (
          <span key={`${it.id}-${n === i}`} className={`story-bar${n < i ? ' done' : n === i ? ` now${paused || menu || it.kind === 'video' ? ' paused' : ''}` : ''}`}
            style={n === i && it.kind === 'foto' ? { animationDuration: `${STORY_LIMITS.photoSeconds}s` } : undefined} />
        ))}
      </div>
      <header className="story-head">
        {profile ? <Link href={profile}><Avatar src={group.avatar} name={group.name} size={36} round /></Link> : <Avatar src={group.avatar} name={group.name} size={36} round />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{profile ? <Link href={profile} className="hover:underline">{group.name}</Link> : group.name}</p>
          <p className="text-xs opacity-80"><time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time> · {i + 1} de {group.items.length}</p>
        </div>
        <button type="button" className="story-icon" aria-label={paused ? 'Continuar' : 'Pausar'} onClick={() => setPaused(!paused)}>{paused ? '▶' : 'II'}</button>
        <button type="button" className="story-icon" aria-label="Mais opções" aria-expanded={!!menu}
          onClick={() => setMenu(menu ? null : group.mine ? 'delete' : 'report')}>⋯</button>
        <Link href="/comunidade" className="story-icon" aria-label="Fechar momentos">✕</Link>
      </header>

      <div className="story-media">
        {item.kind === 'foto'
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={item.id} src={item.url} alt={item.caption || `Momento de ${group.name}`} />
          // eslint-disable-next-line jsx-a11y/media-has-caption
          : <video key={item.id} src={item.url} autoPlay playsInline controls={false} onEnded={next} aria-label={item.caption || `Vídeo de ${group.name}`}
              onClick={(e) => { const v = e.currentTarget; if (v.paused) void v.play(); else v.pause(); }} />}
        <button type="button" className="story-tap left" aria-label="Momento anterior" onClick={prev} disabled={i === 0} />
        <button type="button" className="story-tap right" aria-label="Próximo momento" onClick={next} />
      </div>

      {item.caption && <p className="story-caption">{item.caption}</p>}
      {group.mine && <p className="story-views" data-testid="story-views">Visto por {views[item.id] ?? 0} {(views[item.id] ?? 0) === 1 ? 'pessoa' : 'pessoas'}</p>}

      {menu === 'delete' && (
        <div className="story-menu">
          <button type="button" className="btn-outline min-h-11 w-full" onClick={remove} disabled={pending}>{pending ? 'Apagando…' : 'Apagar este momento'}</button>
        </div>
      )}
      {menu === 'report' && (
        <div className="story-menu" role="group" aria-label="Denunciar momento">
          {loggedIn ? Object.entries(POST_REPORT_REASON).map(([k, label]) => (
            <button key={k} type="button" className="btn-outline min-h-11 w-full" onClick={() => report(k)} disabled={pending}>{label}</button>
          )) : <Link href={`/entrar?motivo=denuncia&next=${encodeURIComponent(`/momentos/${group.authorId}`)}`} className="btn-outline min-h-11 w-full">Entre para denunciar</Link>}
        </div>
      )}
      {note && <p role="status" className="story-caption">{note}</p>}
    </section>
  );
}

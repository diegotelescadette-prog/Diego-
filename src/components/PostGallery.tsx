'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostMedia } from '@/lib/posts-shared';

const LABEL = { antes: 'Antes', depois: 'Depois' } as const;

/** Grade de fotos (até 4 no feed, +N) que abre uma galeria com setas, teclado e descrição de cada imagem. */
export function PostGallery({ photos, author, all = false }: { photos: PostMedia[]; author: string; all?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = all ? photos : photos.slice(0, 4);
  const extra = photos.length - shown.length;
  const opener = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const describe = (i: number) => `Foto ${i + 1} de ${photos.length} da publicação de ${author}${photos[i].label ? ` (${LABEL[photos[i].label!]})` : ''}`;

  const close = useCallback(() => { setOpen(null); opener.current?.focus(); }, []);
  const go = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + photos.length) % photos.length)), [photos.length]);

  useEffect(() => {
    if (open === null) return;
    dialog.current?.querySelector<HTMLElement>('[data-close]')?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'Tab') {
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button') ?? [])];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  return (
    <>
      <div className={`gallery g${Math.min(shown.length, 4)} mt-3${all && shown.length > 4 ? ' gallery-all' : ''}`}>
        {shown.map((m, i) => (
          <button key={m.path} type="button" className="relative block overflow-hidden" aria-label={`Abrir ${describe(i).toLowerCase()}`}
            onClick={(e) => { opener.current = e.currentTarget; setOpen(i); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            {m.label && <span className="ba-tag">{LABEL[m.label]}</span>}
            {i === shown.length - 1 && extra > 0 && <span className="more">+{extra}</span>}
          </button>
        ))}
      </div>
      {open !== null && (
        <div ref={dialog} role="dialog" aria-modal="true" aria-label={`Fotos da publicação de ${author}`} className="lightbox" onKeyDown={onKey}>
          <div className="absolute inset-0" aria-hidden="true" onClick={close} />
          <figure className="relative z-10 flex max-h-full w-full max-w-4xl flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[open].url} alt={describe(open)} className="max-h-[78vh] w-auto max-w-full rounded-lg object-contain" />
            <figcaption className="text-sm font-semibold text-white" aria-live="polite">
              {photos[open].label && <span className="mr-2 rounded-full bg-white px-2 py-0.5 text-stone-900">{LABEL[photos[open].label!]}</span>}
              {open + 1} de {photos.length}
            </figcaption>
          </figure>
          <button type="button" data-close className="lb-btn right-3 top-3" onClick={close} aria-label="Fechar galeria">✕</button>
          {photos.length > 1 && <>
            <button type="button" className="lb-btn left-2 top-1/2 -translate-y-1/2" onClick={() => go(-1)} aria-label="Foto anterior">‹</button>
            <button type="button" className="lb-btn right-2 top-1/2 -translate-y-1/2" onClick={() => go(1)} aria-label="Próxima foto">›</button>
          </>}
        </div>
      )}
    </>
  );
}

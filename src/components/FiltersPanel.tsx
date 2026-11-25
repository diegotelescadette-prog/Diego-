'use client';
import { useEffect, useRef, useState } from 'react';

/** Computador (≥1024px): painel fixo à direita dos resultados.
 *  Telas menores: botão "Filtros" junto à contagem abre uma gaveta (Escape fecha e devolve o foco). */
export function FiltersPanel({ count, summary, children }: { count: number; summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      sheet.current?.querySelector<HTMLElement>('select, input, button')?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      btn.current?.focus();
    }
  }, [open]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
        <div className="min-w-0 text-stone-700">{summary}</div>
        <button ref={btn} type="button" className="btn-outline flex-none" aria-expanded={open} aria-controls="painel-filtros" onClick={() => setOpen(true)}>
          Filtros{count > 0 ? ` (${count})` : ''}
        </button>
      </div>
      <div className={`fp${open ? ' fp-open' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); } }}>
        <div className="fp-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
        <aside ref={sheet} id="painel-filtros" aria-label="Filtros" className="fp-sheet card p-4"
          {...(open ? { role: 'dialog', 'aria-modal': true } : {})}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Filtros</h2>
            <button type="button" className="btn-ghost min-h-10 px-3 lg:hidden" onClick={() => setOpen(false)}>Fechar filtros</button>
          </div>
          {children}
        </aside>
      </div>
    </>
  );
}

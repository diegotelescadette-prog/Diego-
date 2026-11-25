'use client';
import { useState } from 'react';

/** No celular: botão "Filtros" abre o painel. No computador: painel lateral fixo. */
export function FiltersPanel({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-outline w-full lg:hidden" aria-expanded={open} aria-controls="painel-filtros" onClick={() => setOpen((o) => !o)}>
        Filtros{count > 0 ? ` (${count})` : ''}
      </button>
      <aside id="painel-filtros" aria-label="Filtros" className={`${open ? 'block' : 'hidden'} card mt-3 p-4 lg:mt-0 lg:block`}>
        {children}
        <button type="button" className="btn-ghost mt-2 w-full lg:hidden" onClick={() => setOpen(false)}>Fechar filtros</button>
      </aside>
    </>
  );
}

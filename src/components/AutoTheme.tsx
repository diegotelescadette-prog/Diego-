'use client';
import { useEffect } from 'react';

/** Modo Automático: aplica e acompanha o tema do aparelho (também depois de trocar a aparência sem recarregar). */
export function AutoTheme() {
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const set = () => { document.documentElement.dataset.theme = m.matches ? 'dark' : 'light'; };
    set();
    m.addEventListener('change', set);
    return () => m.removeEventListener('change', set);
  }, []);
  return null;
}

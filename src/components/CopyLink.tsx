'use client';
import { useState } from 'react';

/** Copia o endereço público do perfil e confirma com texto (não só com cor). */
export function CopyLink({ url, className = 'btn-outline' }: { url: string; className?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setMsg('Link copiado.'); }
    catch { setMsg(`Não foi possível copiar. Copie manualmente: ${url}`); }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={className} onClick={copy}>Copiar link</button>
      <span role="status" className="text-sm text-stone-700">{msg}</span>
    </span>
  );
}

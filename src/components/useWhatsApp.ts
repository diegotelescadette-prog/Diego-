'use client';
import { useState } from 'react';

/** Contato da busca geral/feed: sem conta, leva ao login e volta ao perfil; com conta, o servidor gera o link. */
export function useWhatsApp(providerId: string, profileHref: string, loggedIn: boolean, message: string) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    if (!loggedIn) { window.location.assign(`/entrar?motivo=contato&next=${encodeURIComponent(profileHref)}`); return; }
    setBusy(true); setErr(null);
    const res = await fetch('/api/contact/general', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId, message }),
    }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => ({})) : {};
    if (body.url) { window.location.assign(body.url); return; }
    setBusy(false);
    setErr(res?.status === 429 ? 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.' : 'Não foi possível abrir o WhatsApp agora. Tente novamente.');
  }
  return { open, busy, err };
}

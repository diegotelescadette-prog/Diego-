'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { CategoryIcon, Glyph, PIN_PATH, WhatsAppIcon } from './CategoryIcon';
import { areaText } from '@/lib/whatsapp';
import type { ProviderCardData } from '@/lib/types';

/** Contato da busca geral: rota autenticada; o número só sai do servidor no clique. */
async function openGeneral(providerId: string, message: string): Promise<string | null> {
  const res = await fetch('/api/contact/general', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId, message }),
  }).catch(() => null);
  if (res?.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.url) { window.location.assign(body.url); return null; }
  }
  if (res?.status === 401) return 'login';
  if (res?.status === 429) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.';
  return 'Não foi possível abrir o WhatsApp agora. Tente novamente.';
}

export interface CardContact { loggedIn: boolean; message: string; returnTo: string }

/** Card da busca geral. Com `contact`, tocar no card abre o WhatsApp
 *  (na primeira vez pede login e volta direto para a conversa). */
export function ProviderCard({ p, photo, query = '', contact }: { p: ProviderCardData; photo: string | null; query?: string; contact?: CardContact }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const profileHref = `/p/${p.slug}${query}`;

  async function tap() {
    if (!contact) return;
    if (!contact.loggedIn) {
      const sep = contact.returnTo.includes('?') ? '&' : '?';
      window.location.assign(`/entrar?motivo=contato&next=${encodeURIComponent(`${contact.returnTo}${sep}chamar=${p.slug}`)}`);
      return;
    }
    setBusy(true); setErr(null);
    const r = await openGeneral(p.id, contact.message);
    setBusy(false);
    if (r === 'login') { contact.loggedIn = false; tap(); } else if (r) setErr(r);
  }

  const body = (
    <>
      <Avatar src={photo} name={p.display_name} />
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold leading-tight">{p.display_name}</span>
        {p.main_service && <span className="mt-0.5 flex items-center gap-1.5 font-semibold text-stone-800"><CategoryIcon slug={p.main_category} size="sm" />{p.main_service}</span>}
        {p.area_label && <span className="mt-0.5 flex items-center gap-1 text-sm text-stone-600"><Glyph d={PIN_PATH} size={14} />{areaText(p.area_label)}</span>}
        {p.available_today && <span className="mt-1 block"><span className="badge-hoje">● Atende hoje</span></span>}
        {contact && <span className="pc-wa-label" aria-hidden="true"><WhatsAppIcon size={18} />{busy ? 'Abrindo…' : 'Chamar no WhatsApp'}</span>}
      </span>
    </>
  );

  return (
    <li className="card pc-wrap" data-testid="provider-card">
      {contact ? (
        <button type="button" className="pc" onClick={tap} disabled={!ready || busy} aria-label={`Chamar no WhatsApp: ${p.display_name}`}>
          {body}
        </button>
      ) : (
        <Link href={profileHref} className="pc">{body}</Link>
      )}
      {err && <p role="alert" className="px-4 pb-2 text-sm font-medium text-red-700">{err}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-4 py-2">
        <Link href={profileHref} className="text-sm font-semibold text-brand-700 underline">Ver perfil</Link>
        {contact && !contact.loggedIn && <span className="text-xs text-stone-500">Na primeira vez pedimos login</span>}
      </div>
    </li>
  );
}

/** Depois do login, continua o contato que a pessoa começou no card. */
export function ContinueContact({ providerId, message, cleanUrl }: { providerId: string; message: string; cleanUrl: string }) {
  const done = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    window.history.replaceState(null, '', cleanUrl);
    openGeneral(providerId, message).then((r) => { if (r && r !== 'login') setErr(r); });
  }, [providerId, message, cleanUrl]);
  return err ? <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-red-900">{err}</p>
    : <p role="status" className="mb-3 rounded-xl bg-sage p-3 text-stone-900">Abrindo o WhatsApp…</p>;
}

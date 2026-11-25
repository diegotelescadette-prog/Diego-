'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { CategoryIcon, Glyph, PIN_PATH, WhatsAppIcon } from './CategoryIcon';
import { areaText } from '@/lib/whatsapp';

export interface UrgentItem {
  id: string; slug: string; display_name: string; photo: string | null; service_name: string; area_label: string;
}

export function UrgentResults({ items, serviceId, serviceSlug, categorySlug, neighborhoodId, neighborhoodSlug, cityId, citySlug, cityName, changedName }: {
  items: UrgentItem[]; serviceId: number; serviceSlug: string; categorySlug?: string;
  neighborhoodId: number | null; neighborhoodSlug: string | null; cityId: number; citySlug: string; cityName: string; changedName?: string;
}) {
  const [notice, setNotice] = useState<string | null>(
    changedName ? `A disponibilidade de ${changedName} mudou e não está mais ativa para hoje. Atualizamos a lista.` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // evita clique antes da hidratação
  useEffect(() => setReady(true), []);

  const searchAll = `/buscar?servico=${serviceSlug}&cidade=${citySlug}${neighborhoodSlug ? `&bairro=${neighborhoodSlug}` : ''}`;

  async function chamar(item: UrgentItem) {
    setBusy(item.id);
    setNotice(null);
    try {
      const res = await fetch('/api/contact/urgent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: item.id, serviceId, neighborhoodId, cityId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) {
        window.location.assign(body.url);
        return;
      }
      if (res.status === 409) {
        // Recarrega os resultados do servidor preservando serviço e bairro
        const qs = new URLSearchParams({ servico: serviceSlug, bairro: neighborhoodSlug ?? '', mudou: item.display_name });
        window.location.replace(`/hoje?${qs}`);
        return;
      } else if (res.status === 429) {
        setNotice('Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.');
      } else {
        setNotice('Não foi possível abrir o WhatsApp agora. Tente novamente.');
      }
    } catch {
      setNotice('Sem conexão. Verifique sua internet e tente novamente.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div aria-live="polite">
        {notice && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 font-medium text-amber-900">{notice}</p>
        )}
      </div>
      {items.length === 0 ? (
        <div className="card p-6" data-testid="urgent-empty">
          <span className="ic ic-lg" style={{ ['--t' as string]: 'var(--color-hoje-600)' }}><Glyph d="M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" size={28} /></span>
          <p className="mt-3 text-lg font-semibold">
            {neighborhoodSlug ? 'Ninguém confirmou disponibilidade para hoje nesse bairro ainda.' : `Ninguém confirmou disponibilidade para hoje em ${cityName} ainda.`}
          </p>
          <p className="mt-1 text-stone-600">
            {neighborhoodSlug ? `Procure em toda ${cityName} ou veja todos os profissionais desse serviço para combinar um horário.` : 'Veja todos os profissionais desse serviço e combine um horário.'}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {neighborhoodSlug && <Link className="btn-hoje" href={`/hoje?servico=${serviceSlug}`}>Buscar em toda {cityName}</Link>}
            <Link className="btn-outline" href={searchAll}>Ver todos os prestadores desse serviço</Link>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Profissionais disponíveis hoje">
          {items.map((item) => (
            <li key={item.id} className="card pc-wrap" data-testid="urgent-result">
              <button type="button" className="pc" onClick={() => chamar(item)} disabled={!ready || busy === item.id}
                aria-label={`Chamar no WhatsApp: ${item.display_name}`}>
                <Avatar src={item.photo} name={item.display_name} />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold leading-tight">{item.display_name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 font-semibold text-stone-800"><CategoryIcon slug={categorySlug} size="sm" />{item.service_name}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-sm text-stone-600"><Glyph d={PIN_PATH} size={14} />{areaText(item.area_label)}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="badge-hoje">● Atende hoje</span>
                    <span className="text-sm text-stone-700">Horário a combinar pelo WhatsApp</span>
                  </span>
                  <span className="pc-wa-label" aria-hidden="true"><WhatsAppIcon size={18} />{busy === item.id ? 'Abrindo…' : 'Chamar no WhatsApp'}</span>
                </span>
              </button>
              <div className="border-t border-stone-100 px-4 py-2">
                <Link className="text-sm font-semibold text-brand-700 underline" href={`/p/${item.slug}?hoje=1&servico=${serviceSlug}${neighborhoodSlug ? `&bairro=${neighborhoodSlug}` : ''}&voltar=${encodeURIComponent(`/hoje?servico=${serviceSlug}${neighborhoodSlug ? `&bairro=${neighborhoodSlug}` : ''}`)}`}>Ver perfil</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

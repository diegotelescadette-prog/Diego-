'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';

export interface UrgentItem {
  id: string; slug: string; display_name: string; photo: string | null; service_name: string; area_label: string;
}

export function UrgentResults({ items, serviceId, serviceSlug, neighborhoodId, neighborhoodSlug, changedName }: {
  items: UrgentItem[]; serviceId: number; serviceSlug: string; neighborhoodId: number; neighborhoodSlug: string; changedName?: string;
}) {
  const [notice, setNotice] = useState<string | null>(
    changedName ? `A disponibilidade de ${changedName} mudou e não está mais ativa para hoje. Atualizamos a lista.` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // evita clique antes da hidratação
  useEffect(() => setReady(true), []);

  async function chamar(item: UrgentItem) {
    setBusy(item.id);
    setNotice(null);
    try {
      const res = await fetch('/api/contact/urgent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: item.id, serviceId, neighborhoodId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) {
        window.location.assign(body.url);
        return;
      }
      if (res.status === 409) {
        // Recarrega os resultados do servidor preservando serviço e bairro
        const qs = new URLSearchParams({ servico: serviceSlug, bairro: neighborhoodSlug, mudou: item.display_name });
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
        <div className="card p-6 text-center">
          <p className="text-lg font-semibold">Ninguém confirmou disponibilidade para hoje nesse bairro ainda.</p>
          <p className="mt-1 text-stone-600">Veja todos os profissionais que atendem a região e combine um horário.</p>
          <Link className="btn-primary mt-4" href={`/buscar?servico=${serviceSlug}&cidade=campo-grande-ms&bairro=${neighborhoodSlug}`}>
            Ver todos nesse bairro
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Profissionais disponíveis hoje">
          {items.map((item) => (
            <li key={item.id} className="card flex flex-col gap-3 p-4" data-testid="urgent-result">
              <div className="flex gap-3">
                <Avatar src={item.photo} name={item.display_name} />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{item.display_name}</h2>
                  <p className="text-stone-700">{item.service_name}</p>
                  <p className="text-sm text-stone-600">Atende: {item.area_label}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge-hoje">● Atende hoje</span>
                <span className="text-sm text-stone-700">Horário a combinar pelo WhatsApp</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className="btn-zap flex-1" onClick={() => chamar(item)} disabled={!ready || busy === item.id}>
                  {busy === item.id ? 'Abrindo…' : 'Chamar no WhatsApp'}
                </button>
                <Link className="btn-ghost" href={`/p/${item.slug}?servico=${serviceSlug}&bairro=${neighborhoodSlug}`}>Ver perfil</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryIcon, Glyph } from './CategoryIcon';

export interface UrgentListCategory { slug: string; name: string; services: { slug: string; name: string; terms: string[] }[] }

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Lista de todos os serviços do "Preciso para hoje", agrupada por categoria, com filtro. */
export function UrgentServiceList({ categories, selected }: { categories: UrgentListCategory[]; selected?: string }) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const index = useMemo(() => categories.map((c) => ({
    ...c, services: c.services.map((s) => ({ ...s, key: norm(`${s.name} ${c.name} ${s.terms.join(' ')}`) })),
  })), [categories]);
  const qn = norm(q);
  const visible = index.map((c) => ({ ...c, services: c.services.filter((s) => !qn || s.key.includes(qn)) })).filter((c) => c.services.length);

  // Mostra o serviço já escolhido sem rolar a página inteira.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('input:checked');
    if (el && box.current) box.current.scrollTop = (el.closest('label') as HTMLElement).offsetTop - box.current.offsetTop - 40;
  }, []);

  return (
    <div>
      <div className="sb-row svc-filter">
        <Glyph d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar: pintor, diarista, montador…"
          aria-label="Filtrar serviços" autoComplete="off" />
      </div>
      <div ref={box} className="svclist" role="radiogroup" aria-label="Serviços">
        {index.map((c) => {
          const shown = visible.find((v) => v.slug === c.slug);
          return (
            <div key={c.slug} className="svcgroup" hidden={!shown}>
              <p className="svccat">{c.name}</p>
              {c.services.map((s) => (
                <label key={s.slug} className="svcopt" hidden={!shown?.services.some((v) => v.slug === s.slug)}>
                  <input type="radio" name="servico" value={s.slug} defaultChecked={selected === s.slug} required />
                  <CategoryIcon slug={c.slug} size="sm" />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
          );
        })}
        {visible.length === 0 && <p className="px-2 py-3 text-sm text-stone-600">Nenhum serviço com esse nome. Tente outra palavra.</p>}
      </div>
    </div>
  );
}

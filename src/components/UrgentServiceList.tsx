'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryIcon, Glyph } from './CategoryIcon';

export interface UrgentListCategory { slug: string; name: string; services: { slug: string; name: string; terms: string[] }[] }

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Lista de todos os serviços do "Preciso para hoje", agrupada por categoria, com filtro.
 * `collapsible` (tela inicial): a lista fica fechada; aparecem só os serviços que combinam com o que a pessoa digita,
 * ou a lista inteira ao tocar em "Ver todos os serviços". Depois de escolher, fica só o serviço escolhido.
 */
export function UrgentServiceList({ categories, selected, collapsible = false }: { categories: UrgentListCategory[]; selected?: string; collapsible?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!collapsible);
  const [picked, setPicked] = useState<string | undefined>(selected);
  const [missing, setMissing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const total = categories.reduce((n, c) => n + c.services.length, 0);
  const index = useMemo(() => categories.map((c) => ({
    ...c, services: c.services.map((s) => ({ ...s, key: norm(`${s.name} ${c.name} ${s.terms.join(' ')}`) })),
  })), [categories]);
  const qn = norm(q);
  // Fechada e sem filtro: mostra só o serviço já escolhido (se houver).
  const closed = collapsible && !open && !qn;
  const visible = index.map((c) => ({
    ...c, services: c.services.filter((s) => (closed ? s.slug === picked : !qn || s.key.includes(qn))),
  })).filter((c) => c.services.length);
  const pickedName = index.flatMap((c) => c.services).find((s) => s.slug === picked)?.name;

  // Mostra o serviço já escolhido sem rolar a página inteira.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('input:checked');
    if (el && box.current) box.current.scrollTop = (el.closest('label') as HTMLElement).offsetTop - box.current.offsetTop - 40;
  }, []);

  return (
    <div>
      <div className="sb-row svc-filter">
        <Glyph d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={collapsible ? 'Ex.: eletricista, diarista…' : 'Filtrar: pintor, diarista, montador…'}
          aria-label="Filtrar serviços" autoComplete="off" />
      </div>
      {missing && !picked && <p className="mb-2 text-sm font-semibold text-hoje-700" role="alert">Escolha um serviço para continuar.</p>}
      <div ref={box} className="svclist" role="radiogroup" aria-label="Serviços" hidden={closed && !picked}
        onChange={(e) => {
          const t = e.target as HTMLInputElement;
          if (t.name !== 'servico') return;
          setPicked(t.value); setMissing(false);
          if (collapsible) { setQ(''); setOpen(false); }
        }}
        onInvalidCapture={(e) => { if (collapsible) { e.preventDefault(); setMissing(true); setOpen(true); } }}>
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
        {visible.length === 0 && !closed && <p className="px-2 py-3 text-sm text-stone-600">Nenhum serviço com esse nome. Tente outra palavra.</p>}
      </div>
      {collapsible && !qn && (
        <button type="button" className="mt-2 text-sm font-semibold text-brand-700 underline" aria-expanded={open}
          onClick={() => setOpen((o) => !o)}>
          {open ? 'Fechar a lista' : pickedName ? 'Trocar serviço' : `Ou veja todos os serviços (${total})`}
        </button>
      )}
    </div>
  );
}

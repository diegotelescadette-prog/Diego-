'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Category } from '@/lib/types';

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function ServicePicker({ catalog, selected, main, error, mainError }: {
  catalog: Category[]; selected: number[]; main: number | null; error?: string; mainError?: string;
}) {
  const [chosen, setChosen] = useState<number[]>(selected);
  const [mainId, setMainId] = useState<number | null>(main);
  const [filter, setFilter] = useState('');
  const byId = useMemo(() => new Map(catalog.flatMap((c) => c.services).map((s) => [s.id, s])), [catalog]);
  const f = norm(filter.trim());

  function toggle(id: number) {
    setChosen((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      if (!next.includes(mainId ?? -1)) setMainId(next[0] ?? null);
      return next;
    });
  }

  return (
    <fieldset aria-describedby={error ? 'services-error' : 'services-hint'}>
      <legend className="label">Serviços que você oferece</legend>
      <p id="services-hint" className="hint mb-2">Escolha um ou mais. Procure pelo nome.</p>
      <label htmlFor="svc-filter" className="sr-only">Procurar serviço</label>
      <input id="svc-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="input" placeholder="Procurar serviço (ex.: pintor)" />
      {chosen.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Serviços escolhidos">
          {chosen.map((id) => (
            <li key={id}>
              <button type="button" className="chip" onClick={() => toggle(id)} aria-label={`Remover ${byId.get(id)?.name}`}>
                {byId.get(id)?.name} ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-surface p-2">
        {catalog.map((c) => {
          const items = c.services.filter((s) => !f || norm(s.name).includes(f) || norm(c.name).includes(f));
          if (!items.length) return null;
          return (
            <div key={c.id} className="mb-2">
              <p className="px-1 text-xs font-bold uppercase tracking-wide text-stone-500">{c.name}</p>
              {items.map((s) => (
                <label key={s.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-brand-50">
                  <input type="checkbox" className="h-5 w-5" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
                  {s.name}
                  {s.mode !== 'presencial' && <span className="text-xs text-stone-500">({s.mode === 'online' ? 'online' : 'presencial ou online'})</span>}
                </label>
              ))}
            </div>
          );
        })}
        <p className="px-1 py-2 text-sm">Não achou? <Link href="/sugerir-servico" className="font-semibold text-brand-700 underline" target="_blank">Sugerir um serviço</Link></p>
      </div>
      {chosen.map((id) => <input key={id} type="hidden" name="services" value={id} />)}
      {error && <p id="services-error" className="field-error" role="alert">{error}</p>}

      {chosen.length > 1 && (
        <div className="mt-3">
          <label htmlFor="main_service" className="label">Serviço principal</label>
          <select id="main_service" name="main_service" className="input" value={mainId ?? ''} onChange={(e) => setMainId(Number(e.target.value))}
            aria-invalid={!!mainError}>
            {chosen.map((id) => <option key={id} value={id}>{byId.get(id)?.name}</option>)}
          </select>
          <p className="hint">Aparece em destaque nos resultados.</p>
          {mainError && <p className="field-error" role="alert">{mainError}</p>}
        </div>
      )}
      {chosen.length === 1 && <input type="hidden" name="main_service" value={chosen[0]} />}
    </fieldset>
  );
}

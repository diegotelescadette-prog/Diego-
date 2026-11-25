'use client';
import { useState } from 'react';
import type { Neighborhood } from '@/lib/types';

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function NeighborhoodPicker({ name, options, selected, error, legend }: {
  name: string; options: Neighborhood[]; selected: number[]; error?: string; legend: string;
}) {
  const [chosen, setChosen] = useState<number[]>(selected);
  const [filter, setFilter] = useState('');
  const f = norm(filter);
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <fieldset aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="label">{legend}</legend>
      <div className="flex gap-2">
        <label htmlFor={`${name}-filter`} className="sr-only">Procurar bairro</label>
        <input id={`${name}-filter`} type="search" className="input" placeholder="Procurar bairro" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="hint">{chosen.length} selecionado(s) ·{' '}
        <button type="button" className="underline" onClick={() => setChosen(options.map((o) => o.id))}>marcar todos</button> ·{' '}
        <button type="button" className="underline" onClick={() => setChosen([])}>limpar</button>
      </p>
      <div className="mt-2 grid max-h-64 grid-cols-1 gap-x-3 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2 sm:grid-cols-2">
        {options.filter((o) => !f || norm(o.name).includes(f)).map((o) => (
          <label key={o.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-brand-50">
            <input type="checkbox" name={name} value={o.id} checked={chosen.includes(o.id)} onChange={() => toggle(o.id)} className="h-5 w-5" />
            {o.name}
          </label>
        ))}
      </div>
      {/* Mantém selecionados que estão ocultos pelo filtro */}
      {chosen.filter((id) => f && !options.find((o) => o.id === id && norm(o.name).includes(f))).map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {error && <p id={`${name}-error`} className="field-error" role="alert">{error}</p>}
    </fieldset>
  );
}

import { UrgentServiceList, type UrgentListCategory } from './UrgentServiceList';
import type { Neighborhood } from '@/lib/types';
import { PILOT_CITY_LABEL } from '@/config/brand';

export function UrgentForm({ categories, neighborhoods, service, neighborhood, compact = false, home = false }: {
  categories: UrgentListCategory[]; neighborhoods: Neighborhood[]; service?: string; neighborhood?: string; compact?: boolean;
  /** Tela inicial: lista de serviços fechada (aparece ao digitar) e textos mais curtos. */
  home?: boolean;
}) {
  return (
    <form action="/hoje" method="get" className="space-y-4" aria-label="Preciso para hoje">
      <fieldset className="min-w-0">
        <legend className="label mb-2 text-base">{compact ? 'Serviço' : '1. Do que você precisa hoje?'}</legend>
        <UrgentServiceList categories={categories} selected={service} collapsible={home} />
      </fieldset>
      <div>
        <label htmlFor="bairro" className="label text-base">{compact ? 'Bairro (opcional)' : '2. Em qual bairro? (opcional)'}</label>
        <select id="bairro" name="bairro" defaultValue={neighborhood ?? ''} className="input">
          <option value="">Todos os bairros</option>
          {neighborhoods.map((n) => <option key={n.slug} value={n.slug}>{n.name}</option>)}
        </select>
        {!home && <p className="hint">Cidade: <strong>{PILOT_CITY_LABEL}</strong>. Sem bairro, mostramos quem atende hoje em toda a cidade.</p>}
      </div>
      <button type="submit" className="btn-hoje min-h-13 w-full text-lg">Ver quem atende hoje</button>
    </form>
  );
}

/** Monta as categorias do formulário a partir do catálogo e dos sinônimos (no servidor). */
export function toUrgentList(
  catalog: { slug: string; name: string; services: { id: number; slug: string; name: string }[] }[],
  synonyms: Record<number, string[]>,
): UrgentListCategory[] {
  return catalog.map((c) => ({ slug: c.slug, name: c.name, services: c.services.map((s) => ({ slug: s.slug, name: s.name, terms: synonyms[s.id] ?? [] })) }));
}

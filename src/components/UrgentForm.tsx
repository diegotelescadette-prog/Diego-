import { ServiceIcon } from './ServiceIcon';
import type { Neighborhood, Service } from '@/lib/types';
import { PILOT_CITY_LABEL } from '@/config/brand';

export function UrgentForm({ services, neighborhoods, service, neighborhood, compact = false }: {
  services: Service[]; neighborhoods: Neighborhood[]; service?: string; neighborhood?: string; compact?: boolean;
}) {
  return (
    <form action="/hoje" method="get" className="space-y-4" aria-label="Preciso para hoje">
      <fieldset>
        <legend className="label text-base">{compact ? 'Serviço' : '1. Do que você precisa hoje?'}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {services.map((s) => (
            <label key={s.slug} className="cursor-pointer">
              <input type="radio" name="servico" value={s.slug} defaultChecked={service === s.slug} required className="peer sr-only" />
              <span className="flex h-full min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-stone-200 bg-white p-3 text-center text-sm font-semibold text-stone-800 transition peer-checked:border-hoje-600 peer-checked:bg-orange-50 peer-checked:text-hoje-700 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-hoje-500 hover:border-hoje-500">
                <ServiceIcon slug={s.slug} className="h-7 w-7" />
                {s.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor="bairro" className="label text-base">{compact ? 'Bairro' : '2. Em qual bairro?'}</label>
          <select id="bairro" name="bairro" required defaultValue={neighborhood ?? ''} className="input">
            <option value="" disabled>Escolha o bairro</option>
            {neighborhoods.map((n) => <option key={n.slug} value={n.slug}>{n.name}</option>)}
          </select>
          <p className="hint">Cidade: <strong>{PILOT_CITY_LABEL}</strong></p>
        </div>
        <button type="submit" className="btn-hoje w-full sm:w-auto sm:self-start sm:mt-6">Ver quem atende hoje</button>
      </div>
    </form>
  );
}

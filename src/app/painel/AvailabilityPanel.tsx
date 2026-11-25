'use client';
import { useActionState, useState } from 'react';
import { disableToday, enableToday } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { NeighborhoodPicker } from '@/components/NeighborhoodPicker';
import type { Neighborhood } from '@/lib/types';

interface Svc { id: number; name: string; urgent_pilot: boolean }

export function AvailabilityPanel({ active, services, areaNeighborhoods, servesWholeCity, cityName }: {
  active: null | { until: string; whole_city: boolean; services: Svc[]; neighborhoods: string[] };
  services: Svc[]; areaNeighborhoods: Neighborhood[]; servesWholeCity: boolean; cityName: string;
}) {
  const [state, action] = useActionState(enableToday, undefined);
  const [restrict, setRestrict] = useState(false);
  const [whole, setWhole] = useState(servesWholeCity);
  const eligible = services.filter((s) => s.urgent_pilot);

  const info = (
    <p className="text-sm text-stone-700">
      Ao ativar, visitantes sem cadastro podem te chamar no WhatsApp pelo <strong>“Preciso para hoje”</strong>
      {eligible.length > 0
        ? <> nos serviços elegíveis do piloto: {eligible.map((s) => s.name).join(', ')}.</>
        : <>, que no piloto vale para encanador, eletricista, chaveiro e técnico de ar-condicionado. Seus serviços aparecem com “Atende hoje” na busca geral.</>}
      {' '}Vale até a meia-noite (horário de {cityName}).
    </p>
  );

  if (active) {
    return (
      <div className="space-y-3" data-testid="today-active">
        <p className="text-lg font-bold text-amber-900"><span className="badge-hoje">● Atendo hoje</span> ativo até {active.until}</p>
        <div>
          <p className="font-semibold">Serviços incluídos</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {active.services.map((s) => (
              <li key={s.id} className="chip">{s.name}{s.urgent_pilot ? ' · contato sem login' : ''}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold">Área de hoje</p>
          <p className="text-stone-700">{active.whole_city ? `Toda ${cityName}` : active.neighborhoods.join(', ')}</p>
        </div>
        {info}
        <form action={disableToday}>
          <SubmitButton className="btn-outline w-full sm:w-auto" pendingText="Desativando…">Desativar “Atendo hoje”</SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {info}
      {state?.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
      <button type="button" className="text-sm font-semibold text-brand-700 underline" aria-expanded={restrict} onClick={() => setRestrict((r) => !r)}>
        {restrict ? 'Usar meus serviços e área cadastrados' : 'Restringir serviços ou bairros só para hoje'}
      </button>
      <div className={restrict ? 'space-y-4' : 'hidden'}>
        <fieldset>
          <legend className="label">Serviços de hoje</legend>
          {services.map((s) => (
            <label key={s.id} className="flex min-h-10 items-center gap-2">
              <input type="checkbox" name="today_services" value={s.id} defaultChecked className="h-5 w-5" /> {s.name}
              {s.urgent_pilot && <span className="text-xs text-stone-500">(contato sem login)</span>}
            </label>
          ))}
          {state?.errors?.today_services && <p className="field-error">{state.errors.today_services}</p>}
        </fieldset>
        {servesWholeCity && (
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" name="today_whole_city" checked={whole} onChange={(e) => setWhole(e.target.checked)} className="h-5 w-5" /> Toda {cityName}
          </label>
        )}
        {!whole && (
          <NeighborhoodPicker name="today_neighborhoods" legend="Bairros de hoje" options={areaNeighborhoods}
            selected={servesWholeCity ? [] : areaNeighborhoods.map((n) => n.id)} error={state?.errors?.today_neighborhoods} />
        )}
      </div>
      {!restrict && (
        <>
          {services.map((s) => <input key={s.id} type="hidden" name="today_services" value={s.id} />)}
          {servesWholeCity ? <input type="hidden" name="today_whole_city" value="on" /> :
            areaNeighborhoods.map((n) => <input key={n.id} type="hidden" name="today_neighborhoods" value={n.id} />)}
        </>
      )}
      <SubmitButton className="btn-hoje w-full sm:w-auto" pendingText="Ativando…">Atendo hoje</SubmitButton>
    </form>
  );
}

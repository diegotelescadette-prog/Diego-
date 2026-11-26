'use client';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { disableToday, enableToday } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { NeighborhoodPicker } from '@/components/NeighborhoodPicker';
import type { Neighborhood } from '@/lib/types';

export interface TodaySvc { id: number; name: string; urgent_pilot: boolean }
export interface TodayActive {
  until: string; whole_city: boolean; services: TodaySvc[]; neighborhoods: string[]; neighborhood_ids: number[];
}

/** "Atendo hoje". mode='resumo' (Visão geral): ativa com a cobertura habitual em um toque.
 *  mode='completo' (Disponibilidade): escolhe serviços e bairros do dia, ajusta e desativa. */
export function AvailabilityPanel({ active, services, areaNeighborhoods, servesWholeCity, cityName, mode = 'resumo' }: {
  active: TodayActive | null; services: TodaySvc[]; areaNeighborhoods: Neighborhood[]; servesWholeCity: boolean; cityName: string;
  mode?: 'resumo' | 'completo';
}) {
  const [state, action] = useActionState(enableToday, undefined);
  const eligible = services.filter((s) => s.urgent_pilot);

  const info = (
    <p className="text-sm text-stone-700">
      {eligible.length > 0
        ? <>Ao ativar, visitantes sem cadastro podem te chamar no WhatsApp pelo <strong>“Preciso para hoje”</strong> em: {eligible.map((s) => s.name).join(', ')}.</>
        : <>Seus serviços aparecem com “Atende hoje” na busca geral. Eles não fazem parte da lista do <strong>“Preciso para hoje”</strong>.</>}
      {' '}Vale até a meia-noite (horário de {cityName}).
    </p>
  );
  const feedback = state?.message && (
    <p role={state.ok ? 'status' : 'alert'} className={`rounded-xl p-3 ${state.ok ? 'bg-sage text-stone-900' : 'bg-red-50 text-red-900'}`}>{state.message}</p>
  );

  const summary = active && (
    <div className="space-y-3" data-testid="today-active">
      <p className="text-lg font-bold text-stone-900"><span className="badge-hoje">● Atendo hoje</span> ativo até {active.until}</p>
      <div>
        <p className="font-semibold">Serviços de hoje</p>
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
    </div>
  );
  const disable = (
    <form action={disableToday}>
      <SubmitButton className="btn-outline w-full sm:w-auto" pendingText="Desativando…">Desativar “Atendo hoje”</SubmitButton>
    </form>
  );

  // Escolha de serviços e área do dia (padrão: o que está ativo ou a cobertura habitual).
  const chooser = (
    <div className="space-y-4">
      <fieldset>
        <legend className="label">Serviços de hoje</legend>
        {services.map((s) => (
          <label key={s.id} className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="today_services" value={s.id} defaultChecked={!active || active.services.some((x) => x.id === s.id)} className="h-5 w-5" /> {s.name}
            {s.urgent_pilot && <span className="text-xs text-stone-500">(contato sem login)</span>}
          </label>
        ))}
        {state?.errors?.today_services && <p className="field-error">{state.errors.today_services}</p>}
      </fieldset>
      <TodayArea servesWholeCity={servesWholeCity} cityName={cityName} areaNeighborhoods={areaNeighborhoods}
        initialWhole={active ? active.whole_city : servesWholeCity}
        initialIds={active ? active.neighborhood_ids : servesWholeCity ? [] : areaNeighborhoods.map((n) => n.id)}
        error={state?.errors?.today_neighborhoods} />
    </div>
  );

  if (mode === 'resumo') {
    return (
      <div className="space-y-3">
        {feedback}
        {active ? summary : (
          <form action={action} className="space-y-3">
            {info}
            {services.map((s) => <input key={s.id} type="hidden" name="today_services" value={s.id} />)}
            {servesWholeCity ? <input type="hidden" name="today_whole_city" value="on" /> :
              areaNeighborhoods.map((n) => <input key={n.id} type="hidden" name="today_neighborhoods" value={n.id} />)}
            <p className="text-sm text-stone-600">Usa seus serviços presenciais e sua área habitual: {servesWholeCity ? `toda ${cityName}` : `${areaNeighborhoods.length} ${areaNeighborhoods.length === 1 ? 'bairro' : 'bairros'}`}.</p>
            <SubmitButton className="btn-hoje w-full sm:w-auto" pendingText="Ativando…">Atendo hoje</SubmitButton>
          </form>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href="/painel/disponibilidade" className="btn-ghost">Ajustar disponibilidade de hoje</Link>
          {active && disable}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {feedback}
      {summary}
      <form action={action} className="space-y-4">
        {active ? <input type="hidden" name="ajuste" value="1" /> : info}
        <h3 className="text-lg font-bold">{active ? 'Ajustar o dia' : 'Escolha o que vale hoje'}</h3>
        {chooser}
        <SubmitButton className="btn-hoje w-full sm:w-auto" pendingText="Salvando…">{active ? 'Salvar ajuste de hoje' : 'Atendo hoje'}</SubmitButton>
      </form>
      {active && <div className="border-t border-stone-200 pt-4">{disable}</div>}
    </div>
  );
}

function TodayArea({ servesWholeCity, cityName, areaNeighborhoods, initialWhole, initialIds, error }: {
  servesWholeCity: boolean; cityName: string; areaNeighborhoods: Neighborhood[]; initialWhole: boolean; initialIds: number[]; error?: string;
}) {
  const [whole, setWhole] = useState(initialWhole);
  return (
    <>
      {servesWholeCity && (
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="today_whole_city" checked={whole} onChange={(e) => setWhole(e.target.checked)} className="h-5 w-5" /> Toda {cityName}
        </label>
      )}
      {!whole && (
        <NeighborhoodPicker name="today_neighborhoods" legend="Bairros de hoje" options={areaNeighborhoods} selected={initialIds} error={error} />
      )}
    </>
  );
}

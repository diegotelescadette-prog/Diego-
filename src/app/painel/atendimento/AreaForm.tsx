'use client';
import { useActionState, useState } from 'react';
import { Field } from '@/components/Field';
import { NeighborhoodPicker } from '@/components/NeighborhoodPicker';
import { SubmitButton } from '@/components/SubmitButton';
import { saveAreaStep } from '../actions';
import { UFS } from '@/lib/validation';
import type { City, Neighborhood } from '@/lib/types';

export interface AreaInitial {
  cep: string; street: string; number: string; complement: string; ref_neighborhood: string; ref_city: string; uf: string;
  city_id: number | null; whole_city: boolean; online: boolean; neighborhoods: number[]; status: string;
}

export function AreaForm({ initial, cities, neighborhoods, canOnline }: {
  initial: AreaInitial; cities: City[]; neighborhoods: Neighborhood[]; canOnline: boolean;
}) {
  const [state, action] = useActionState(saveAreaStep, undefined);
  const [addr, setAddr] = useState({ street: initial.street, ref_neighborhood: initial.ref_neighborhood, ref_city: initial.ref_city, uf: initial.uf });
  const [cepMsg, setCepMsg] = useState<string | null>(null);
  const [mode, setMode] = useState(initial.whole_city ? 'cidade' : initial.neighborhoods.length ? 'bairros' : '');
  // Perfil antigo: tem endereço mas nunca escolheu a área atendida.
  const needsConfirm = !initial.whole_city && initial.neighborhoods.length === 0 && !!initial.street;
  const [cityId, setCityId] = useState<number | null>(initial.city_id ?? cities[0]?.id ?? null);
  const e = state?.errors ?? {};
  const v = (k: 'cep' | 'number' | 'complement') => state?.values?.[k] ?? initial[k];
  const inv = (k: string) => ({ 'aria-invalid': !!e[k], 'aria-describedby': e[k] ? `${k}-error` : undefined });

  async function lookupCep(cep: string) {
    const d = cep.replace(/\D/g, '');
    if (d.length !== 8) { setCepMsg('Digite os 8 números do CEP.'); return; }
    setCepMsg('Buscando endereço…');
    try {
      const r = await fetch(`/api/cep/${d}`);
      const j = await r.json();
      if (!r.ok) { setCepMsg(j.error ?? 'CEP não encontrado. Preencha manualmente.'); return; }
      setAddr({ street: j.street, ref_neighborhood: j.neighborhood, ref_city: j.city, uf: j.uf });
      setCepMsg('Endereço preenchido. Confira e complete o número.');
    } catch { setCepMsg('Não foi possível consultar o CEP. Preencha manualmente.'); }
  }

  const cityNbs = neighborhoods.filter((n) => n.city_id === cityId);

  return (
    <form action={action} className="space-y-6" noValidate>
      {state?.message && (
        <p role={state.ok ? 'status' : 'alert'} className={`rounded-xl p-3 ${state.ok ? 'bg-sage text-stone-900' : 'bg-red-50 text-red-900'}`}>{state.message}</p>
      )}
      <section aria-labelledby="area-title" className="space-y-4">
        <div>
          <h2 id="area-title" className="text-lg font-bold">Área de atendimento</h2>
          <p className="text-sm text-stone-600">Onde você vai até o cliente. Pode ser diferente do seu endereço.</p>
        </div>
        <Field id="city_id" label="Cidade onde você atende" error={e.city_id}>
          <select id="city_id" name="city_id" className="input" value={cityId ?? ''} onChange={(ev) => setCityId(Number(ev.target.value))}>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}–{c.uf}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend className="label text-base">Onde você atende?</legend>
          {needsConfirm && mode === '' && (
            <p role="status" className="mb-2 rounded-xl bg-hoje-100 p-3 font-medium text-stone-900">Confirme sua área de atendimento. Só assim seu perfil aparece na busca do bairro certo.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="area-opt">
              <input type="radio" name="area_mode" value="cidade" checked={mode === 'cidade'} onChange={() => setMode('cidade')} className="h-5 w-5" />
              <span><strong>Atendo em toda {cities.find((c) => c.id === cityId)?.name ?? 'a cidade'}</strong><span className="block text-sm text-stone-600">Um clique e você aparece em qualquer bairro.</span></span>
            </label>
            <label className="area-opt">
              <input type="radio" name="area_mode" value="bairros" checked={mode === 'bairros'} onChange={() => setMode('bairros')} className="h-5 w-5" />
              <span><strong>Atendo em bairros selecionados</strong><span className="block text-sm text-stone-600">Escolha um ou mais bairros.</span></span>
            </label>
          </div>
          {e.area_mode && <p className="field-error" id="area_mode-error">{e.area_mode}</p>}
        </fieldset>
        {mode === 'bairros' && (
          <NeighborhoodPicker name="neighborhoods" legend="Bairros atendidos" options={cityNbs} selected={initial.neighborhoods} error={e.neighborhoods} />
        )}
        {mode === 'cidade' && e.neighborhoods && <p className="field-error">{e.neighborhoods}</p>}
        {canOnline ? (
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="online" defaultChecked={initial.online} className="h-5 w-5" /> Também atendo online
          </label>
        ) : (
          <p className="text-sm text-stone-600">Atendimento online fica disponível quando você oferece um serviço que pode ser feito a distância.</p>
        )}
        {e.online && <p className="field-error">{e.online}</p>}
      </section>
      <section aria-labelledby="ref-title" className="space-y-4 border-t border-stone-200 pt-5">
        <div>
          <h2 id="ref-title" className="flex flex-wrap items-center gap-2 text-lg font-bold">Endereço de referência <span className="tag bg-stone-200 text-stone-800">Privado</span></h2>
          <p className="text-sm text-stone-600">Privado. Não aparece no perfil — os clientes veem só a região que você atende.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="cep" label="CEP" error={e.cep}>
            <input id="cep" name="cep" inputMode="numeric" autoComplete="postal-code" defaultValue={v('cep')} placeholder="79000-000" className="input" {...inv('cep')}
              onBlur={(ev) => { if (ev.target.value.replace(/\D/g, '').length === 8 && !addr.street) lookupCep(ev.target.value); }} />
          </Field>
          <button type="button" className="btn-outline" onClick={() => lookupCep((document.getElementById('cep') as HTMLInputElement).value)}>Preencher pelo CEP</button>
        </div>
        <p aria-live="polite" className="text-sm text-stone-700">{cepMsg}</p>
        <Field id="street" label="Rua" error={e.street}>
          <input id="street" name="street" value={addr.street} onChange={(ev) => setAddr({ ...addr, street: ev.target.value })} autoComplete="address-line1" className="input" {...inv('street')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="number" label="Número" error={e.number}>
            <input id="number" name="number" defaultValue={v('number')} className="input" {...inv('number')} />
          </Field>
          <Field id="complement" label="Complemento" error={e.complement}>
            <input id="complement" name="complement" defaultValue={v('complement')} className="input" />
          </Field>
        </div>
        <Field id="ref_neighborhood" label="Bairro" error={e.ref_neighborhood}>
          <input id="ref_neighborhood" name="ref_neighborhood" value={addr.ref_neighborhood} onChange={(ev) => setAddr({ ...addr, ref_neighborhood: ev.target.value })} className="input" {...inv('ref_neighborhood')} />
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field id="ref_city" label="Cidade" error={e.ref_city}>
            <input id="ref_city" name="ref_city" value={addr.ref_city} onChange={(ev) => setAddr({ ...addr, ref_city: ev.target.value })} autoComplete="address-level2" className="input" {...inv('ref_city')} />
          </Field>
          <Field id="uf" label="UF" error={e.uf}>
            <select id="uf" name="uf" value={addr.uf} onChange={(ev) => setAddr({ ...addr, uf: ev.target.value })} className="input" {...inv('uf')}>
              <option value="">—</option>
              {UFS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </Field>
        </div>
      </section>


      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {initial.status === 'draft' && <SubmitButton name="intent" value="rascunho" className="btn-ghost" pendingText="Salvando…">Salvar rascunho</SubmitButton>}
        <SubmitButton name="intent" value="continuar" className="btn-primary" pendingText="Salvando…">
          {initial.status === 'draft' ? 'Ver prévia do perfil' : 'Salvar alterações'}
        </SubmitButton>
      </div>
    </form>
  );
}

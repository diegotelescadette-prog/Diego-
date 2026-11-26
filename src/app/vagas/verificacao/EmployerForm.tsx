'use client';
import { useActionState, useState } from 'react';
import { Field } from '@/components/Field';
import { submitEmployer, type EmployerState } from './actions';

export function EmployerForm({ neighborhoods, initial }: { neighborhoods: { id: number; name: string }[]; initial?: Record<string, string> }) {
  const [state, action, pending] = useActionState<EmployerState, FormData>(submitEmployer, {});
  const v = state.values ?? initial ?? {};
  const [kind, setKind] = useState(v.kind || 'cnpj');
  const e = state.errors ?? {};
  const inv = (k: string) => (e[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-error` } : {});
  if (state.ok) return <p role="status" className="safety" data-testid="employer-sent">{state.message}</p>;
  return (
    <form action={action} className="space-y-4" noValidate data-testid="employer-form">
      {state.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
      <fieldset>
        <legend className="label">Quem está contratando?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="choice"><input type="radio" name="kind" value="cnpj" checked={kind === 'cnpj'} onChange={() => setKind('cnpj')} /> Uma empresa (CNPJ)</label>
          <label className="choice"><input type="radio" name="kind" value="cpf" checked={kind === 'cpf'} onChange={() => setKind('cpf')} /> Eu, como pessoa (CPF)</label>
        </div>
        {e.kind && <p className="field-error" role="alert">{e.kind}</p>}
      </fieldset>
      <Field id="document" label={kind === 'cpf' ? 'CPF' : 'CNPJ'} error={e.document} hint={kind === 'cpf' ? 'Guardado cifrado. Só a equipe confere e ninguém mais vê.' : 'A equipe confere se o CNPJ está ativo na Receita.'}>
        <input id="document" name="document" className="input" inputMode="numeric" autoComplete="off" placeholder={kind === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'} {...inv('document')} />
      </Field>
      <Field id="legal_name" label={kind === 'cpf' ? 'Nome completo' : 'Razão social ou nome da empresa'} error={e.legal_name}>
        <input id="legal_name" name="legal_name" className="input" maxLength={120} defaultValue={v.legal_name} {...inv('legal_name')} />
      </Field>
      <Field id="address" label="Endereço (rua, número e complemento)" error={e.address} hint="Usado nas entrevistas presenciais. A equipe confere se é um endereço real.">
        <input id="address" name="address" className="input" maxLength={200} defaultValue={v.address} {...inv('address')} />
      </Field>
      <Field id="neighborhood_id" label="Bairro" error={e.neighborhood_id}>
        <select id="neighborhood_id" name="neighborhood_id" className="input" defaultValue={v.neighborhood_id ?? ''}>
          <option value="">Escolha</option>
          {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </Field>
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Enviando…' : 'Enviar para conferência'}</button>
    </form>
  );
}

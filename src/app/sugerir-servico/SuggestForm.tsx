'use client';
import { useActionState } from 'react';
import { suggestService } from '@/app/painel/actions';
import { SubmitButton } from '@/components/SubmitButton';

export function SuggestForm() {
  const [state, action] = useActionState(suggestService, undefined);
  if (state?.ok) return <p role="status" className="rounded-xl bg-sage p-3 text-stone-900">{state.message}</p>;
  return (
    <form action={action} className="space-y-3">
      {state?.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
      <div>
        <label htmlFor="name" className="label">Nome do serviço</label>
        <input id="name" name="name" className="input" maxLength={80} required aria-invalid={!!state?.errors?.name} />
        {state?.errors?.name && <p className="field-error">{state.errors.name}</p>}
      </div>
      <div>
        <label htmlFor="note" className="label">Observação <span className="font-normal text-stone-500">(opcional)</span></label>
        <textarea id="note" name="note" className="input" rows={3} maxLength={300} />
      </div>
      <SubmitButton>Enviar sugestão</SubmitButton>
    </form>
  );
}

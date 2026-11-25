'use client';
import { useActionState } from 'react';
import { deleteAccount } from './actions';
import { SubmitButton } from '@/components/SubmitButton';

export function DeleteAccount() {
  const [state, action] = useActionState(deleteAccount, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-stone-700">Remove sua conta, seu perfil profissional, dados privados (telefone, CPF, endereço), fotos e favoritos. Não é possível desfazer.</p>
      <label htmlFor="confirm" className="label">Digite EXCLUIR para confirmar</label>
      <input id="confirm" name="confirm" className="input max-w-xs" autoComplete="off" />
      {state?.message && <p role="alert" className="field-error">{state.message}</p>}
      <SubmitButton className="btn-danger" pendingText="Excluindo…">Excluir minha conta e meus dados</SubmitButton>
    </form>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { setProviderStatus } from './actions';
import { SubmitButton } from '@/components/SubmitButton';

/** Suspender ou reativar: pede confirmação e o motivo, que vai para o histórico de moderação. */
export function ConfirmStatus({ providerId, name, suspended, back }: { providerId: string; name: string; suspended: boolean; back: string }) {
  const [open, setOpen] = useState(false);
  const note = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) note.current?.focus(); }, [open]);
  const verb = suspended ? 'Reativar' : 'Suspender';

  if (!open) {
    return (
      <button ref={trigger} type="button" className={suspended ? 'btn-outline' : 'btn-danger'} onClick={() => setOpen(true)}>{verb}</button>
    );
  }
  return (
    <form action={setProviderStatus} className="w-full space-y-2 rounded-xl border border-stone-300 bg-stone-50 p-3 sm:w-80"
      onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); } }}>
      <p className="font-semibold">{suspended ? `Reativar ${name}?` : `Suspender ${name}?`}</p>
      <p className="text-sm text-stone-700">
        {suspended
          ? 'O perfil volta para a busca se o cadastro estiver completo; senão, volta como rascunho.'
          : 'O perfil sai da busca, o “Atendo hoje” é desligado e o contato fica bloqueado.'}
      </p>
      <input type="hidden" name="provider_id" value={providerId} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="status" value={suspended ? 'published' : 'suspended'} />
      <label className="label" htmlFor={`m-${providerId}`}>Motivo (vai para o histórico)</label>
      <input ref={note} id={`m-${providerId}`} name="note" required minLength={3} placeholder="Motivo (obrigatório)" className="input" />
      <div className="flex flex-wrap gap-2">
        <SubmitButton className={suspended ? 'btn-primary' : 'btn-danger'} pendingText="Salvando…">{suspended ? 'Confirmar reativação' : 'Confirmar suspensão'}</SubmitButton>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}

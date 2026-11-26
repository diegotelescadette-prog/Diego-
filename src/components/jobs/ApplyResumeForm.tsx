'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { applyWithResume, type ApplyState } from '@/app/vagas/actions';

/** "Enviar meu currículo": usa o currículo do app. O telefone só vai junto se a pessoa marcar. */
export function ApplyResumeForm({ jobId, posterLabel, headline, hasPhone }: { jobId: string; posterLabel: string; headline: string; hasPhone: boolean }) {
  const [state, action, pending] = useActionState<ApplyState, FormData>(applyWithResume, undefined);
  if (state?.ok) {
    return (
      <div role="status" className="rounded-2xl bg-sage p-4 text-stone-900" data-testid="candidatura-ok">
        <p className="font-bold">Currículo enviado!</p>
        <p className="mt-1">{posterLabel} recebeu seu currículo. Acompanhe em <Link className="underline" href="/minhas-candidaturas">Minhas candidaturas</Link>.</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3" data-testid="apply-resume">
      <input type="hidden" name="job_id" value={jobId} />
      {state?.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
      <p className="text-stone-700">Vai o seu currículo do app: <strong>{headline}</strong>. <Link href="/curriculo" className="text-brand-700 underline">Revisar</Link></p>
      <div>
        <label htmlFor="message" className="label">Mensagem <span className="font-normal text-stone-500">(opcional)</span></label>
        <textarea id="message" name="message" className="input" rows={3} maxLength={1500} placeholder="Conte por que a vaga combina com você" />
      </div>
      {hasPhone && (
        <label className="flex items-start gap-3">
          <input type="checkbox" name="share_phone" className="mt-1 h-5 w-5 flex-none" />
          <span>Mostrar meu WhatsApp para {posterLabel}. <span className="text-stone-600">Sem marcar, a empresa fala com você pelo e-mail.</span></span>
        </label>
      )}
      <button type="submit" className="btn-hoje w-full" disabled={pending}>{pending ? 'Enviando…' : 'Enviar meu currículo'}</button>
    </form>
  );
}

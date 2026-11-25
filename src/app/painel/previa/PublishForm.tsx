'use client';
import { useActionState } from 'react';
import { publishProfile } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';

export function PublishForm({ label }: { label: string }) {
  const [state, action] = useActionState(publishProfile, undefined);
  return (
    <form action={action} className="space-y-2">
      {state?.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
      <SubmitButton className="btn-hoje w-full sm:w-auto" pendingText="Publicando…">{label}</SubmitButton>
    </form>
  );
}

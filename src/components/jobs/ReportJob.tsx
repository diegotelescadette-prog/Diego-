'use client';
import { useActionState } from 'react';
import { reportJob } from '@/app/vagas/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { JOB_REPORT_REASON } from '@/lib/jobs';

export function ReportJob({ jobId }: { jobId: string }) {
  const [state, action] = useActionState(reportJob, undefined);
  return (
    <details className="card p-4">
      <summary className="cursor-pointer font-semibold text-stone-700">Denunciar esta vaga</summary>
      {state?.ok ? <p role="status" className="mt-3 rounded-xl bg-green-50 p-3 text-green-900">{state.message}</p> : (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="job_id" value={jobId} />
          {state?.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
          <fieldset>
            <legend className="label">Motivo</legend>
            {Object.entries(JOB_REPORT_REASON).map(([k, l]) => (
              <label key={k} className="flex min-h-10 items-center gap-2"><input type="radio" name="reason" value={k} className="h-5 w-5" /> {l}</label>
            ))}
            {state?.errors?.reason && <p className="field-error">{state.errors.reason}</p>}
          </fieldset>
          <div>
            <label htmlFor="details" className="label">Detalhes <span className="font-normal text-stone-500">(opcional)</span></label>
            <textarea id="details" name="details" className="input" rows={3} maxLength={1000} />
            {state?.errors?.details && <p className="field-error">{state.errors.details}</p>}
          </div>
          <SubmitButton className="btn-danger">Enviar denúncia</SubmitButton>
        </form>
      )}
    </details>
  );
}

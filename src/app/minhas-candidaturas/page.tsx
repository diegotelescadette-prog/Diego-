import Link from 'next/link';
import type { Metadata } from 'next';
import { withdrawApplication } from '@/app/vagas/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, JOB_STATUS_LABEL, jobState, postedAgo, type ApplicationStatus } from '@/lib/jobs';

export const metadata: Metadata = { title: 'Minhas candidaturas' };
export const dynamic = 'force-dynamic';

export default async function MinhasCandidaturas({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = (await getUser())!;
  const supabase = await createClient();
  const { data: apps } = await supabase.from('job_applications')
    .select('id, status, status_at, created_at, resume_filename, job_id, jobs(id, title, company_name, status, expires_at)')
    .eq('applicant_id', user.id).order('created_at', { ascending: false });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold">Minhas candidaturas</h1>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{msg}</p>}
      {(apps ?? []).length === 0 ? (
        <div className="card p-6 text-center">
          <p>Você ainda não se candidatou a nenhuma vaga.</p>
          <Link href="/vagas" className="btn-primary mt-3">Ver vagas abertas</Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {(apps ?? []).map((a) => {
            const job = a.jobs as unknown as { id: string; title: string; company_name: string; status: string; expires_at: string } | null;
            const st = job ? jobState(job) : 'encerrada';
            return (
              <li key={a.id} className="card p-4" data-testid="minha-candidatura">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {job && st === 'aberta' ? <Link className="text-lg font-bold underline" href={`/vagas/${job.id}`}>{job.title}</Link>
                      : <p className="text-lg font-bold">{job?.title ?? 'Vaga'}</p>}
                    <p className="text-stone-700">{job?.company_name}{st !== 'aberta' && ` · ${JOB_STATUS_LABEL[st]}`}</p>
                    <p className="text-sm text-stone-600">Enviada {postedAgo(a.created_at)} · {a.resume_filename}</p>
                  </div>
                  <span className="tag bg-brand-50 text-brand-800">{APPLICATION_STATUS_LABEL[a.status as ApplicationStatus]}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a className="btn-ghost" href={`/api/vagas/curriculo/${a.id}`}>Baixar o currículo enviado</a>
                  <form action={withdrawApplication}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="btn-ghost text-red-800" pendingText="Retirando…">Retirar candidatura e apagar currículo</SubmitButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

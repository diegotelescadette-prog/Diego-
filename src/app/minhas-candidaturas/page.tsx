import Link from 'next/link';
import type { Metadata } from 'next';
import { withdrawApplication } from '@/app/vagas/actions';
import { cancelInterview, respondInterview } from '@/app/vagas/entrevista-actions';
import { SubmitButton } from '@/components/SubmitButton';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, applicationStep, JOB_STATUS_LABEL, jobState, postedAgo, type ApplicationStatus } from '@/lib/jobs';
import { interviewWhen, type InterviewView } from '@/lib/interviews';

export const metadata: Metadata = { title: 'Minhas candidaturas' };
export const dynamic = 'force-dynamic';

function Steps({ status }: { status: ApplicationStatus }) {
  const at = applicationStep(status);
  const last = status === 'aprovada' ? 'Aprovado' : status === 'nao_selecionada' ? 'Não selecionado' : 'Resultado';
  const labels = ['Enviado', 'Visualizado', 'Entrevista marcada', last];
  return (
    <ol className="mt-3 grid grid-cols-4 gap-1 text-center text-xs font-semibold" aria-label="Andamento da candidatura" data-testid="app-steps">
      {labels.map((l, i) => (
        <li key={l} aria-current={i === at ? 'step' : undefined} className="space-y-1">
          <span className={`block h-1.5 rounded-full ${i <= at ? (i === 3 && status === 'nao_selecionada' ? 'bg-stone-400' : 'bg-hoje-500') : 'bg-stone-200'}`} />
          <span className={i <= at ? 'text-stone-900' : 'text-stone-500'}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function MinhasCandidaturas({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: apps }, { data: ints }] = await Promise.all([
    supabase.from('job_applications')
      .select('id, status, status_at, created_at, resume_filename, resume_path, job_id, jobs(id, title, company_name, status, expires_at)')
      .eq('applicant_id', user.id).order('created_at', { ascending: false }),
    supabase.from('interviews').select('*').eq('candidate_id', user.id).in('status', ['proposta', 'confirmada']).order('starts_at'),
  ]);
  const interviewOf = (appId: string) => ((ints ?? []) as InterviewView[]).find((i) => i.application_id === appId);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl text-stone-900">Minhas candidaturas</h1>
      {msg && <p role="status" className="rounded-xl bg-sage p-3 text-stone-900" data-testid="cand-msg">{msg}</p>}
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
            const iv = interviewOf(a.id);
            return (
              <li key={a.id} className="card p-4" data-testid="minha-candidatura">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {job && st === 'aberta' ? <Link className="serif text-lg text-stone-900 underline-offset-2 hover:underline" href={`/vagas/${job.id}`}>{job.title}</Link>
                      : <p className="serif text-lg">{job?.title ?? 'Vaga'}</p>}
                    <p className="text-stone-700">{job?.company_name}{st !== 'aberta' && ` · ${JOB_STATUS_LABEL[st]}`}</p>
                    <p className="text-sm text-stone-600">Enviada {postedAgo(a.created_at)} · {a.resume_path ? a.resume_filename : 'currículo do app'}</p>
                  </div>
                  <span className="soft-tag mod-trabalho" data-testid="app-status">{APPLICATION_STATUS_LABEL[a.status as ApplicationStatus]}</span>
                </div>
                <Steps status={a.status as ApplicationStatus} />
                {iv && (
                  <div className="mt-3 rounded-2xl bg-sky p-3 text-stone-900" data-testid="interview">
                    <p className="font-bold">Entrevista {iv.status === 'confirmada' ? 'confirmada' : 'proposta'}: {interviewWhen(iv.starts_at)}</p>
                    <p className="text-sm">{iv.mode === 'presencial' ? `Presencial em ${iv.place}` : 'Por chamada de vídeo'}{iv.note ? ` · ${iv.note}` : ''}</p>
                    {iv.mode === 'video' && iv.status === 'confirmada' && iv.video_url && <a href={iv.video_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline">Abrir link da chamada</a>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {iv.status === 'proposta' && (
                        <>
                          <form action={respondInterview}><input type="hidden" name="id" value={iv.id} /><input type="hidden" name="accept" value="1" /><SubmitButton className="btn-primary min-h-11 px-4">Confirmar</SubmitButton></form>
                          <form action={respondInterview}><input type="hidden" name="id" value={iv.id} /><input type="hidden" name="accept" value="0" /><SubmitButton className="btn-outline min-h-11 px-4">Não posso</SubmitButton></form>
                        </>
                      )}
                      {iv.status === 'confirmada' && (
                        <form action={cancelInterview}><input type="hidden" name="id" value={iv.id} /><input type="hidden" name="back" value="/minhas-candidaturas" /><SubmitButton className="btn-ghost min-h-11 px-3 text-sm">Cancelar entrevista</SubmitButton></form>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.resume_path && <a className="btn-ghost" href={`/api/vagas/curriculo/${a.id}`}>Baixar o currículo enviado</a>}
                  <form action={withdrawApplication}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="btn-ghost text-red-800" pendingText="Retirando…">Retirar candidatura</SubmitButton>
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

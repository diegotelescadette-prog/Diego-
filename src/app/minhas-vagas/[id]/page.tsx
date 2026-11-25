import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { z } from 'zod';
import { manageJob, setApplicationStatus } from '@/app/vagas/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, JOB_STATUS_LABEL, jobState, postedAgo, type ApplicationStatus } from '@/lib/jobs';
import { formatPhone } from '@/lib/validation';
import { waLink } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Candidatos da vaga' };
export const dynamic = 'force-dynamic';

const APP_STYLE: Record<string, string> = {
  recebida: 'bg-amber-100 text-amber-900', vista: 'bg-brand-50 text-brand-800', em_contato: 'bg-green-100 text-green-900', nao_selecionada: 'bg-stone-200 text-stone-800',
};

export default async function CandidatosDaVaga({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const [{ id }, { msg }] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = (await getUser())!;
  const supabase = await createClient();
  const { data: job } = await supabase.from('jobs').select('id, title, company_name, status, expires_at, created_at, removed_note')
    .eq('id', id).eq('poster_id', user.id).maybeSingle();
  if (!job) notFound();
  const { data: apps } = await supabase.from('job_applications')
    .select('id, full_name, email, phone, message, resume_filename, resume_size, status, created_at').eq('job_id', id).order('created_at', { ascending: false });
  const st = jobState(job);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/minhas-vagas" className="text-sm text-brand-700 underline">← Vagas que publiquei</Link>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{msg}</p>}
      <section className="card p-5">
        <p className="text-sm font-semibold text-stone-600">{JOB_STATUS_LABEL[st]}{st === 'aberta' && ` · no ar até ${new Date(job.expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Campo_Grande' })}`}</p>
        <h1 className="text-2xl font-extrabold">{job.title}</h1>
        <p className="text-stone-700">{job.company_name} · publicada {postedAgo(job.created_at)}</p>
        {st === 'removida' && <p className="mt-2 rounded-xl bg-red-50 p-3 text-red-900">Removida pela moderação{job.removed_note ? `: ${job.removed_note}` : '.'}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {st === 'aberta' && <Link className="btn-outline" href={`/vagas/${job.id}`}>Ver anúncio</Link>}
          {st !== 'removida' && <Link className="btn-outline" href={`/vagas/${job.id}/editar`}>Editar</Link>}
          {st === 'aberta' && (
            <form action={manageJob}><input type="hidden" name="id" value={job.id} />
              <SubmitButton name="op" value="encerrar" className="btn-outline">Encerrar vaga</SubmitButton></form>
          )}
          {(st === 'encerrada' || st === 'vencida') && (
            <form action={manageJob}><input type="hidden" name="id" value={job.id} />
              <SubmitButton name="op" value="reabrir" className="btn-primary">Reabrir por 30 dias</SubmitButton></form>
          )}
        </div>
      </section>

      <section aria-labelledby="cand-titulo" className="space-y-3">
        <h2 id="cand-titulo" className="text-xl font-bold">Candidatos ({apps?.length ?? 0})</h2>
        <p className="text-sm text-stone-600">Use os currículos só para esta seleção. Eles são apagados automaticamente 90 dias depois que a vaga encerra, ou antes, se o candidato desistir ou se você excluir a vaga.</p>
        {(apps ?? []).length === 0 && <p className="card p-4">Ninguém se candidatou ainda.</p>}
        {(apps ?? []).map((a) => (
          <article key={a.id} id={`c-${a.id}`} className="card p-4" data-testid="candidato">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold">{a.full_name}</h3>
                <p className="text-sm text-stone-600">Candidatou-se {postedAgo(a.created_at)}</p>
              </div>
              <span className={`tag ${APP_STYLE[a.status]}`}>{APPLICATION_STATUS_LABEL[a.status as ApplicationStatus]}</span>
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <a className="underline" href={`mailto:${a.email}`}>{a.email}</a>
              {a.phone && <a className="underline" href={waLink(a.phone, `Olá, ${a.full_name.split(' ')[0]}! Recebemos sua candidatura para a vaga de ${job.title}.`)} target="_blank" rel="noopener noreferrer">WhatsApp {formatPhone(a.phone)}</a>}
            </p>
            {a.message && <p className="mt-2 whitespace-pre-line rounded-xl bg-stone-50 p-3 text-stone-800">{a.message}</p>}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <a className="btn-primary" href={`/api/vagas/curriculo/${a.id}`} data-testid="baixar-curriculo">Baixar currículo (PDF, {Math.max(1, Math.round(a.resume_size / 1024))} KB)</a>
              <form action={setApplicationStatus} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={a.id} /><input type="hidden" name="job_id" value={job.id} />
                <div>
                  <label className="label" htmlFor={`st-${a.id}`}>Situação</label>
                  <select id={`st-${a.id}`} name="status" className="input" defaultValue={a.status}>
                    {Object.entries(APPLICATION_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <SubmitButton className="btn-outline">Atualizar</SubmitButton>
              </form>
            </div>
          </article>
        ))}
      </section>

      <details className="card p-4">
        <summary className="cursor-pointer font-semibold text-red-800">Excluir vaga</summary>
        <form action={manageJob} className="mt-3 space-y-2">
          <input type="hidden" name="id" value={job.id} />
          <p>A vaga, as candidaturas e todos os currículos recebidos serão apagados. Não dá para desfazer.</p>
          <label className="label" htmlFor="confirm">Digite EXCLUIR para confirmar</label>
          <input id="confirm" name="confirm" className="input" autoComplete="off" />
          <SubmitButton name="op" value="excluir" className="btn-danger">Excluir vaga e currículos</SubmitButton>
        </form>
      </details>
    </div>
  );
}

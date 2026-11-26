import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { z } from 'zod';
import { ApplyForm } from '@/components/jobs/ApplyForm';
import { ApplyResumeForm } from '@/components/jobs/ApplyResumeForm';
import { VerifiedBadge } from '@/components/jobs/JobCard';
import { Glyph } from '@/components/CategoryIcon';
import { ReportJob } from '@/components/jobs/ReportJob';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, AREA_LABEL, EMPLOYMENT_LABEL, JOB_STATUS_LABEL, jobState, postedAgo, salaryLabel, WORK_MODE_LABEL, type ApplicationStatus, type EmploymentType, type JobArea, type WorkMode } from '@/lib/jobs';
import { formatPhone } from '@/lib/validation';
import { placeOf } from '@/lib/jobs-data';

export const dynamic = 'force-dynamic';

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('jobs')
    .select('id, poster_id, title, company_name, description, requirements, employment_type, work_mode, salary_text, salary_min, salary_max, schedule_text, area, held, poster_verified, openings, status, expires_at, created_at, neighborhoods(name), cities(name, uf)')
    .eq('id', id).maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const job = await load((await params).id);
  return { title: job ? `${job.title} · ${job.company_name}` : 'Vaga' };
}

export default async function Vaga({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job, user] = await Promise.all([load(id), getUser()]);
  if (!job) notFound();
  const state = jobState(job);
  const isPoster = user?.id === job.poster_id;
  const supabase = await createClient();
  let applied: { id: string; status: ApplicationStatus; created_at: string } | null = null;
  let defaults = { full_name: '', email: user?.email ?? '', phone: '' };
  if (user && !isPoster) {
    const { data: mine } = await supabase.from('job_applications').select('id, status, created_at, job_id, full_name, email, phone')
      .eq('applicant_id', user.id).order('created_at', { ascending: false }).limit(50);
    const here = (mine ?? []).find((a) => a.job_id === job.id);
    if (here) applied = { id: here.id, status: here.status as ApplicationStatus, created_at: here.created_at };
    const last = mine?.[0];
    if (last) defaults = { full_name: last.full_name, email: last.email, phone: last.phone ? formatPhone(last.phone) : '' };
  }
  const { data: resume } = user && !isPoster
    ? await supabase.from('resumes').select('headline, phone').eq('user_id', user.id).maybeSingle()
    : { data: null };
  const verified = !!job.poster_verified;
  const salary = salaryLabel(job);
  const canApply = !!user && !isPoster && !applied && state === 'aberta';
  const SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5';

  return (
    <div className="mx-auto grid max-w-5xl gap-6 pb-20 lg:grid-cols-[1fr_380px] lg:pb-0">
      <article className="space-y-4">
        <Link href="/vagas" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">← Todas as vagas</Link>
        <header className="card p-5">
          {state !== 'aberta' && <p className="soft-tag mb-2 bg-stone-100 text-stone-800">{JOB_STATUS_LABEL[state]}</p>}
          {isPoster && job.held && <p className="soft-tag mod-servicos mb-2" data-testid="job-held-tag">Aguardando a conferência dos seus dados</p>}
          <h1 className="text-3xl leading-tight text-stone-900">{job.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-lg text-stone-700">{job.company_name}{verified && <VerifiedBadge label="Empresa verificada" />}</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Resumo da vaga" data-testid="job-chips">
            {salary && <li className="soft-tag bg-surface text-stone-900 ring-1 ring-line">{salary}</li>}
            <li className="soft-tag mod-servicos">{EMPLOYMENT_LABEL[job.employment_type as EmploymentType]}</li>
            {job.schedule_text && <li className="soft-tag mod-encontros">{job.schedule_text}</li>}
            <li className="soft-tag mod-eventos">{WORK_MODE_LABEL[job.work_mode as WorkMode]}</li>
            {job.area && <li className="soft-tag mod-trabalho">{AREA_LABEL[job.area as JobArea]}</li>}
            {job.openings > 1 && <li className="soft-tag bg-stone-100 text-stone-800">{job.openings} vagas</li>}
          </ul>
          {job.salary_text && salary !== job.salary_text && <p className="mt-2 text-sm text-stone-700">{job.salary_text}</p>}
          <p className="mt-3 text-sm text-stone-600">{placeOf(job)} · publicada {postedAgo(job.created_at)}
            {state === 'aberta' && <> · recebe currículos até {new Date(job.expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Campo_Grande' })}</>}</p>
        </header>
        <section className="safety" aria-labelledby="seguro-t" data-testid="job-safety">
          <h2 id="seguro-t" className="flex items-center gap-2 text-lg"><span className="text-oliva-600"><Glyph d={SHIELD} size={20} /></span>Por que é seguro se candidatar</h2>
          <ul className="mt-2 space-y-1.5 text-[15px]">
            <li>{verified ? 'CNPJ (ou CPF) e endereço de quem contrata conferidos pela nossa equipe.' : 'Esta vaga foi publicada antes da verificação. Confira os dados com atenção.'}</li>
            <li>Nunca pedimos dinheiro para contratar. Ninguém pode cobrar taxa, curso ou exame de você.</li>
            <li>Seu telefone só aparece se você aceitar mostrar.</li>
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="text-xl">Sobre a vaga</h2>
          <p className="mt-2 whitespace-pre-line text-stone-800">{job.description}</p>
          {job.requirements && (<>
            <h2 className="mt-5 text-xl">Requisitos</h2>
            <p className="mt-2 whitespace-pre-line text-stone-800">{job.requirements}</p>
          </>)}
        </section>
        {user && !isPoster && state === 'aberta' && <ReportJob jobId={job.id} />}
      </article>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start" aria-labelledby="candidatar-titulo" id="candidatar">
        <div className="card p-5">
          <h2 id="candidatar-titulo" className="text-xl">{isPoster ? 'Sua vaga' : 'Candidatar-se'}</h2>
          {isPoster ? (
            <div className="mt-2 space-y-3">
              <p>Você publicou esta vaga. Veja quem se candidatou, compare e convide para entrevista.</p>
              <Link href={`/minhas-vagas/${job.id}`} className="btn-primary">Ver candidatos</Link>
            </div>
          ) : applied ? (
            <div className="mt-2 space-y-2" data-testid="ja-candidatou">
              <p>Você se candidatou {postedAgo(applied.created_at)}.</p>
              <p>Situação: <strong>{APPLICATION_STATUS_LABEL[applied.status]}</strong></p>
              <Link href="/minhas-candidaturas" className="btn-outline">Minhas candidaturas</Link>
            </div>
          ) : state !== 'aberta' ? (
            <p className="mt-2">Esta vaga não está mais recebendo currículos.</p>
          ) : !user ? (
            <div className="mt-2 space-y-3">
              <p>Entre na sua conta para enviar seu currículo. Leva menos de um minuto.</p>
              <Link href={`/entrar?next=${encodeURIComponent(`/vagas/${job.id}`)}`} className="btn-primary">Entrar para se candidatar</Link>
              <p className="text-sm">Não tem conta? <Link className="underline" href={`/cadastrar?next=${encodeURIComponent(`/vagas/${job.id}`)}`}>Crie grátis</Link></p>
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              {resume?.headline ? (
                <ApplyResumeForm jobId={job.id} posterLabel={job.company_name} headline={resume.headline} hasPhone={!!resume.phone} />
              ) : (
                <div className="space-y-2" data-testid="no-resume">
                  <p>Monte seu currículo no app uma vez e candidate-se com um toque.</p>
                  <Link href="/curriculo" className="btn-hoje w-full">Montar meu currículo</Link>
                </div>
              )}
              <details className="rounded-2xl border border-line p-3">
                <summary className="cursor-pointer font-semibold text-stone-700">Prefiro enviar um PDF</summary>
                <div className="mt-3"><ApplyForm jobId={job.id} defaults={defaults} posterLabel={job.company_name} /></div>
              </details>
            </div>
          )}
        </div>
      </aside>
      {canApply && (
        <div className="fixed inset-x-0 bottom-[68px] z-20 border-t border-line bg-paper/95 p-3 md:hidden" data-testid="apply-sticky">
          <a href="#candidatar" className="btn-hoje w-full">Enviar meu currículo</a>
        </div>
      )}
    </div>
  );
}

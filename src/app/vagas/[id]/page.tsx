import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { z } from 'zod';
import { ApplyForm } from '@/components/jobs/ApplyForm';
import { ReportJob } from '@/components/jobs/ReportJob';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, EMPLOYMENT_LABEL, JOB_STATUS_LABEL, jobState, postedAgo, WORK_MODE_LABEL, type ApplicationStatus, type EmploymentType, type WorkMode } from '@/lib/jobs';
import { formatPhone } from '@/lib/validation';
import { placeOf } from '@/lib/jobs-data';

export const dynamic = 'force-dynamic';

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('jobs')
    .select('id, poster_id, title, company_name, description, requirements, employment_type, work_mode, salary_text, openings, status, expires_at, created_at, neighborhoods(name), cities(name, uf)')
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

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_380px]">
      <article className="space-y-4">
        <Link href="/vagas" className="text-sm text-brand-700 underline">← Todas as vagas</Link>
        <header className="card p-5">
          {state !== 'aberta' && <p className="tag mb-2 bg-stone-200 text-stone-800">{JOB_STATUS_LABEL[state]}</p>}
          <h1 className="text-2xl font-extrabold">{job.title}</h1>
          <p className="text-lg text-stone-700">{job.company_name}</p>
          <p className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="tag bg-brand-50 text-brand-800">{EMPLOYMENT_LABEL[job.employment_type as EmploymentType]}</span>
            <span className="tag bg-stone-100 text-stone-800">{WORK_MODE_LABEL[job.work_mode as WorkMode]}</span>
            {job.salary_text && <span className="tag bg-green-50 text-green-900">{job.salary_text}</span>}
            {job.openings > 1 && <span className="tag bg-stone-100 text-stone-800">{job.openings} vagas</span>}
          </p>
          <p className="mt-3 text-sm text-stone-600">{placeOf(job)} · publicada {postedAgo(job.created_at)}
            {state === 'aberta' && <> · recebe currículos até {new Date(job.expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Campo_Grande' })}</>}</p>
        </header>
        <section className="card p-5">
          <h2 className="text-lg font-bold">Sobre a vaga</h2>
          <p className="mt-2 whitespace-pre-line text-stone-800">{job.description}</p>
          {job.requirements && (<>
            <h2 className="mt-5 text-lg font-bold">Requisitos</h2>
            <p className="mt-2 whitespace-pre-line text-stone-800">{job.requirements}</p>
          </>)}
        </section>
        {user && !isPoster && state === 'aberta' && <ReportJob jobId={job.id} />}
      </article>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start" aria-labelledby="candidatar-titulo">
        <div className="card p-5">
          <h2 id="candidatar-titulo" className="text-xl font-bold">{isPoster ? 'Sua vaga' : 'Candidatar-se'}</h2>
          {isPoster ? (
            <div className="mt-2 space-y-3">
              <p>Você publicou esta vaga. Veja quem se candidatou e baixe os currículos no seu painel.</p>
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
            <div className="mt-3"><ApplyForm jobId={job.id} defaults={defaults} posterLabel={job.company_name} /></div>
          )}
        </div>
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Nunca pague para participar de uma seleção. Seu currículo só é visto por quem publicou a vaga.</p>
      </aside>
    </div>
  );
}

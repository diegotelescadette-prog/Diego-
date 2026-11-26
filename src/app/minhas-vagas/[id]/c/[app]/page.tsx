import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { cancelInterview, inviteInterview } from '@/app/vagas/entrevista-actions';
import { setApplicationStatus } from '@/app/vagas/actions';
import { ResumeView } from '@/components/jobs/ResumeView';
import { SubmitButton } from '@/components/SubmitButton';
import { getUser } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, type ApplicationStatus } from '@/lib/jobs';
import { INTERVIEW_STATUS_LABEL, interviewWhen, localDate, type InterviewView } from '@/lib/interviews';
import type { ResumeSnapshot } from '@/lib/resume';
import { signedPhoto } from '@/lib/resume-data';
import { createClient } from '@/lib/supabase/server';
import { formatPhone } from '@/lib/validation';
import { waLink } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Currículo do candidato' };
export const dynamic = 'force-dynamic';

/** Currículo de um candidato para quem publicou a vaga: abrir marca como "Visualizado"; daqui convida para entrevista. */
export default async function Candidato({ params, searchParams }: { params: Promise<{ id: string; app: string }>; searchParams: Promise<{ msg?: string }> }) {
  const [{ id, app }, { msg }] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(app).success) notFound();
  const user = await getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/minhas-vagas/${id}/c/${app}`)}`);
  const supabase = await createClient();
  const { data: job } = await supabase.from('jobs').select('id, title, company_name, poster_id').eq('id', id).eq('poster_id', user.id).maybeSingle();
  if (!job) notFound();
  await supabase.rpc('mark_application_seen', { p_application: app });
  const [{ data: a }, { data: ints }, { data: ver }] = await Promise.all([
    supabase.from('job_applications').select('id, full_name, email, phone, message, resume_path, resume_snapshot, status, created_at').eq('id', app).eq('job_id', id).maybeSingle(),
    supabase.from('interviews').select('*').eq('application_id', app).order('created_at', { ascending: false }).limit(1),
    supabase.from('employer_verifications').select('address_line, status').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!a) notFound();
  const snap = a.resume_snapshot as ResumeSnapshot | null;
  const photo = await signedPhoto(snap?.photo_path);
  const iv = ((ints ?? []) as InterviewView[])[0];
  const active = iv && ['proposta', 'confirmada'].includes(iv.status) ? iv : null;
  const here = `/minhas-vagas/${id}/c/${app}`;
  const tomorrow = localDate(new Date(Date.now() + 86_400_000).toISOString());
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/minhas-vagas/${id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">← Candidatos de {job.title}</Link>
      {msg && <p role="status" className="rounded-xl bg-sage p-3 text-stone-900" data-testid="cand-detail-msg">{msg}</p>}
      <section className="card p-5">
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm"><span className="soft-tag mod-trabalho" data-testid="cand-status">{APPLICATION_STATUS_LABEL[a.status as ApplicationStatus]}</span></p>
        {snap ? <ResumeView r={snap} photo={photo} /> : <p>Este candidato enviou um currículo em PDF. <a className="font-semibold underline" href={`/api/vagas/curriculo/${a.id}`}>Baixar o PDF</a></p>}
        {snap && <a className="btn-outline mt-4" href={`${here}/pdf`}>Baixar em PDF</a>}
      </section>
      <section className="card space-y-2 p-5" aria-labelledby="contato-t">
        <h2 id="contato-t" className="text-xl">Contato</h2>
        <p><a className="underline" href={`mailto:${a.email}`}>{a.email}</a></p>
        {a.phone
          ? <a className="btn-zap" href={waLink(a.phone, `Olá, ${a.full_name.split(' ')[0]}! Recebemos sua candidatura para a vaga de ${job.title}.`)} target="_blank" rel="noopener noreferrer">WhatsApp {formatPhone(a.phone)}</a>
          : <p className="text-sm text-stone-600" data-testid="phone-hidden">O candidato preferiu não mostrar o telefone. Fale pelo e-mail ou convide para entrevista por aqui.</p>}
        {a.message && <p className="whitespace-pre-line rounded-xl bg-paper p-3 text-stone-800">{a.message}</p>}
      </section>

      <section className="card space-y-3 p-5" aria-labelledby="ent-t">
        <h2 id="ent-t" className="text-xl">Entrevista</h2>
        {active ? (
          <div className="rounded-2xl bg-sky p-3" data-testid="interview-employer">
            <p className="font-bold">{interviewWhen(active.starts_at)} · {INTERVIEW_STATUS_LABEL[active.status].replace('sua resposta', 'a resposta do candidato')}</p>
            <p className="text-sm">{active.mode === 'presencial' ? `Presencial em ${active.place}` : `Vídeo: ${active.video_url}`}</p>
            <form action={cancelInterview} className="mt-2"><input type="hidden" name="id" value={active.id} /><input type="hidden" name="back" value={here} /><SubmitButton className="btn-ghost min-h-11 px-3 text-sm">Cancelar entrevista</SubmitButton></form>
          </div>
        ) : iv?.status === 'recusada' ? <p className="text-stone-700">O candidato não pôde no horário proposto. Proponha outro abaixo.</p> : null}
        {a.status !== 'nao_selecionada' && (
          <details open={!active} className="rounded-2xl border border-line p-3">
            <summary className="cursor-pointer font-semibold text-stone-800">{active ? 'Remarcar' : 'Convidar para entrevista'}</summary>
            <form action={inviteInterview} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="invite-form">
              <input type="hidden" name="application" value={a.id} /><input type="hidden" name="job" value={id} />
              <div><label className="label" htmlFor="date">Dia</label><input id="date" name="date" type="date" className="input" min={localDate(new Date().toISOString())} defaultValue={tomorrow} required /></div>
              <div><label className="label" htmlFor="time">Horário</label><input id="time" name="time" type="time" className="input" defaultValue="09:00" required /></div>
              <fieldset className="sm:col-span-2"><legend className="label">Como vai ser</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="choice"><input type="radio" name="mode" value="presencial" defaultChecked /> Presencial</label>
                  <label className="choice"><input type="radio" name="mode" value="video" /> Chamada de vídeo</label>
                </div>
              </fieldset>
              <div className="sm:col-span-2"><label className="label" htmlFor="place">Endereço (presencial)</label>
                <input id="place" name="place" className="input" maxLength={200} defaultValue={ver?.status === 'verificado' ? ver.address_line : ''} />
                <p className="hint">{ver?.status === 'verificado' ? 'Endereço conferido pela equipe.' : 'Prefira um endereço comercial ou um lugar público e movimentado.'}</p></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="video_url">Link da chamada (vídeo)</label><input id="video_url" name="video_url" type="url" className="input" placeholder="https://meet…" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="note">Recado (opcional)</label><input id="note" name="note" className="input" maxLength={300} placeholder="Ex.: Traga um documento com foto" /></div>
              <div className="sm:col-span-2"><SubmitButton pendingText="Enviando…">Enviar convite</SubmitButton></div>
            </form>
          </details>
        )}
      </section>

      <section className="card flex flex-wrap gap-2 p-5" aria-label="Resultado">
        {(['aprovada', 'nao_selecionada'] as const).map((s) => (
          <form key={s} action={setApplicationStatus}>
            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="job_id" value={id} /><input type="hidden" name="status" value={s} />
            <SubmitButton className={s === 'aprovada' ? 'btn-primary' : 'btn-outline'}>{s === 'aprovada' ? 'Aprovar' : 'Não selecionar'}</SubmitButton>
          </form>
        ))}
      </section>
    </div>
  );
}

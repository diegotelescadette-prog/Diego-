'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPilotCity } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, JOB_REPORT_REASON, parseJob } from '@/lib/jobs';

export type JobFormState = { errors?: Record<string, string>; message?: string; values?: Record<string, string> } | undefined;
export type SimpleState = { ok?: boolean; message?: string; errors?: Record<string, string> } | undefined;

const FIELDS = ['title', 'company_name', 'description', 'requirements', 'employment_type', 'work_mode', 'neighborhood_id', 'salary_text', 'openings', 'area', 'salary_min', 'salary_max', 'schedule_text'];
const keep = (form: FormData) => Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) ?? '')]));
const uuid = z.string().uuid();

async function requireUser(next: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  return { supabase, user };
}

function dbMessage(code: string | undefined, fallback: string, message?: string) {
  if (code === '54000' || code === '23514') return message ?? fallback;
  return fallback;
}

export async function createJob(_: JobFormState, form: FormData): Promise<JobFormState> {
  const { supabase, user } = await requireUser('/vagas/nova');
  const { data, errors } = parseJob(Object.fromEntries(form));
  if (!data) return { errors, values: keep(form) };
  if (form.get('aceite') !== 'on') return { errors: { aceite: 'Confirme as regras para publicar' }, values: keep(form) };
  const city = await getPilotCity();
  const { data: row, error } = await supabase.from('jobs').insert({ ...data, poster_id: user.id, city_id: city.id }).select('id, held').single();
  if (error || !row) return { message: dbMessage(error?.code, 'Não foi possível publicar a vaga. Tente de novo.', error?.message), values: keep(form) };
  revalidatePath('/vagas');
  if (row.held) redirect(`/vagas/verificacao?vaga=${row.id}`);
  redirect(`/minhas-vagas/${row.id}?msg=${encodeURIComponent('Vaga publicada. Ela fica no ar por 30 dias.')}`);
}

export async function updateJob(_: JobFormState, form: FormData): Promise<JobFormState> {
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) return { message: 'Vaga inválida.' };
  const { supabase } = await requireUser(`/vagas/${id.data}/editar`);
  const { data, errors } = parseJob(Object.fromEntries(form));
  if (!data) return { errors, values: keep(form) };
  const { data: rows, error } = await supabase.from('jobs').update(data).eq('id', id.data).select('id');
  if (error || !rows?.length) return { message: dbMessage(error?.code, 'Não foi possível salvar. A vaga pode ter sido removida.', error?.message), values: keep(form) };
  revalidatePath('/vagas');
  redirect(`/minhas-vagas/${id.data}?msg=${encodeURIComponent('Alterações salvas.')}`);
}

/** Encerrar, reabrir (renova 30 dias) ou excluir (apaga candidaturas e currículos). */
export async function manageJob(form: FormData) {
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) redirect('/minhas-vagas');
  const { supabase, user } = await requireUser('/minhas-vagas');
  const op = String(form.get('op'));
  let msg = '';
  if (op === 'encerrar' || op === 'reabrir') {
    const { error } = await supabase.rpc('set_my_job_status', { p_job: id.data, p_status: op === 'encerrar' ? 'encerrada' : 'aberta' });
    msg = error ? (error.code === '54000' ? error.message : 'Não foi possível alterar a vaga.') : op === 'encerrar' ? 'Vaga encerrada. Ela saiu da lista pública.' : 'Vaga reaberta por mais 30 dias.';
  } else if (op === 'excluir') {
    if (String(form.get('confirm') ?? '').trim().toUpperCase() !== 'EXCLUIR') {
      redirect(`/minhas-vagas/${id.data}?msg=${encodeURIComponent('Digite EXCLUIR para confirmar.')}`);
    }
    const { data: job } = await supabase.from('jobs').select('id').eq('id', id.data).eq('poster_id', user.id).maybeSingle();
    if (!job) redirect('/minhas-vagas');
    const admin = createAdminClient();
    const { data: apps } = await admin.from('job_applications').select('resume_path').eq('job_id', id.data);
    const paths = (apps ?? []).map((a) => a.resume_path).filter((p): p is string => !!p);
    if (paths.length) await admin.storage.from('curriculos').remove(paths);
    await supabase.from('jobs').delete().eq('id', id.data);
    revalidatePath('/vagas');
    redirect(`/minhas-vagas?msg=${encodeURIComponent('Vaga excluída, com as candidaturas e os currículos recebidos.')}`);
  }
  revalidatePath('/vagas');
  revalidatePath(`/minhas-vagas/${id.data}`);
  redirect(`/minhas-vagas/${id.data}?msg=${encodeURIComponent(msg)}`);
}

export async function setApplicationStatus(form: FormData) {
  const id = uuid.safeParse(form.get('id'));
  const job = uuid.safeParse(form.get('job_id'));
  const status = z.enum(Object.keys(APPLICATION_STATUS_LABEL) as [string, ...string[]]).safeParse(form.get('status'));
  if (!id.success || !job.success || !status.success) redirect('/minhas-vagas');
  const { supabase } = await requireUser('/minhas-vagas');
  const { error } = await supabase.rpc('set_application_status', { p_application: id.data, p_status: status.data });
  revalidatePath(`/minhas-vagas/${job.data}`);
  redirect(`/minhas-vagas/${job.data}?msg=${encodeURIComponent(error ? 'Não foi possível atualizar.' : 'Situação atualizada.')}#c-${id.data}`);
}

/** O candidato desiste: apaga a candidatura e o arquivo do currículo. */
export async function withdrawApplication(form: FormData) {
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) redirect('/minhas-candidaturas');
  const { supabase, user } = await requireUser('/minhas-candidaturas');
  const { data: app } = await supabase.from('job_applications').select('resume_path').eq('id', id.data).eq('applicant_id', user.id).maybeSingle();
  if (app) {
    if (app.resume_path) await supabase.storage.from('curriculos').remove([app.resume_path]);
    await supabase.from('job_applications').delete().eq('id', id.data).eq('applicant_id', user.id);
  }
  revalidatePath('/minhas-candidaturas');
  redirect(`/minhas-candidaturas?msg=${encodeURIComponent('Candidatura retirada e currículo apagado.')}`);
}

export async function reportJob(_: SimpleState, form: FormData): Promise<SimpleState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { message: 'Entre para denunciar.' };
  const jobId = uuid.safeParse(form.get('job_id'));
  const reason = z.enum(Object.keys(JOB_REPORT_REASON) as [string, ...string[]]).safeParse(form.get('reason'));
  const details = String(form.get('details') ?? '').trim();
  if (!jobId.success) return { message: 'Vaga inválida.' };
  if (!reason.success) return { errors: { reason: 'Escolha o motivo' } };
  if (details.length > 1000) return { errors: { details: 'Use até 1000 caracteres' } };
  if (reason.data === 'outro' && details.length < 10) return { errors: { details: 'Descreva o problema' } };
  const { error } = await supabase.from('job_reports').insert({ reporter_id: user.id, job_id: jobId.data, reason: reason.data, details: details || null });
  if (error) {
    if (error.code === '23505') return { message: 'Você já denunciou esta vaga. A moderação vai avaliar.' };
    if (error.code === '54000') return { message: 'Você atingiu o limite diário de denúncias.' };
    return { message: 'Não foi possível enviar a denúncia.' };
  }
  return { ok: true, message: 'Denúncia enviada. A moderação vai avaliar.' };
}

/** Banco de currículos: ocultar/mostrar ou apagar (apaga também o arquivo). */
export async function manageTalent(form: FormData) {
  const { supabase, user } = await requireUser('/vagas/meu-curriculo');
  const op = String(form.get('op'));
  let msg = '';
  if (op === 'ocultar' || op === 'mostrar') {
    const { error } = await supabase.from('talent_profiles').update({ visible: op === 'mostrar' }).eq('user_id', user.id);
    msg = error ? 'Não foi possível alterar.' : op === 'mostrar' ? 'Seu currículo voltou a aparecer para quem está contratando (por mais 6 meses).' : 'Currículo oculto. Ninguém mais consegue vê-lo no banco.';
  } else if (op === 'apagar') {
    const { data: t } = await supabase.from('talent_profiles').select('resume_path').eq('user_id', user.id).maybeSingle();
    if (t) {
      await supabase.storage.from('curriculos').remove([t.resume_path]);
      await supabase.from('talent_profiles').delete().eq('user_id', user.id);
    }
    msg = 'Currículo apagado do banco.';
  }
  revalidatePath('/vagas/meu-curriculo');
  redirect(`/vagas/meu-curriculo?msg=${encodeURIComponent(msg)}`);
}

export type ApplyState = { ok?: boolean; message?: string } | undefined;
const APPLY_ERR: Record<string, string> = {
  resume_missing: 'Monte seu currículo antes de se candidatar.',
  resume_incomplete: 'Complete o currículo: conte o trabalho que você procura.',
  already_applied: 'Você já se candidatou a esta vaga.',
  invalid_message: 'A mensagem pode ter até 1.500 caracteres.',
};

/** Candidatura com o currículo do app, em um toque. O telefone só vai se a pessoa marcar. */
export async function applyWithResume(_: ApplyState, form: FormData): Promise<ApplyState> {
  const id = uuid.safeParse(form.get('job_id'));
  if (!id.success) return { message: 'Vaga inválida.' };
  const { supabase } = await requireUser(`/vagas/${id.data}`);
  const { error } = await supabase.rpc('apply_with_resume', {
    p_job: id.data, p_message: String(form.get('message') ?? ''), p_share_phone: form.get('share_phone') === 'on',
  });
  if (error) {
    const key = Object.keys(APPLY_ERR).find((k) => error.message.includes(k));
    return { message: key ? APPLY_ERR[key] : error.code === '23514' || error.code === '54000' ? error.message : 'Não foi possível enviar agora. Tente de novo.' };
  }
  revalidatePath('/minhas-candidaturas');
  return { ok: true };
}

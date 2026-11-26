'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const uuid = z.string().uuid();
const ERR: Record<string, string> = {
  invalid_time: 'Escolha uma data a partir de 1 hora daqui e até 60 dias.',
  invalid_place: 'Informe o endereço da entrevista.',
  invalid_video: 'Informe o link da chamada de vídeo (começando com https://).',
  invalid_status: 'Esta candidatura mudou. Atualize a página.',
  not_allowed: 'Você não tem acesso a esta candidatura.',
};
const errText = (m: string) => ERR[Object.keys(ERR).find((k) => m.includes(k)) ?? ''] ?? 'Não foi possível salvar. Tente de novo.';

/** Quem publicou convida para entrevista. Data e hora no horário de Campo Grande (UTC−4). */
export async function inviteInterview(form: FormData) {
  const app = uuid.safeParse(form.get('application'));
  const job = uuid.safeParse(form.get('job'));
  if (!app.success || !job.success) redirect('/minhas-vagas');
  const back = `/minhas-vagas/${job.data}/c/${app.data}`;
  const date = String(form.get('date') ?? ''), time = String(form.get('time') ?? '');
  const starts = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? `${date}T${time}:00-04:00` : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc('invite_interview', {
    p_application: app.data, p_starts_at: starts, p_mode: String(form.get('mode') ?? ''),
    p_place: String(form.get('place') ?? ''), p_video_url: String(form.get('video_url') ?? '').trim(), p_note: String(form.get('note') ?? ''),
  });
  revalidatePath(back);
  redirect(`${back}?msg=${encodeURIComponent(error ? errText(error.message) : 'Convite enviado. A entrevista aparece na agenda de vocês dois.')}`);
}

export async function respondInterview(form: FormData) {
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) redirect('/minhas-candidaturas');
  const accept = form.get('accept') === '1';
  const supabase = await createClient();
  const { error } = await supabase.rpc('respond_interview', { p_interview: id.data, p_accept: accept });
  revalidatePath('/minhas-candidaturas');
  redirect(`/minhas-candidaturas?msg=${encodeURIComponent(error ? errText(error.message) : accept ? 'Entrevista confirmada. Ela está na sua agenda.' : 'Você avisou que não pode. A empresa pode propor outro horário.')}`);
}

export async function cancelInterview(form: FormData) {
  const id = uuid.safeParse(form.get('id'));
  const back = String(form.get('back') ?? '/agenda');
  const safeBack = /^\/(minhas-candidaturas|agenda|minhas-vagas\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36})$/.test(back) ? back : '/agenda';
  if (!id.success) redirect(safeBack);
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_interview', { p_interview: id.data, p_reason: String(form.get('reason') ?? '') });
  revalidatePath(safeBack);
  redirect(`${safeBack}?msg=${encodeURIComponent(error ? errText(error.message) : 'Entrevista cancelada.')}`);
}

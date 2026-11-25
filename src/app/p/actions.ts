'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/validation';

export async function toggleFavorite(form: FormData) {
  const supabase = await createClient();
  const back = safeNext(String(form.get('back') ?? ''), '/');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?motivo=favorito&next=${encodeURIComponent(back)}`);
  const providerId = z.string().uuid().parse(form.get('provider_id'));
  if (form.get('fav') === '1') {
    await supabase.from('favorites').delete().eq('user_id', user.id).eq('provider_id', providerId);
  } else {
    await supabase.from('favorites').insert({ user_id: user.id, provider_id: providerId });
  }
  revalidatePath(back.split('?')[0]);
  revalidatePath('/favoritos');
}

export type ReportState = { ok?: boolean; message?: string; errors?: Record<string, string> } | undefined;
const REASONS = ['informacoes_falsas', 'golpe_ou_cobranca', 'comportamento_inadequado', 'conteudo_improprio', 'outro'] as const;

export async function createReport(_: ReportState, form: FormData): Promise<ReportState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { message: 'Entre para denunciar.' };
  const reason = z.enum(REASONS).safeParse(form.get('reason'));
  const details = String(form.get('details') ?? '').trim();
  const providerId = z.string().uuid().safeParse(form.get('provider_id'));
  if (!providerId.success) return { message: 'Perfil inválido.' };
  if (!reason.success) return { errors: { reason: 'Escolha o motivo' } };
  if (details.length > 1000) return { errors: { details: 'Use até 1000 caracteres' } };
  if (reason.data === 'outro' && details.length < 10) return { errors: { details: 'Descreva o problema' } };
  const { error } = await supabase.from('reports').insert({ reporter_id: user.id, provider_id: providerId.data, reason: reason.data, details: details || null });
  if (error) {
    if (error.code === '23505') return { message: 'Você já denunciou este perfil. A moderação vai avaliar.' };
    if (error.code === '54000') return { message: 'Você atingiu o limite diário de denúncias.' };
    return { message: 'Não foi possível enviar a denúncia.' };
  }
  return { ok: true, message: 'Denúncia enviada. Obrigado por ajudar a manter a comunidade segura.' };
}

'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { hitLimit } from '@/lib/rate-limit';
import { forbiddenPromise } from '@/lib/verification';
import { STORY_LIMITS } from '@/lib/stories-shared';

export type StoryResult = { ok?: boolean; message?: string; login?: boolean };

const Input = z.object({
  kind: z.enum(['foto', 'video']),
  path: z.string().max(200),
  caption: z.string().max(STORY_LIMITS.caption),
  publicName: z.string().max(60).optional(),
});

/** Publica um momento (o arquivo já foi enviado para a pasta da conta). Apaga, de passagem, os arquivos dos seus momentos vencidos. */
export async function createStory(raw: z.infer<typeof Input>): Promise<StoryResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para publicar um momento.' };
  const parsed = Input.safeParse(raw);
  if (!parsed.success || !parsed.data.path.startsWith(`${user.id}/`)) return { message: 'Confira o arquivo e tente de novo.' };
  const p = parsed.data;
  const caption = p.caption.trim();
  const promise = forbiddenPromise(caption);
  if (promise) return { message: promise };
  if (p.publicName !== undefined) {
    const n = p.publicName.trim();
    if (n.length < 2 || n.length > 60) return { message: 'Informe seu nome público (2 a 60 letras).' };
    const { error } = await supabase.from('member_names').upsert({ user_id: user.id, name: n, updated_at: new Date().toISOString() });
    if (error) return { message: error.message.includes('carinho') ? error.message : 'Não foi possível salvar seu nome.' };
  }
  if (!(await hitLimit('story', user.id, 20, 86400))) return { message: 'Muitos momentos hoje. Tente amanhã.' };

  const { error } = await supabase.from('stories').insert({ author_id: user.id, kind: p.kind, path: p.path, caption });
  if (error) {
    if (error.code === '54000') return { message: 'Limite de 15 momentos por dia.' };
    if (error.code === '23514') return { message: error.message.includes('carinho') ? error.message : 'Informe seu nome público para publicar.' };
    return { message: 'Não foi possível publicar o momento. Tente de novo.' };
  }

  // Limpeza: momentos vencidos da própria conta somem do banco e do armazenamento.
  const { data: old } = await supabase.from('stories').select('id, path').eq('author_id', user.id).lt('expires_at', new Date().toISOString());
  if (old?.length) {
    await supabase.storage.from('post-media').remove(old.map((o) => o.path));
    await supabase.from('stories').delete().in('id', old.map((o) => o.id));
  }
  revalidatePath('/comunidade');
  return { ok: true };
}

/** O autor apaga o próprio momento (e o arquivo). */
export async function deleteStory(storyId: string): Promise<StoryResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true };
  const id = z.string().uuid().safeParse(storyId);
  if (!id.success) return { message: 'Momento inválido.' };
  const { data: s } = await supabase.from('stories').select('path').eq('id', id.data).eq('author_id', user.id).maybeSingle();
  if (!s) return { message: 'Só quem publicou pode apagar.' };
  await supabase.from('stories').delete().eq('id', id.data).eq('author_id', user.id);
  await supabase.storage.from('post-media').remove([s.path]);
  revalidatePath('/comunidade');
  return { ok: true };
}

/** Marca como visto (sem login, nada é gravado). */
export async function markSeen(storyId: string): Promise<StoryResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !z.string().uuid().safeParse(storyId).success) return { ok: false };
  const { error } = await supabase.from('story_views').insert({ story_id: storyId, viewer_id: user.id });
  return { ok: !error || error.code === '23505' };
}

const REASONS = ['golpe_ou_cobranca', 'conteudo_improprio', 'ofensa_ou_assedio', 'spam', 'outro'] as const;

/** Denuncia um momento para a moderação. */
export async function reportStory(storyId: string, reason: string): Promise<StoryResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para denunciar.' };
  const id = z.string().uuid().safeParse(storyId);
  const r = z.enum(REASONS).safeParse(reason);
  if (!id.success || !r.success) return { message: 'Escolha o motivo.' };
  const { error } = await supabase.from('story_reports').insert({ reporter_id: user.id, story_id: id.data, reason: r.data });
  if (error?.code === '23505') return { ok: true, message: 'Você já denunciou este momento. A moderação vai avaliar.' };
  if (error?.code === '54000') return { message: 'Você atingiu o limite diário de denúncias.' };
  if (error) return { message: 'Não foi possível enviar a denúncia.' };
  return { ok: true, message: 'Denúncia enviada. A moderação vai avaliar.' };
}

/** Moderação: tirar o momento do ar (com motivo no histórico) ou marcar a denúncia como improcedente. */
export async function adminStoryAction(form: FormData) {
  const supabase = await createClient();
  const op = String(form.get('op') ?? '');
  const storyId = String(form.get('story_id') ?? '');
  const reportId = Number(form.get('report_id') ?? 0);
  if (op === 'remover' && z.string().uuid().safeParse(storyId).success) {
    const note = String(form.get('note') ?? '').trim() || 'Removido pela moderação';
    await supabase.rpc('admin_remove_story', { p_story: storyId, p_note: note });
  } else if (op === 'improcedente' && reportId > 0) {
    await supabase.rpc('admin_resolve_story_report', { p_report: reportId });
  }
  revalidatePath('/admin');
  revalidatePath('/comunidade');
}

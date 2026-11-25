'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hitLimit } from '@/lib/rate-limit';
import { POST_LIMITS, POST_REPORT_REASON } from '@/lib/posts-shared';

export type Result = { ok?: boolean; message?: string; id?: string; login?: boolean };

const MediaList = z.array(z.object({ kind: z.enum(['foto', 'video']), path: z.string().max(200) })).max(POST_LIMITS.photos);

function refresh(postId?: string) {
  revalidatePath('/');
  revalidatePath('/publicar');
  if (postId) revalidatePath(`/publicacoes/${postId}`);
}

/** Cria a publicação com as mídias já enviadas (fotos pela rota de upload; vídeo direto ao storage). */
export async function createPost(input: { body: string; media: { kind: 'foto' | 'video'; path: string }[] }): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para publicar.' };
  const body = String(input.body ?? '').trim();
  const media = MediaList.safeParse(input.media ?? []);
  if (!media.success) return { message: 'Use um vídeo OU até 6 fotos.' };
  if (body.length > POST_LIMITS.body) return { message: `Use até ${POST_LIMITS.body} caracteres.` };
  if (!body && media.data.length === 0) return { message: 'Escreva algo ou adicione fotos ou um vídeo.' };
  const videos = media.data.filter((m) => m.kind === 'video').length;
  if (videos > 1 || (videos === 1 && media.data.length > 1)) return { message: 'Use um vídeo OU até 6 fotos.' };
  if (media.data.some((m) => !m.path.startsWith(`${user.id}/`))) return { message: 'Arquivo inválido.' };
  if (!(await hitLimit('post', user.id, 20, 86400))) return { message: 'Muitas publicações hoje. Tente amanhã.' };

  const { data: post, error } = await supabase.from('posts').insert({ author_id: user.id, body }).select('id').single();
  if (error || !post) {
    if (error?.code === '54000') return { message: 'Limite de 10 publicações por dia.' };
    if (error?.code === '42501') return { message: 'Publique seu perfil de prestador antes de postar.' };
    return { message: 'Não foi possível publicar. Tente novamente.' };
  }
  if (media.data.length) {
    const { error: mErr } = await supabase.from('post_media').insert(media.data.map((m, i) => ({ post_id: post.id, kind: m.kind, path: m.path, sort: i })));
    if (mErr) {
      await supabase.from('posts').delete().eq('id', post.id);
      return { message: 'Não foi possível anexar as fotos ou o vídeo.' };
    }
  }
  refresh(post.id);
  return { ok: true, id: post.id };
}

/** O autor apaga a publicação e os arquivos dela. */
export async function deletePost(postId: string): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true };
  const id = z.string().uuid().safeParse(postId);
  if (!id.success) return { message: 'Publicação inválida.' };
  const { data: media } = await supabase.from('post_media').select('path, posts!inner(author_id)').eq('post_id', id.data).eq('posts.author_id', user.id);
  const { error, count } = await supabase.from('posts').delete({ count: 'exact' }).eq('id', id.data).eq('author_id', user.id);
  if (error || !count) return { message: 'Não foi possível apagar.' };
  if (media?.length) await supabase.storage.from('post-media').remove(media.map((m) => m.path));
  refresh(id.data);
  return { ok: true };
}

/** Marca ou desmarca "Útil". */
export async function toggleUseful(postId: string, on: boolean): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true };
  const id = z.string().uuid().safeParse(postId);
  if (!id.success) return { message: 'Publicação inválida.' };
  if (on) {
    const { error } = await supabase.from('post_reactions').insert({ post_id: id.data, user_id: user.id });
    if (error && error.code !== '23505') return { message: 'Não foi possível marcar.' };
  } else {
    await supabase.from('post_reactions').delete().eq('post_id', id.data).eq('user_id', user.id);
  }
  return { ok: true };
}

/** Comenta (quem não é prestador informa o nome uma vez; o e-mail nunca aparece). */
export async function addComment(_: Result | undefined, form: FormData): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para comentar.' };
  const postId = z.string().uuid().safeParse(form.get('post_id'));
  if (!postId.success) return { message: 'Publicação inválida.' };
  const body = String(form.get('body') ?? '').trim();
  if (!body) return { message: 'Escreva o comentário.' };
  if (body.length > POST_LIMITS.comment) return { message: `Use até ${POST_LIMITS.comment} caracteres.` };
  const name = form.get('name');
  if (typeof name === 'string') {
    const n = name.trim();
    if (n.length < 2 || n.length > 60) return { message: 'Informe seu nome (2 a 60 letras).' };
    const { error: nErr } = await supabase.from('member_names').upsert({ user_id: user.id, name: n, updated_at: new Date().toISOString() });
    if (nErr) return { message: 'Não foi possível salvar seu nome.' };
  }
  const { error } = await supabase.from('post_comments').insert({ post_id: postId.data, author_id: user.id, body });
  if (error) {
    if (error.code === '54000') return { message: 'Muitos comentários em pouco tempo. Aguarde um pouco.' };
    if (error.code === '23514') return { message: 'Informe seu nome para comentar.' };
    return { message: 'Não foi possível comentar.' };
  }
  refresh(postId.data);
  return { ok: true };
}

export async function deleteComment(commentId: number, postId: string): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true };
  await supabase.from('post_comments').delete().eq('id', commentId).eq('author_id', user.id);
  refresh(postId);
  return { ok: true };
}

/** O autor da publicação oculta ou mostra um comentário. */
export async function hideComment(commentId: number, postId: string, hide: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('hide_comment', { p_comment: commentId, p_hide: hide });
  if (error) return { message: 'Não foi possível alterar o comentário.' };
  refresh(postId);
  return { ok: true };
}

export async function reportPost(_: Result | undefined, form: FormData): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para denunciar.' };
  const postId = z.string().uuid().safeParse(form.get('post_id'));
  const commentRaw = form.get('comment_id');
  const commentId = commentRaw ? Number(commentRaw) : null;
  const reason = String(form.get('reason') ?? '');
  const details = String(form.get('details') ?? '').trim();
  if (!postId.success || (commentRaw && !Number.isInteger(commentId))) return { message: 'Item inválido.' };
  if (!(reason in POST_REPORT_REASON)) return { message: 'Escolha o motivo.' };
  if (details.length > 1000) return { message: 'Use até 1000 caracteres.' };
  const { error } = await supabase.from('post_reports').insert({ reporter_id: user.id, post_id: postId.data, comment_id: commentId, reason, details: details || null });
  if (error) {
    if (error.code === '23505') return { message: 'Você já denunciou isto. A moderação vai avaliar.' };
    if (error.code === '54000') return { message: 'Você atingiu o limite diário de denúncias.' };
    return { message: 'Não foi possível enviar a denúncia.' };
  }
  return { ok: true, message: 'Denúncia enviada. Obrigado por ajudar a manter a comunidade segura.' };
}

/** Moderação: remover publicação ou comentário, ou marcar a denúncia como improcedente. */
export async function adminPostAction(form: FormData) {
  const supabase = await createClient();
  const op = String(form.get('op') ?? '');
  const note = String(form.get('note') ?? '').trim() || (op === 'improcedente' ? '' : 'Removido pela moderação');
  const postId = String(form.get('post_id') ?? '');
  const commentId = form.get('comment_id') ? Number(form.get('comment_id')) : null;
  const reportId = form.get('report_id') ? Number(form.get('report_id')) : null;
  if (op === 'improcedente' && reportId) {
    await supabase.rpc('admin_resolve_post_report', { p_report: reportId, p_status: 'improcedente', p_note: note });
  } else if (op === 'remover' && commentId) {
    await supabase.rpc('admin_remove_comment', { p_comment: commentId, p_note: note });
  } else if (op === 'remover' && postId) {
    const { error } = await supabase.rpc('admin_remove_post', { p_post: postId, p_note: note });
    if (!error) {
      // Arquivos saem do ar junto (o bucket é público).
      const admin = createAdminClient();
      const { data: media } = await admin.from('post_media').select('path').eq('post_id', postId);
      if (media?.length) await admin.storage.from('post-media').remove(media.map((m) => m.path));
    }
  }
  revalidatePath('/admin');
  refresh(postId || undefined);
}

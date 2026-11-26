'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { hitLimit } from '@/lib/rate-limit';
import { POST_LIMITS, POST_REPORT_REASON, PROVIDER_KINDS } from '@/lib/posts-shared';

export type Result = { ok?: boolean; message?: string; id?: string; login?: boolean };

const Media = z.object({ kind: z.enum(['foto', 'video']), path: z.string().max(200), label: z.enum(['antes', 'depois']).nullable().optional() });
const MediaList = z.array(Media).max(POST_LIMITS.photos);

const PostInput = z.object({
  kind: z.enum(['trabalho', 'divulgacao', 'pedido']),
  body: z.string().max(POST_LIMITS.body),
  serviceId: z.number().int().positive().nullable(),
  categoryId: z.number().int().positive().nullable(),
  neighborhoodId: z.number().int().positive().nullable(),
  price: z.string().max(POST_LIMITS.price).nullable(),
  media: MediaList,
  publicName: z.string().max(60).optional(),
});
export type PostInputT = z.infer<typeof PostInput>;

function refresh(postId?: string) {
  revalidatePath('/');
  revalidatePath('/publicar');
  revalidatePath('/minhas-publicacoes');
  if (postId) revalidatePath(`/comunidade/${postId}`);
}

function checkMedia(kind: string, media: z.infer<typeof MediaList>, userId: string): string | null {
  const videos = media.filter((m) => m.kind === 'video').length;
  if (videos > 1 || (videos === 1 && media.length > 1)) return 'Use um vídeo OU até 6 fotos.';
  if (media.some((m) => !m.path.startsWith(`${userId}/`))) return 'Arquivo inválido.';
  if (kind === 'trabalho' && media.length === 0) return 'Adicione de 1 a 6 fotos do trabalho (ou um vídeo).';
  return null;
}

function friendly(code: string | undefined, msg: string | undefined): string {
  if (code === '54000') return 'Limite de 10 publicações por dia.';
  if (code === '42501') return 'Publique seu perfil de prestador e confirme onde atende antes de mostrar trabalhos.';
  if (code === '23514' && msg) return msg.replace(/\.$/, '') + '.';
  return 'Não foi possível publicar. Tente novamente.';
}

async function saveName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, name: string | undefined): Promise<string | null> {
  if (name === undefined) return null;
  const n = name.trim();
  if (n.length < 2 || n.length > 60) return 'Informe seu nome público (2 a 60 letras).';
  const { error } = await supabase.from('member_names').upsert({ user_id: userId, name: n, updated_at: new Date().toISOString() });
  return error ? 'Não foi possível salvar seu nome.' : null;
}

/**
 * Cria a publicação com as mídias já enviadas (fotos pela rota de upload; vídeo direto ao storage).
 * `token` torna o envio idempotente: repetir com o mesmo token devolve a mesma publicação.
 */
export async function createPost(raw: PostInputT & { token: string }): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para publicar.' };
  const token = z.string().uuid().safeParse(raw.token);
  const parsed = PostInput.safeParse(raw);
  if (!token.success || !parsed.success) return { message: 'Confira os campos e tente de novo.' };
  const p = parsed.data;
  const body = p.body.trim();

  const { data: existing } = await supabase.from('posts').select('id').eq('author_id', user.id).eq('client_token', token.data).maybeSingle();
  if (existing) return { ok: true, id: existing.id };

  const mErr = checkMedia(p.kind, p.media, user.id);
  if (mErr) return { message: mErr };
  if (PROVIDER_KINDS.includes(p.kind) && !p.serviceId) return { message: 'Escolha o serviço.' };
  if (p.kind === 'pedido' && !p.serviceId && !p.categoryId) return { message: 'Escolha o serviço ou a categoria.' };
  if (p.kind !== 'trabalho' && body.length < 10) return { message: p.kind === 'pedido' ? 'Descreva o que você precisa (pelo menos 10 letras).' : 'Escreva o texto da divulgação (pelo menos 10 letras).' };
  const nameErr = p.kind === 'pedido' ? await saveName(supabase, user.id, p.publicName) : null;
  if (nameErr) return { message: nameErr };
  if (!(await hitLimit('post', user.id, 20, 86400))) return { message: 'Muitas publicações hoje. Tente amanhã.' };

  const { data: post, error } = await supabase.from('posts').insert({
    author_id: user.id, kind: p.kind, body, service_id: p.serviceId, category_id: p.serviceId ? null : p.categoryId,
    neighborhood_id: p.neighborhoodId, price_label: p.kind === 'divulgacao' ? (p.price?.trim() || null) : null, client_token: token.data,
  }).select('id').single();
  if (error || !post) {
    if (error?.code === '23505') {
      const { data: again } = await supabase.from('posts').select('id').eq('author_id', user.id).eq('client_token', token.data).maybeSingle();
      if (again) return { ok: true, id: again.id };
    }
    return { message: friendly(error?.code, error?.message) };
  }
  if (p.media.length) {
    const { error: e2 } = await supabase.from('post_media').insert(p.media.map((m, i) => ({ post_id: post.id, kind: m.kind, path: m.path, sort: i, label: m.kind === 'foto' ? m.label ?? null : null })));
    if (e2) {
      await supabase.from('posts').delete().eq('id', post.id);
      return { message: 'Não foi possível anexar as fotos ou o vídeo. Tente de novo.' };
    }
  }
  refresh(post.id);
  return { ok: true, id: post.id };
}

/** O autor edita texto, serviço, bairro, preço e as fotos (ordem, capa, Antes/Depois, incluir e tirar). */
export async function updatePost(postId: string, raw: PostInputT): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para editar.' };
  const id = z.string().uuid().safeParse(postId);
  const parsed = PostInput.safeParse(raw);
  if (!id.success || !parsed.success) return { message: 'Confira os campos e tente de novo.' };
  const p = parsed.data;
  const { data: cur } = await supabase.from('posts').select('id, kind, status').eq('id', id.data).eq('author_id', user.id).maybeSingle();
  if (!cur) return { message: 'Só o autor pode editar esta publicação.' };
  if (cur.status !== 'publicado') return { message: 'Esta publicação foi removida pela moderação.' };
  const mErr = checkMedia(cur.kind, p.media, user.id);
  if (mErr) return { message: mErr };
  const body = p.body.trim();
  if (cur.kind !== 'trabalho' && body.length < 10) return { message: 'Escreva pelo menos 10 letras.' };

  const { error } = await supabase.from('posts').update({
    body, service_id: p.serviceId, category_id: p.serviceId ? null : p.categoryId, neighborhood_id: p.neighborhoodId,
    price_label: cur.kind === 'divulgacao' ? (p.price?.trim() || null) : null,
  }).eq('id', id.data).eq('author_id', user.id);
  if (error) return { message: friendly(error.code, error.message) };

  const { data: old } = await supabase.from('post_media').select('id, path').eq('post_id', id.data);
  const keep = new Set(p.media.map((m) => m.path));
  const gone = (old ?? []).filter((m) => !keep.has(m.path));
  if (gone.length) {
    await supabase.from('post_media').delete().in('id', gone.map((m) => m.id));
    await supabase.storage.from('post-media').remove(gone.map((m) => m.path));
  }
  const had = new Map((old ?? []).map((m) => [m.path, m.id]));
  for (const [i, m] of p.media.entries()) {
    const label = m.kind === 'foto' ? m.label ?? null : null;
    const rowId = had.get(m.path);
    const { error: e } = rowId
      ? await supabase.from('post_media').update({ sort: i, label }).eq('id', rowId)
      : await supabase.from('post_media').insert({ post_id: id.data, kind: m.kind, path: m.path, sort: i, label });
    if (e) return { message: 'Não foi possível salvar as fotos. Tente de novo.' };
  }
  refresh(id.data);
  return { ok: true, id: id.data };
}

/** Remove um arquivo enviado que não chegou a ser publicado (foto tirada antes de publicar). */
export async function discardUpload(path: string): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !path.startsWith(`${user.id}/`) || path.length > 200) return { ok: false };
  const { count } = await supabase.from('post_media').select('id', { count: 'exact', head: true }).eq('path', path);
  if (!count) await supabase.storage.from('post-media').remove([path]);
  return { ok: true };
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

/** O autor de um pedido marca (ou desmarca) "Indicação encontrada". */
export async function toggleFound(postId: string, found: boolean): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true };
  const id = z.string().uuid().safeParse(postId);
  if (!id.success) return { message: 'Publicação inválida.' };
  const { error, count } = await supabase.from('posts').update({ found }, { count: 'exact' }).eq('id', id.data).eq('author_id', user.id).eq('kind', 'pedido');
  if (error || !count) return { message: 'Não foi possível atualizar.' };
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

/** Salva ou tira dos salvos. */
export async function toggleSave(postId: string, on: boolean): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true };
  const id = z.string().uuid().safeParse(postId);
  if (!id.success) return { message: 'Publicação inválida.' };
  if (on) {
    const { error } = await supabase.from('post_saves').insert({ post_id: id.data, user_id: user.id });
    if (error && error.code !== '23505') return { message: 'Não foi possível salvar.' };
  } else {
    await supabase.from('post_saves').delete().eq('post_id', id.data).eq('user_id', user.id);
  }
  revalidatePath('/favoritos');
  return { ok: true };
}

/** Comenta ou responde (quem não é prestador informa o nome uma vez; o e-mail nunca aparece). Pode indicar um perfil público. */
export async function addComment(_: Result | undefined, form: FormData): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true, message: 'Entre para comentar.' };
  const postId = z.string().uuid().safeParse(form.get('post_id'));
  if (!postId.success) return { message: 'Publicação inválida.' };
  const body = String(form.get('body') ?? '').trim();
  if (!body) return { message: 'Escreva o comentário.' };
  if (body.length > POST_LIMITS.comment) return { message: `Use até ${POST_LIMITS.comment} caracteres.` };
  const parentRaw = form.get('parent_id');
  const parentId = parentRaw ? Number(parentRaw) : null;
  if (parentRaw && !Number.isInteger(parentId)) return { message: 'Comentário inválido.' };
  const prov = String(form.get('provider_id') ?? '');
  const providerId = prov ? z.string().uuid().safeParse(prov) : null;
  if (providerId && !providerId.success) return { message: 'Perfil indicado inválido.' };
  const name = form.get('name');
  const nameErr = typeof name === 'string' ? await saveName(supabase, user.id, name) : null;
  if (nameErr) return { message: nameErr };
  const { error } = await supabase.from('post_comments').insert({
    post_id: postId.data, author_id: user.id, body, parent_id: parentId, provider_id: providerId?.success ? providerId.data : null,
  });
  if (error) {
    if (error.code === '54000') return { message: 'Muitos comentários em pouco tempo. Aguarde um pouco.' };
    if (error.code === '23514') return { message: error.message.includes('nome') ? 'Informe seu nome para comentar.' : 'O perfil indicado não está disponível.' };
    return { message: 'Não foi possível comentar.' };
  }
  refresh(postId.data);
  return { ok: true };
}

/** O autor do comentário corrige o texto. */
export async function editComment(commentId: number, postId: string, body: string): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { login: true };
  const text = String(body ?? '').trim();
  if (!text || text.length > POST_LIMITS.comment) return { message: `Escreva de 1 a ${POST_LIMITS.comment} caracteres.` };
  const { error, count } = await supabase.from('post_comments').update({ body: text }, { count: 'exact' }).eq('id', commentId).eq('author_id', user.id);
  if (error || !count) return { message: 'Só quem escreveu pode editar o comentário.' };
  refresh(postId);
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

/** O autor da publicação oculta ou mostra um comentário (fica registrado no histórico). */
export async function hideComment(commentId: number, postId: string, hide: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('hide_comment', { p_comment: commentId, p_hide: hide });
  if (error) return { message: 'Não foi possível alterar o comentário.' };
  refresh(postId);
  return { ok: true };
}

/** Busca perfis públicos por nome ou serviço, para indicar num comentário. */
export async function findProviders(q: string): Promise<{ id: string; slug: string; name: string; service: string | null }[]> {
  const term = String(q ?? '').trim().slice(0, 60);
  if (term.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc('search_providers', { p_q: term, p_limit: 8 });
  return ((data ?? []) as { id: string; slug: string; display_name: string; main_service: string | null }[])
    .map((p) => ({ id: p.id, slug: p.slug, name: p.display_name, service: p.main_service }));
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

/** Moderação: ocultar publicação ou comentário (com motivo no histórico), ou marcar a denúncia como improcedente. */
export async function adminPostAction(form: FormData) {
  const supabase = await createClient();
  const op = String(form.get('op') ?? '');
  const note = String(form.get('note') ?? '').trim() || (op === 'improcedente' ? '' : 'Ocultado pela moderação');
  const postId = String(form.get('post_id') ?? '');
  const commentId = form.get('comment_id') ? Number(form.get('comment_id')) : null;
  const reportId = form.get('report_id') ? Number(form.get('report_id')) : null;
  if (op === 'improcedente' && reportId) {
    await supabase.rpc('admin_resolve_post_report', { p_report: reportId, p_status: 'improcedente', p_note: note });
  } else if (op === 'remover' && commentId) {
    await supabase.rpc('admin_remove_comment', { p_comment: commentId, p_note: note });
  } else if (op === 'remover' && postId) {
    // A publicação sai do ar; os arquivos ficam no bucket privado e deixam de receber link.
    await supabase.rpc('admin_remove_post', { p_post: postId, p_note: note });
  }
  revalidatePath('/admin');
  refresh(postId || undefined);
}

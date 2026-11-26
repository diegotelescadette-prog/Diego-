'use server';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/data';
import { parseResume } from '@/lib/resume';

export type ResumeState = { ok?: boolean; message?: string; errors?: Record<string, string> };

/** Salva o currículo (cria ou atualiza). A foto é tratada à parte. */
export async function saveResume(_: ResumeState, form: FormData): Promise<ResumeState> {
  const user = await getUser();
  if (!user) return { message: 'Entre na sua conta para salvar o currículo.' };
  const { data, errors } = parseResume(Object.fromEntries(form));
  if (!data) return { errors, message: 'Confira os campos destacados.' };
  const supabase = await createClient();
  const { photo_path: _p, ...row } = data;
  const { error } = await supabase.from('resumes').upsert({ ...row, user_id: user.id, email: row.email || null, phone: row.phone || null }, { onConflict: 'user_id' });
  if (error) return { message: 'Não foi possível salvar agora. Tente de novo.' };
  revalidatePath('/curriculo');
  return { ok: true, message: 'Currículo salvo.' };
}

/** Foto opcional: redimensionada para 480 px, sem metadados (localização, aparelho), no bucket privado. */
export async function uploadResumePhoto(_: ResumeState, form: FormData): Promise<ResumeState> {
  const user = await getUser();
  if (!user) return { message: 'Entre na sua conta.' };
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) return { errors: { photo: 'Escolha uma foto.' } };
  if (file.size > 8 * 1024 * 1024) return { errors: { photo: 'A foto pode ter até 8 MB.' } };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { errors: { photo: 'Use uma foto JPG, PNG ou WebP.' } };
  const supabase = await createClient();
  const { data: cur } = await supabase.from('resumes').select('photo_path').eq('user_id', user.id).maybeSingle();
  if (!cur) return { message: 'Salve o currículo antes de colocar a foto.' };
  let jpg: Buffer;
  try {
    jpg = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(480, 480, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return { errors: { photo: 'Não conseguimos ler essa imagem. Tente outra.' } };
  }
  const path = `${user.id}/foto-${Date.now()}.jpg`;
  const admin = createAdminClient();
  const up = await admin.storage.from('curriculos').upload(path, jpg, { contentType: 'image/jpeg' });
  if (up.error) return { message: 'Não foi possível enviar a foto. Tente de novo.' };
  await supabase.from('resumes').update({ photo_path: path }).eq('user_id', user.id);
  if (cur.photo_path) await admin.storage.from('curriculos').remove([cur.photo_path]);
  revalidatePath('/curriculo');
  return { ok: true, message: 'Foto salva.' };
}

export async function removeResumePhoto(): Promise<void> {
  const user = await getUser();
  if (!user) return;
  const supabase = await createClient();
  const { data: cur } = await supabase.from('resumes').select('photo_path').eq('user_id', user.id).maybeSingle();
  if (cur?.photo_path) {
    await supabase.from('resumes').update({ photo_path: null }).eq('user_id', user.id);
    await createAdminClient().storage.from('curriculos').remove([cur.photo_path]);
  }
  revalidatePath('/curriculo');
}

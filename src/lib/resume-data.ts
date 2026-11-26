import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { emptyResume, type ResumeData } from '@/lib/resume';

/** Currículo da própria pessoa (ou um em branco com nome e e-mail já preenchidos). */
export async function getMyResume(userId: string, email: string | null | undefined): Promise<{ data: ResumeData; exists: boolean; updatedAt: string | null }> {
  const supabase = await createClient();
  const [{ data: r }, { data: nm }] = await Promise.all([
    supabase.from('resumes').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('member_names').select('name').eq('user_id', userId).maybeSingle(),
  ]);
  if (!r) return { data: emptyResume(nm?.name ?? '', email ?? ''), exists: false, updatedAt: null };
  return {
    exists: true, updatedAt: r.updated_at,
    data: {
      full_name: r.full_name, headline: r.headline ?? '', summary: r.summary ?? '', email: r.email ?? '', phone: r.phone ?? '',
      neighborhood_id: r.neighborhood_id, photo_path: r.photo_path, experiences: r.experiences ?? [], education: r.education ?? [],
      skills: r.skills ?? [], references_list: r.references_list ?? [],
    },
  };
}

/** Link temporário (10 min) para uma foto do bucket privado. Chame só depois de conferir quem pode ver. */
export async function signedPhoto(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await createAdminClient().storage.from('curriculos').createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

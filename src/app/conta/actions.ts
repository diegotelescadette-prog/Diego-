'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type DelState = { message?: string } | undefined;

/** Exclusão da conta e dos dados (perfil, dados privados, fotos, favoritos). */
export async function deleteAccount(_: DelState, form: FormData): Promise<DelState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');
  if (String(form.get('confirm') ?? '').trim().toUpperCase() !== 'EXCLUIR') return { message: 'Digite EXCLUIR para confirmar.' };
  const admin = createAdminClient();
  const [{ data: photos }, { data: prof }] = await Promise.all([
    admin.from('provider_work_photos').select('path').eq('provider_id', user.id),
    admin.from('provider_profiles').select('photo_path').eq('id', user.id).maybeSingle(),
  ]);
  const paths = [...(photos ?? []).map((p) => p.path), ...(prof?.photo_path ? [prof.photo_path] : [])];
  if (paths.length) await admin.storage.from('profile-photos').remove(paths);
  const { error } = await admin.auth.admin.deleteUser(user.id); // cascata remove perfil, dados privados e favoritos
  if (error) return { message: 'Não foi possível excluir agora. Tente novamente.' };
  await supabase.auth.signOut();
  redirect('/?conta=excluida');
}

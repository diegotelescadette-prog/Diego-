'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type DelState = { message?: string } | undefined;

/** Exclusão da conta e dos dados (perfil, dados privados, fotos, favoritos, vagas, candidaturas e currículos). */
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
  // Currículos: os que a pessoa enviou e os recebidos nas vagas que ela publicou.
  const [{ data: sent }, { data: myJobs }, { data: bank }] = await Promise.all([
    admin.from('job_applications').select('resume_path').eq('applicant_id', user.id),
    admin.from('jobs').select('id').eq('poster_id', user.id),
    admin.from('talent_profiles').select('resume_path').eq('user_id', user.id),
  ]);
  const jobIds = (myJobs ?? []).map((j) => j.id);
  const { data: received } = jobIds.length
    ? await admin.from('job_applications').select('resume_path').in('job_id', jobIds)
    : { data: [] as { resume_path: string }[] };
  const resumes = [...(sent ?? []), ...(received ?? []), ...(bank ?? [])].map((a) => a.resume_path);
  for (let i = 0; i < resumes.length; i += 100) await admin.storage.from('curriculos').remove(resumes.slice(i, i + 100));
  const { error } = await admin.auth.admin.deleteUser(user.id); // cascata remove perfil, dados privados, favoritos, vagas e candidaturas
  if (error) return { message: 'Não foi possível excluir agora. Tente novamente.' };
  await supabase.auth.signOut();
  redirect('/?conta=excluida');
}

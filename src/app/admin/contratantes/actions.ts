'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function reviewEmployer(form: FormData) {
  const supabase = await createClient();
  const status = String(form.get('status'));
  const { error } = await supabase.rpc('admin_review_employer', { p_user: String(form.get('user')), p_status: status, p_note: String(form.get('note') ?? '') });
  revalidatePath('/admin/contratantes');
  const msg = error ? 'Não foi possível salvar.' : status === 'verificado' ? 'Contratante verificado. As vagas guardadas foram ao ar.' : 'Verificação recusada. A pessoa vê o motivo e pode reenviar.';
  redirect(`/admin/contratantes?msg=${encodeURIComponent(msg)}`);
}

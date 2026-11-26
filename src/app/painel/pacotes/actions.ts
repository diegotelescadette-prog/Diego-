'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Salva os pacotes que o profissional faz. O banco guarda só os desmarcados (por padrão, faz todos). */
export async function saveMyPackages(form: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?next=%2Fpainel%2Fpacotes');
  const all = form.getAll('all').map(Number).filter(Number.isInteger);
  const on = new Set(form.getAll('on').map(Number));
  const off = all.filter((id) => !on.has(id));
  const { error } = await supabase.rpc('set_my_packages', { p_off: off });
  revalidatePath('/painel/pacotes');
  redirect(`/painel/pacotes?msg=${encodeURIComponent(error ? 'Não foi possível salvar. Tente de novo.' : 'Pacotes salvos. Você só recebe pedidos dos pacotes marcados.')}`);
}

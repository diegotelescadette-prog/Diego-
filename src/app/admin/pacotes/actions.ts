'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getIsAdmin } from '@/lib/data';
import { slugify } from '@/lib/validation';

async function admin() {
  if (!(await getIsAdmin())) redirect('/admin/pacotes');
  return createClient();
}
function done(msg: string, anchor = ''): never {
  revalidatePath('/', 'layout');
  redirect(`/admin/pacotes?msg=${encodeURIComponent(msg)}${anchor}`);
}
const lines = (v: FormDataEntryValue | null) => String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);

export async function savePackage(form: FormData) {
  const sb = await admin();
  const id = Number(form.get('id')) || null;
  const name = String(form.get('name') ?? '').trim();
  const duration = Number(form.get('duration_min'));
  // Sem preço fixo: o valor é de cada profissional, informado no pedido.
  if (name.length < 3 || !(duration >= 10 && duration <= 720)) done('Confira o nome e a duração (10 a 720 minutos).');
  const row = {
    name, duration_min: duration,
    description: String(form.get('description') ?? '').trim().slice(0, 400),
    includes: lines(form.get('includes')), excludes: lines(form.get('excludes')),
    featured: form.get('featured') === '1', active: form.get('active') === '1',
  };
  const { error } = id
    ? await sb.from('service_packages').update(row).eq('id', id)
    : await sb.from('service_packages').insert({ ...row, price_cents: 100, service_id: Number(form.get('service_id')), slug: slugify(name), sort: 500 });
  if (error) done(error.code === '23505' ? 'Já existe um pacote com esse nome.' : 'Não foi possível salvar. Confira os campos.');
  done(id ? `“${name}” salvo.` : `“${name}” criado.`);
}

export async function saveAddon(form: FormData) {
  const sb = await admin();
  const id = Number(form.get('id')) || null;
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 3) done('Confira o nome do adicional.');
  const { error } = id
    ? await sb.from('package_addons').update({ name, active: form.get('active') === '1' }).eq('id', id)
    : await sb.from('package_addons').insert({ package_id: Number(form.get('package_id')), name, price_cents: 0 });
  done(error ? 'Não foi possível salvar o adicional.' : 'Adicional salvo.');
}

export async function saveBookingRules(form: FormData) {
  const sb = await admin();
  const pct = Number(String(form.get('percent') ?? '').replace(',', '.'));
  const minutes = Number(form.get('minutes'));
  if (!(pct >= 0 && pct <= 50) || !(minutes >= 2 && minutes <= 120)) done('A comissão vai de 0 a 50% e o prazo de 2 a 120 minutos.');
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('app_settings').upsert([
    { key: 'comissao', value: { percent: pct }, updated_by: user?.id },
    { key: 'prazo_aceite', value: { minutes }, updated_by: user?.id },
  ]);
  done(error ? 'Não foi possível salvar as regras.' : 'Regras dos pedidos salvas.');
}

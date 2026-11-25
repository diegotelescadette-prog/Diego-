'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getIsAdmin } from '@/lib/data';
import { slugify } from '@/lib/validation';

// Toda escrita também é barrada pela RLS (is_admin()) e registrada no histórico por gatilho.
// A permissão é conferida no servidor em cada ação (e de novo no banco).
async function admin() {
  if (!(await getIsAdmin())) redirect('/admin');
  return createClient();
}
const done = (aba: string, msg?: string, back?: FormDataEntryValue | null): never => {
  revalidatePath('/', 'layout');
  // Volta para a mesma lista (filtros preservados) quando o destino é uma página do admin.
  const b = typeof back === 'string' && /^\/admin\?aba=[a-z]+(&|$)/.test(back) ? new URL(back, 'http://x') : null;
  const qs = b ? b.searchParams : new URLSearchParams({ aba });
  qs.delete('msg');
  if (msg) qs.set('msg', msg);
  redirect(`/admin?${qs}`);
};

export async function toggleCategory(form: FormData) {
  const sb = await admin();
  await sb.from('service_categories').update({ active: form.get('active') === '1' }).eq('id', Number(form.get('id')));
  done('catalogo');
}
export async function toggleService(form: FormData) {
  const sb = await admin();
  await sb.from('services').update({ active: form.get('active') === '1' }).eq('id', Number(form.get('id')));
  done('catalogo');
}
export async function toggleUrgent(form: FormData) {
  const sb = await admin();
  const on = form.get('urgent') === '1';
  const { data, error } = await sb.from('services').update({ urgent_pilot: on }).eq('id', Number(form.get('id'))).select('name, urgent_pilot, mode').single();
  if (error || !data) done('catalogo', 'Não foi possível alterar. Tente de novo.');
  done('catalogo', on && !data!.urgent_pilot
    ? `“${data!.name}” é só online e não pode entrar no “Preciso para hoje”`
    : `“${data!.name}” ${data!.urgent_pilot ? 'agora aparece' : 'saiu'} no “Preciso para hoje”`);
}
export async function createService(form: FormData) {
  const sb = await admin();
  const name = String(form.get('name') ?? '').trim();
  const mode = String(form.get('mode') ?? 'presencial');
  if (name.length < 2 || !['presencial', 'online', 'ambos'].includes(mode)) done('catalogo', 'Nome ou modo inválido');
  const { error } = await sb.from('services').insert({ category_id: Number(form.get('category_id')), name, slug: slugify(name), mode, sort: 999 });
  done('catalogo', error ? 'Não foi possível criar (nome repetido?)' : `Serviço “${name}” criado`);
}
export async function addSynonym(form: FormData) {
  const sb = await admin();
  const term = String(form.get('term') ?? '').trim();
  if (term.length < 2) done('catalogo', 'Sinônimo muito curto');
  const { error } = await sb.from('service_synonyms').insert({ service_id: Number(form.get('service_id')), term });
  done('catalogo', error ? 'Sinônimo já existe' : `Sinônimo “${term}” adicionado`);
}
export async function removeSynonym(form: FormData) {
  const sb = await admin();
  await sb.from('service_synonyms').delete().eq('id', Number(form.get('id')));
  done('catalogo');
}

export async function resolveSuggestion(form: FormData) {
  const sb = await admin();
  const { data: { user } } = await sb.auth.getUser();
  const id = Number(form.get('id'));
  const op = String(form.get('op'));
  const { data: sug } = await sb.from('service_suggestions').select('name').eq('id', id).single();
  if (!sug) done('sugestoes', 'Sugestão não encontrada');
  let serviceId: number | null = null;
  let status = 'recusada';
  if (op === 'incorporar') {
    const name = String(form.get('name') || sug!.name).trim();
    const { data, error } = await sb.from('services').insert({
      category_id: Number(form.get('category_id')), name, slug: slugify(name), mode: String(form.get('mode') ?? 'presencial'), sort: 999,
    }).select('id').single();
    if (error) done('sugestoes', 'Não foi possível criar o serviço (nome repetido?)');
    serviceId = data!.id; status = 'incorporada';
  } else if (op === 'associar') {
    serviceId = Number(form.get('service_id'));
    await sb.from('service_synonyms').insert({ service_id: serviceId, term: sug!.name });
    status = 'associada';
  }
  await sb.from('service_suggestions').update({ status, service_id: serviceId, reviewed_by: user!.id, reviewed_at: new Date().toISOString() }).eq('id', id);
  done('sugestoes', `Sugestão ${status}`);
}

export async function resolveReport(form: FormData) {
  const sb = await admin();
  const id = Number(form.get('id'));
  const status = String(form.get('status'));
  const note = String(form.get('note') ?? '').trim() || null;
  const { error } = await sb.rpc('admin_resolve_report', { p_report: id, p_status: status, p_note: note });
  if (!error && form.get('suspend') === 'on') {
    await sb.rpc('admin_set_provider_status', { p_provider: String(form.get('provider_id')), p_status: 'suspended', p_note: `Denúncia #${id}${note ? `: ${note}` : ''}` });
  }
  done('denuncias', error ? error.message : 'Denúncia avaliada', form.get('back'));
}

const STATUS_RESULT: Record<string, string> = {
  suspended: 'Perfil suspenso', published: 'Perfil reativado e publicado', paused: 'Perfil pausado',
  draft: 'Perfil reativado como rascunho (cadastro incompleto)',
};
export async function setProviderStatus(form: FormData) {
  const sb = await admin();
  const name = String(form.get('name') ?? '').trim();
  const { data, error } = await sb.rpc('admin_set_provider_status', {
    p_provider: String(form.get('provider_id')), p_status: String(form.get('status')), p_note: String(form.get('note') ?? ''),
  });
  done('perfis', error ? `Não foi possível alterar: ${error.message}` : `${STATUS_RESULT[String(data)] ?? `Estado: ${data}`}${name ? `: ${name}` : ''}`, form.get('back'));
}

export async function saveCpfSetting(form: FormData) {
  const sb = await admin();
  const enabled = form.get('enabled') === 'on';
  const purpose = String(form.get('purpose') ?? '').trim();
  const confirmed = form.get('necessity_confirmed') === 'on';
  if (enabled && (purpose.length < 10 || !confirmed)) {
    done('config', 'Para habilitar o CPF, descreva a finalidade e confirme a necessidade');
  }
  await sb.from('app_settings').upsert({ key: 'cpf_collection', value: { enabled, purpose: purpose || null, necessity_confirmed: confirmed } });
  done('config', 'Configuração salva');
}

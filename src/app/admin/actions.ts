'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getIsAdmin } from '@/lib/data';
import { slugify } from '@/lib/validation';

// Toda escrita também é barrada pela RLS (is_admin()) e registrada no histórico por gatilho.
async function admin() {
  if (!(await getIsAdmin())) redirect('/');
  return createClient();
}
const done = (aba: string, msg?: string): never => {
  revalidatePath('/', 'layout');
  redirect(`/admin?aba=${aba}${msg ? `&msg=${encodeURIComponent(msg)}` : ''}`);
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
  done('denuncias', error ? error.message : 'Denúncia avaliada');
}

export async function setProviderStatus(form: FormData) {
  const sb = await admin();
  const { data, error } = await sb.rpc('admin_set_provider_status', {
    p_provider: String(form.get('provider_id')), p_status: String(form.get('status')), p_note: String(form.get('note') ?? ''),
  });
  done('perfis', error ? error.message : `Perfil agora: ${data}`);
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

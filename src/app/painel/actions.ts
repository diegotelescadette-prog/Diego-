'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptCpf } from '@/lib/cpf-crypto';
import { getAllServices, getSetting, type CpfSetting } from '@/lib/data';
import { isValidCep, isValidCpf, normalizePhone, normalizeWhatsapp, onlyDigits, slugify, UFS } from '@/lib/validation';
import { MISSING_LABEL } from '@/lib/types';

export type FormState = { errors?: Record<string, string>; message?: string; ok?: boolean; values?: Record<string, string> } | undefined;

// Devolve o que foi digitado para o formulário não perder os dados após erro.
const keep = (form: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(form.get(k) ?? '')]));

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?next=/painel');
  return { supabase, user };
}

/** Cria o rascunho do perfil na primeira visita ao formulário (salvamento após o acesso). */
export async function ensureProfile() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from('provider_profiles').select('id').eq('id', user.id).maybeSingle();
  if (data) return;
  const { error } = await supabase.from('provider_profiles').insert({ id: user.id, slug: `perfil-${crypto.randomBytes(4).toString('hex')}` });
  if (error && error.code !== '23505') throw new Error('Não foi possível criar o rascunho');
}

// ----------------------------------------------------------------- Etapa 1
export async function saveProfileStep(_: FormState, form: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const intent = String(form.get('intent') ?? 'continuar');
  // 'tudo' = pré-cadastro (etapa 1); 'perfil' = nome, apresentação e contato; 'servicos' = especialidades e fotos.
  const section = (['perfil', 'servicos'] as const).find((x) => x === form.get('section')) ?? 'tudo';
  const doContact = section !== 'servicos';
  const doServices = section !== 'perfil';
  const { data: profile } = await supabase.from('provider_profiles').select('status, slug, photo_path, display_name, main_service_id').eq('id', user.id).single();
  if (!profile) return { message: 'Perfil não encontrado' };
  const strict = (intent === 'continuar' && section === 'tudo') || profile.status !== 'draft';
  const errors: Record<string, string> = {};

  const displayName = doContact ? String(form.get('display_name') ?? '').trim().replace(/\s+/g, ' ') : profile.display_name;
  if (doContact && displayName.length > 80) errors.display_name = 'Use até 80 caracteres';
  else if (doContact && strict && displayName.length < 3) errors.display_name = 'Informe seu nome profissional';

  const phoneRaw = doContact ? String(form.get('phone') ?? '') : '';
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) errors.phone = 'Telefone inválido. Use DDD + número, ex.: (67) 99999-1234';
  else if (doContact && strict && !phone) errors.phone = 'Informe um telefone com DDD';

  const sameNumber = form.get('same_whatsapp') === 'on';
  const waRaw = sameNumber ? phoneRaw : String(form.get('whatsapp') ?? '');
  const whatsapp = waRaw ? normalizeWhatsapp(waRaw) : null;
  if (sameNumber && errors.phone) { /* o erro do telefone já explica */ }
  else if (waRaw && !whatsapp) errors[sameNumber ? 'phone' : 'whatsapp'] = 'O WhatsApp precisa ser um celular com DDD, ex.: (67) 99999-1234';
  else if (doContact && strict && !whatsapp) errors.whatsapp = 'Informe o WhatsApp para contato';

  const cpfSetting = await getSetting<CpfSetting>('cpf_collection');
  const cpfEnabled = !!cpfSetting?.enabled;
  const { data: priv } = await supabase.from('provider_private').select('cpf_ciphertext').eq('provider_id', user.id).maybeSingle();
  let cpfCipher: string | undefined;
  let cpfLast2: string | undefined;
  if (cpfEnabled && doContact) {
    const cpfRaw = String(form.get('cpf') ?? '');
    if (cpfRaw) {
      if (!isValidCpf(cpfRaw)) errors.cpf = 'CPF inválido. Confira os números digitados';
      else { const d = onlyDigits(cpfRaw); cpfCipher = encryptCpf(d); cpfLast2 = d.slice(-2); }
    } else if (strict && !priv?.cpf_ciphertext) errors.cpf = 'Informe seu CPF';
    if (form.get('cpf_aviso') !== 'on' && cpfRaw) errors.cpf = 'Confirme que leu o aviso sobre o uso do CPF';
  }

  const all = await getAllServices();
  const serviceIds = [...new Set(form.getAll('services').map(Number))].filter((id) => all.some((s) => s.id === id));
  let mainId = doServices ? Number(form.get('main_service')) || null : profile.main_service_id;
  if (doServices) {
    if (serviceIds.length > 10) errors.services = 'Escolha até 10 serviços';
    else if (strict && serviceIds.length === 0) errors.services = 'Escolha pelo menos um serviço';
    if (serviceIds.length === 1) mainId = serviceIds[0];
    if (mainId && !serviceIds.includes(mainId)) mainId = null;
    if (strict && serviceIds.length > 0 && !mainId) errors.main_service = 'Indique o serviço principal';
  }

  const bio = String(form.get('bio') ?? '').trim();
  if (doContact && bio.length > 600) errors.bio = 'Use até 600 caracteres';

  if (doServices && (intent === 'continuar' || (section === 'servicos' && profile.status !== 'draft')) && !profile.photo_path) errors.photo = 'Envie uma foto de perfil';

  if (Object.keys(errors).length) {
    return { errors, message: 'Corrija os campos destacados.', values: keep(form, ['display_name', 'phone', 'whatsapp', 'bio']) };
  }

  const patch: Record<string, unknown> = {};
  if (doContact) Object.assign(patch, { display_name: displayName, bio: bio || null });
  if (doServices) patch.main_service_id = mainId;
  if (section === 'tudo') patch.draft_step = intent === 'continuar' ? 2 : 1;
  const { error: e1 } = await supabase.from('provider_profiles').update(patch).eq('id', user.id);
  if (e1) return { message: 'Não foi possível salvar. Tente de novo.', values: keep(form, ['display_name', 'phone', 'whatsapp', 'bio']) };

  // serviços: substitui a seleção
  let toDel: number[] = [], toAdd: number[] = [];
  if (doServices) {
    const { data: current } = await supabase.from('provider_services').select('service_id').eq('provider_id', user.id);
    const cur = (current ?? []).map((r) => r.service_id as number);
    toDel = cur.filter((id) => !serviceIds.includes(id));
    toAdd = serviceIds.filter((id) => !cur.includes(id));
    const r1 = toDel.length ? await supabase.from('provider_services').delete().eq('provider_id', user.id).in('service_id', toDel) : { error: null };
    const r2 = toAdd.length ? await supabase.from('provider_services').insert(toAdd.map((service_id) => ({ provider_id: user.id, service_id }))) : { error: null };
    if (r1.error || r2.error) return { message: 'Não foi possível salvar os serviços. Tente de novo.' };
  }

  if (doContact) {
    const privPatch: Record<string, unknown> = { provider_id: user.id, phone, whatsapp };
    if (cpfCipher) { privPatch.cpf_ciphertext = cpfCipher; privPatch.cpf_last2 = cpfLast2; }
    const { error: e2 } = await supabase.from('provider_private').upsert(privPatch);
    if (e2) return { message: 'Não foi possível salvar os dados de contato.', values: keep(form, ['display_name', 'phone', 'whatsapp', 'bio']) };
  }

  // Endereço amigável enquanto rascunho
  const base = slugify(displayName);
  if (doContact && profile.status === 'draft' && base && !profile.slug.startsWith(base + '-')) {
    await createAdminClient().from('provider_profiles')
      .update({ slug: `${base}-${crypto.randomBytes(2).toString('hex')}` }).eq('id', user.id);
  }
  // Serviços mudaram: o "Atendo hoje" fica só com o que continua no perfil.
  const today = toDel.length || toAdd.length ? await revalidateToday(supabase) : null;

  revalidatePath('/', 'layout');
  if (intent === 'continuar' && section === 'tudo') redirect('/painel/atendimento');
  return { ok: true, message: savedMessage(profile.status === 'draft' && section === 'tudo' ? 'Rascunho salvo.' : 'Alterações salvas.', today) };
}

type SB = Awaited<ReturnType<typeof createClient>>;
async function revalidateToday(supabase: SB): Promise<string | null> {
  const { data } = await supabase.rpc('revalidate_my_available_today');
  return (data as string | null) ?? null;
}
function savedMessage(base: string, today: string | null) {
  if (today === 'ajustada') return `${base} O “Atendo hoje” foi ajustado para os serviços e a área que continuam no seu perfil.`;
  if (today === 'removida') return `${base} O “Atendo hoje” foi desativado porque os serviços ou a área de hoje saíram do seu perfil.`;
  return base;
}

// ----------------------------------------------------------------- Etapa 2
export async function saveAreaStep(_: FormState, form: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const intent = String(form.get('intent') ?? 'continuar');
  const { data: profile } = await supabase.from('provider_profiles').select('status').eq('id', user.id).single();
  if (!profile) return { message: 'Perfil não encontrado' };
  const strict = intent === 'continuar' || profile.status !== 'draft';
  const errors: Record<string, string> = {};
  const s = (k: string) => String(form.get(k) ?? '').trim();

  const cep = onlyDigits(s('cep'));
  if (cep && !isValidCep(cep)) errors.cep = 'CEP deve ter 8 números';
  else if (strict && !cep) errors.cep = 'Informe o CEP';
  const street = s('street'), number = s('number'), complement = s('complement'), refNb = s('ref_neighborhood'), refCity = s('ref_city');
  const uf = s('uf').toUpperCase();
  if (strict && !street) errors.street = 'Informe a rua';
  if (strict && !number) errors.number = 'Informe o número (ou “s/n”)';
  if (strict && !refNb) errors.ref_neighborhood = 'Informe o bairro';
  if (strict && !refCity) errors.ref_city = 'Informe a cidade';
  if (uf && !UFS.includes(uf)) errors.uf = 'UF inválida';
  else if (strict && !uf) errors.uf = 'Informe a UF';
  for (const [k, v, max] of [['street', street, 120], ['number', number, 10], ['complement', complement, 60], ['ref_neighborhood', refNb, 80], ['ref_city', refCity, 80]] as const) {
    if (v.length > max) errors[k] = `Use até ${max} caracteres`;
  }

  const cityId = Number(form.get('city_id')) || null;
  const { data: city } = cityId ? await supabase.from('cities').select('id').eq('id', cityId).eq('active', true).maybeSingle() : { data: null };
  if (strict && !city) errors.city_id = 'Escolha a cidade onde você atende';
  const mode = s('area_mode');
  const wholeCity = mode === 'cidade';
  const nbIds = [...new Set(form.getAll('neighborhoods').map(Number))];
  let validNb: number[] = [];
  if (city && !wholeCity && nbIds.length) {
    const { data } = await supabase.from('neighborhoods').select('id').eq('city_id', city.id).in('id', nbIds);
    validNb = (data ?? []).map((r) => r.id as number);
  }

  const { data: svc } = await supabase.from('provider_services').select('services(mode)').eq('provider_id', user.id);
  const modes = (svc ?? []).map((r) => (r.services as unknown as { mode: string } | null)?.mode);
  const canOnline = modes.some((m) => m === 'online' || m === 'ambos');
  const onlyOnline = modes.length > 0 && modes.every((m) => m === 'online');
  const online = form.get('online') === 'on' && canOnline;
  if (form.get('online') === 'on' && !canOnline) errors.online = 'Nenhum dos seus serviços é oferecido online';
  if (strict && !mode && !(onlyOnline && online)) {
    errors.area_mode = 'Escolha se você atende toda a cidade ou bairros selecionados';
  } else if (strict && mode === 'bairros' && validNb.length === 0 && !(onlyOnline && online)) {
    errors.neighborhoods = 'Escolha pelo menos um bairro ou marque “Atendo em toda Campo Grande”';
  }

  if (Object.keys(errors).length) {
    return { errors, message: 'Corrija os campos destacados.', values: keep(form, ['cep', 'number', 'complement']) };
  }

  const { error: e1 } = await supabase.from('provider_private').upsert({
    provider_id: user.id, ref_cep: cep || null, ref_street: street || null, ref_number: number || null,
    ref_complement: complement || null, ref_neighborhood: refNb || null, ref_city: refCity || null, ref_uf: uf || null,
  });
  const { error: e2 } = await supabase.from('provider_profiles').update({
    city_id: city?.id ?? null, serves_whole_city: wholeCity, serves_online: online, draft_step: intent === 'continuar' ? 3 : 2,
  }).eq('id', user.id);
  if (e1 || e2) return { message: 'Não foi possível salvar. Tente de novo.' };

  const { data: oldAreas } = await supabase.from('provider_areas').select('neighborhood_id').eq('provider_id', user.id);
  const prev = (oldAreas ?? []).map((a) => a.neighborhood_id as number);
  const next = wholeCity ? [] : validNb;
  const toRemove = prev.filter((id) => !next.includes(id));
  const toInsert = next.filter((id) => !prev.includes(id));
  const r1 = toRemove.length ? await supabase.from('provider_areas').delete().eq('provider_id', user.id).in('neighborhood_id', toRemove) : { error: null };
  const r2 = toInsert.length ? await supabase.from('provider_areas').insert(toInsert.map((neighborhood_id) => ({ provider_id: user.id, neighborhood_id }))) : { error: null };
  if (r1.error || r2.error) return { message: 'Não foi possível salvar os bairros. Tente de novo.', values: keep(form, ['cep', 'number', 'complement']) };
  // Cobertura habitual mudou: revalida a área do dia antes de aparecer na busca ou liberar contato.
  const today = await revalidateToday(supabase);

  revalidatePath('/', 'layout');
  if (intent === 'continuar') redirect(`/painel/previa${today === 'ajustada' || today === 'removida' ? `?hoje=${today}` : ''}`);
  return { ok: true, message: savedMessage('Rascunho salvo.', today) };
}

// ----------------------------------------------------------------- Publicação e estado
export async function publishProfile(_: FormState): Promise<FormState> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc('publish_my_profile');
  if (error) {
    const m = error.message.match(/Perfil incompleto: (.*)/);
    if (m) return { message: `Falta preencher: ${m[1].split(',').map((k) => MISSING_LABEL[k] ?? k).join(', ')}.` };
    return { message: error.message };
  }
  revalidatePath('/', 'layout');
  redirect('/painel?publicado=1');
}

export async function setProfileStatus(form: FormData) {
  const { supabase } = await requireUser();
  const status = String(form.get('status'));
  if (status !== 'paused' && status !== 'published') return;
  const { error } = await supabase.rpc('set_my_profile_status', { p_status: status });
  revalidatePath('/', 'layout');
  redirect(error ? `/painel?erro=${encodeURIComponent(error.message.slice(0, 120))}` : '/painel');
}

// ----------------------------------------------------------------- Atendo hoje
export async function enableToday(_: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const services = form.getAll('today_services').map(Number).filter(Boolean);
  const wholeCity = form.get('today_whole_city') === 'on';
  const nbs = wholeCity ? [] : form.getAll('today_neighborhoods').map(Number).filter(Boolean);
  if (services.length === 0) return { errors: { today_services: 'Escolha pelo menos um serviço para hoje' } };
  if (!wholeCity && nbs.length === 0) return { errors: { today_neighborhoods: 'Escolha pelo menos um bairro para hoje' } };
  const { error } = await supabase.rpc('set_available_today', {
    p_service_ids: services, p_neighborhood_ids: nbs, p_whole_city: wholeCity,
  });
  if (error) return { message: `${error.message}. Tente novamente.` };
  revalidatePath('/', 'layout');
  return { ok: true, message: form.get('ajuste') === '1' ? 'Disponibilidade de hoje atualizada.' : '“Atendo hoje” ativado.' };
}

export async function disableToday() {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc('clear_available_today');
  revalidatePath('/', 'layout');
  if (error) redirect(`/painel?erro=${encodeURIComponent('Não foi possível desativar agora. Tente novamente.')}`);
}

// ----------------------------------------------------------------- Fotos
export async function deleteWorkPhoto(form: FormData) {
  const { supabase, user } = await requireUser();
  const id = Number(form.get('id'));
  const { data } = await supabase.from('provider_work_photos').select('path').eq('id', id).eq('provider_id', user.id).maybeSingle();
  if (!data) return;
  await supabase.from('provider_work_photos').delete().eq('id', id);
  await supabase.storage.from('profile-photos').remove([data.path]);
  revalidatePath('/painel', 'layout');
}

// ----------------------------------------------------------------- Sugestão de serviço
export async function suggestService(_: FormState, form: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const name = String(form.get('name') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();
  if (name.length < 2 || name.length > 80) return { errors: { name: 'Informe o nome do serviço (2 a 80 caracteres)' } };
  if (note.length > 300) return { errors: { note: 'Use até 300 caracteres' } };
  const { error } = await supabase.from('service_suggestions').insert({ user_id: user.id, name, note: note || null });
  if (error) return { message: error.code === '54000' ? 'Você atingiu o limite diário de sugestões.' : 'Não foi possível enviar.' };
  return { ok: true, message: 'Obrigado! Vamos avaliar e avisar no catálogo quando for incluído.' };
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anon, signIn, viewer } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const uid = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
const svc = async (slug: string) => (await admin.from('services').select('id').eq('slug', slug).single()).data!.id as number;
const profileId = async (slug: string) => (await admin.from('provider_profiles').select('id').eq('slug', slug).single()).data!.id as string;
type Cov = { service_slug: string; apt: number; analysis: number; category_active: boolean };
const coverage = async (c: SupabaseClient) => ((await c.rpc('admin_launch_coverage', { p_city_slug: 'campo-grande-ms' })).data ?? []) as Cov[];
const aptTotal = async (c: SupabaseClient, extra: Record<string, unknown> = {}) =>
  Number(((await c.rpc('admin_providers', { p_city_slug: 'campo-grande-ms', p_launch: 'apto', p_limit: 1, ...extra })).data ?? [])[0]?.total_count ?? 0);
const search = async (c: SupabaseClient, args: Record<string, unknown>) =>
  ((await c.rpc('search_providers', { p_city_slug: 'campo-grande-ms', ...args })).data ?? []) as { slug: string; main_service: string | null }[];
const setRule = (enabled: boolean) => admin.from('app_settings').upsert({ key: 'verificacao_obrigatoria', value: { enabled } });
const setCredit = (active: boolean) => admin.from('service_categories').update({ active }).eq('slug', 'credito-imobiliario');

test('cobertura: perfil com quatro serviços conta nas quatro linhas e uma vez no total', async () => {
  const adm = await signIn('admin');
  const carlos = await profileId('carlos-demo');
  const extra = ['caca-vazamentos', 'limpador-de-caixa-dagua'];
  const before = await coverage(adm);
  const totalBefore = await aptTotal(adm);
  const ids = await Promise.all(extra.map(svc));
  await admin.from('provider_services').insert(ids.map((service_id) => ({ provider_id: carlos, service_id })));
  const after = await coverage(adm);
  for (const s of ['encanador', 'desentupidor']) {
    assert.equal(after.find((r) => r.service_slug === s)!.apt, before.find((r) => r.service_slug === s)!.apt, `${s} igual`);
  }
  for (const s of extra) {
    assert.equal(Number(after.find((r) => r.service_slug === s)!.apt), Number(before.find((r) => r.service_slug === s)!.apt) + 1, `${s} +1`);
  }
  assert.equal(await aptTotal(adm), totalBefore, 'total de prestadores não muda');
  // lista aberta pelo número da linha
  const rows = (await adm.rpc('admin_providers', { p_city_slug: 'campo-grande-ms', p_launch: 'apto', p_service_slug: 'caca-vazamentos' })).data as { slug: string }[];
  assert.ok(rows.some((r) => r.slug === 'carlos-demo'));
  await admin.from('provider_services').delete().eq('provider_id', carlos).in('service_id', ids);
});

test('cobertura: pausa, suspensão e verificação pendente ficam fora da oferta apta', async () => {
  const adm = await signIn('admin');
  const cov = await coverage(adm);
  // Paulo (pausado) e Sérgio (suspenso) não contam; Joana (pendência) e Bia (em análise) entram em "Em análise".
  assert.equal(Number(cov.find((r) => r.service_slug === 'chaveiro')!.apt), 0);
  assert.equal(Number(cov.find((r) => r.service_slug === 'chaveiro')!.analysis), 1);
  assert.equal(Number(cov.find((r) => r.service_slug === 'diarista')!.analysis), 1);
  const base = await aptTotal(adm);
  const carlos = await signIn('prestador-carlos');
  assert.equal((await carlos.rpc('set_my_profile_status', { p_status: 'paused' })).error, null);
  assert.equal(await aptTotal(adm), base - 1, 'pausar tira da contagem');
  await carlos.rpc('set_my_profile_status', { p_status: 'published' });
  assert.equal(await aptTotal(adm), base);
  // crédito: conta como pronto mesmo com a categoria desligada (o painel mostra o que pode ser habilitado)
  const fin = cov.find((r) => r.service_slug === 'financiamento-imobiliario')!;
  assert.equal(fin.category_active, false);
  assert.equal(Number(fin.apt), 1);
  // só administrador consulta
  assert.ok((await (await signIn('cliente')).rpc('admin_launch_coverage', {})).error);
  assert.ok((await anon().rpc('admin_launch_coverage', {})).error);
});

test('referências e dados privados: só o dono e a equipe; nota interna só a equipe', async () => {
  const cliente = await signIn('cliente');
  const bia = await signIn('prestador-bia');
  const carlosId = await profileId('carlos-demo');
  assert.equal(((await cliente.from('provider_references').select('id').eq('provider_id', carlosId)).data ?? []).length, 0, 'outra conta não vê');
  assert.equal(((await cliente.from('provider_verification').select('provider_id').eq('provider_id', carlosId)).data ?? []).length, 0);
  assert.ok((await anon().from('provider_references').select('id')).error, 'visitante não lê');
  assert.equal(((await bia.from('provider_references').select('id').eq('provider_id', carlosId)).data ?? []).length, 0, 'outro prestador não vê');
  const mine = await bia.from('provider_references').select('id, name, contact, result').eq('provider_id', await uid(bia));
  assert.equal(mine.data?.length, 3, 'dono vê as próprias');
  assert.ok((await bia.from('provider_references').select('internal_note')).error, 'nota interna é só da equipe');
  assert.ok((await bia.from('provider_references').update({ result: 'confirmada' }).eq('provider_id', await uid(bia))).error, 'dono não confirma a própria referência');
  assert.ok((await bia.from('provider_verification').update({ status: 'aprovado' }).eq('provider_id', await uid(bia))).error, 'dono não se aprova');
  assert.ok((await cliente.rpc('admin_verification_detail', { p_provider: carlosId })).error, 'detalhe restrito');
  const det = (await (await signIn('admin')).rpc('admin_verification_detail', { p_provider: carlosId })).data as { references: { contact: string }[] };
  assert.equal(det.references.length, 3);
  // medição não tem leitura nem escrita pública
  assert.ok((await anon().from('usage_events').insert({ kind: 'busca' })).error);
  assert.ok((await cliente.from('usage_events').select('id')).error);
});

test('verificação: envio exige dados, aprovação exige identidade, WhatsApp e uma referência; mudanças pedem nova conferência', async () => {
  const marcos = await signIn('prestador-marcos');
  const me = await uid(marcos);
  const adm = await signIn('admin');
  const base = { p_legal_name: 'Marcos Exemplo da Silva', p_is_company: false, p_company_name: null, p_responsible_name: null, p_experience_years: 4,
    p_refs_consent: true, p_privacy_ack: true, p_channel: null };
  const ref = { position: 1, name: 'Cliente Um', contact: '67999990001', service: 'Troca de torneira', period: '2025' };
  let r = await marcos.rpc('save_my_verification', { ...base, p_refs: [], p_submit: true });
  assert.match(r.error?.message ?? '', /referência/, 'sem referência não envia');
  r = await marcos.rpc('save_my_verification', { ...base, p_refs: [ref], p_refs_consent: false, p_submit: true });
  assert.match(r.error?.message ?? '', /avisou/);
  r = await marcos.rpc('save_my_verification', { ...base, p_refs: [{ ...ref, contact: '12' }], p_submit: true });
  assert.match(r.error?.message ?? '', /WhatsApp/);
  r = await marcos.rpc('save_my_verification', { ...base, p_refs: [ref], p_submit: true });
  assert.equal(r.error, null);
  assert.equal(r.data, 'em_analise');

  assert.match((await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'aprovar' })).error?.message ?? '', /Para aprovar/);
  assert.match((await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'pendencia' })).error?.message ?? '', /Explique/);
  const refId = ((await adm.rpc('admin_verification_detail', { p_provider: me })).data as { references: { id: number }[] }).references[0].id;
  await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'identidade_ok' });
  await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'contato_ok' });
  await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'referencia_confirmada', p_ref: refId, p_note: 'confirmou' });
  const ok = await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'aprovar' });
  assert.equal(ok.error, null);
  assert.equal(ok.data, 'aprovado');
  const badges = (await (await viewer()).rpc('provider_badges', { p_ids: [me] })).data as { identity_checked: boolean; refs_confirmed: number; experience_years: number }[];
  assert.deepEqual([badges[0].identity_checked, badges[0].refs_confirmed, badges[0].experience_years], [true, 1, 4]);
  // histórico registra a ação sem contatos
  const log = (await admin.from('moderation_log').select('action, note').eq('target_id', me).order('id')).data!;
  assert.ok(log.some((l) => l.action === 'verificacao_aprovar'));
  assert.ok(!log.some((l) => (l.note ?? '').includes('67999990001')));

  // alterar a referência confirmada volta para "a conferir" e o cadastro para análise
  r = await marcos.rpc('save_my_verification', { ...base, p_refs: [{ ...ref, contact: '67999990002' }], p_submit: false });
  assert.equal(r.data, 'em_analise');
  assert.equal((await marcos.from('provider_references').select('result').eq('provider_id', me).single()).data!.result, 'a_conferir');
  await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'referencia_confirmada', p_ref: refId });
  assert.equal((await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'aprovar' })).data, 'aprovado');
  // trocar o WhatsApp exige nova conferência do contato
  assert.equal((await marcos.from('provider_private').update({ whatsapp: '67988887777' }).eq('provider_id', me)).error, null);
  const v = (await marcos.from('provider_verification').select('status, contact_checked_at').eq('provider_id', me).single()).data!;
  assert.equal(v.status, 'em_analise');
  assert.equal(v.contact_checked_at, null);
  // pendência mostra o motivo ao prestador
  await adm.rpc('admin_verification_action', { p_provider: me, p_action: 'pendencia', p_note: 'Confirme o novo WhatsApp.' });
  assert.equal((await marcos.from('provider_verification').select('pending_reason').eq('provider_id', me).single()).data!.pending_reason, 'Confirme o novo WhatsApp.');
});

test('regra do piloto ligada: só aprovados aparecem na busca, no feed e recebem contato', async () => {
  const biaId = await profileId('bia-demo');
  const carlosId = await profileId('carlos-demo');
  assert.ok((await search(await viewer(), { p_service_slug: 'diarista' })).some((r) => r.slug === 'bia-demo'), 'regra desligada: todos os publicados');
  await setRule(true);
  try {
    assert.ok(!(await search(await viewer(), { p_service_slug: 'diarista' })).some((r) => r.slug === 'bia-demo'), 'em análise sai da busca');
    assert.ok((await search(await viewer(), { p_service_slug: 'encanador' })).some((r) => r.slug === 'carlos-demo'), 'aprovado continua');
    assert.equal(((await admin.rpc('contact_target_general', { p_provider: biaId })).data ?? []).length, 0, 'sem contato');
    assert.equal(((await admin.rpc('contact_target_general', { p_provider: carlosId })).data ?? []).length, 1);
    const feed = ((await (await viewer()).rpc('feed_posts', { p_city_slug: 'campo-grande-ms' })).data ?? []) as { display_name: string }[];
    assert.ok(!feed.some((p) => p.display_name === 'Bia Faxina (demo)'), 'post de quem não foi aprovado sai do feed');
    assert.ok(feed.some((p) => p.display_name === 'Carlos Hidráulica (demo)'));
    assert.equal(((await (await viewer()).from('provider_profiles').select('id').eq('slug', 'bia-demo')).data ?? []).length, 0, 'perfil público fechado');
    const bia = await signIn('prestador-bia');
    assert.equal(((await bia.from('provider_profiles').select('id').eq('id', biaId)).data ?? []).length, 1, 'dono continua vendo');
  } finally {
    await setRule(false);
  }
  assert.ok((await search(await viewer(), { p_service_slug: 'diarista' })).some((r) => r.slug === 'bia-demo'), 'nada foi apagado');
});

test('crédito imobiliário: oculto até a aprovação; depois aparece com canal oficial conferido', async () => {
  const anaId = await profileId('ana-demo');
  assert.equal((await search(await viewer(), { p_q: 'financiamento' })).length, 0, 'categoria desligada não aparece na busca');
  assert.ok(!(await search(await viewer(), {})).some((r) => r.slug === 'ana-demo'), 'perfil só de crédito fica fora');
  assert.equal(((await (await viewer()).rpc('provider_public_channel', { p_provider: anaId })).data ?? []).length, 0);
  const svcs = (await admin.from('services').select('slug, urgent_pilot').in('slug', ['financiamento-imobiliario', 'emprestimo-com-garantia-de-imovel'])).data!;
  assert.equal(svcs.length, 2);
  assert.ok(svcs.every((s) => !s.urgent_pilot), 'fora do Preciso para hoje');
  await admin.from('services').update({ urgent_pilot: true }).eq('slug', 'financiamento-imobiliario');
  assert.equal((await admin.from('services').select('urgent_pilot').eq('slug', 'financiamento-imobiliario').single()).data!.urgent_pilot, false, 'não entra nem forçando');
  await setCredit(true);
  try {
    const found = await search(await viewer(), { p_service_slug: 'financiamento-imobiliario' });
    assert.deepEqual(found.map((r) => r.slug), ['ana-demo']);
    const ch = ((await (await viewer()).rpc('provider_public_channel', { p_provider: anaId })).data ?? []) as { official_url: string; linked_institution: string }[];
    assert.equal(ch[0].official_url, 'https://www.bcb.gov.br/meubc/encontreinstituicao');
    assert.equal(ch[0].linked_institution, 'Banco Exemplo S.A. (demo)');
    // canal desfeito: o serviço some de novo
    const adm = await signIn('admin');
    await adm.rpc('admin_verification_action', { p_provider: anaId, p_action: 'canal_desfazer' });
    assert.equal((await search(await viewer(), { p_service_slug: 'financiamento-imobiliario' })).length, 0);
    await adm.rpc('admin_verification_action', { p_provider: anaId, p_action: 'canal_ok' });
  } finally {
    await setCredit(false);
  }
});

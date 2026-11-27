import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { admin, anon, ids, profileId, signIn, urgentContact, APP, viewer } from './helpers.ts';

before(async () => {
  // Recria os dados fictícios para cada execução (disponibilidades vigentes etc.)
  execSync('npm run -s seed:demo', { stdio: 'ignore' });
  await admin.from('rate_events').delete().gte('id', 0);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users.filter((x) => x.email?.endsWith('@teste.resolveaqui.test'))) await admin.auth.admin.deleteUser(u.id);
});

test('quem tem conta só enxerga perfis publicados (pausado/suspenso ficam de fora)', async () => {
  const { data } = await (await viewer()).from('provider_profiles').select('slug, status');
  const statuses = new Set(data!.map((p) => p.status));
  assert.deepEqual([...statuses], ['published']);
  assert.ok(!data!.some((p) => p.slug === 'paulo-demo' || p.slug === 'sergio-demo'));
  const { data: search } = await (await viewer()).rpc('search_providers', { p_q: 'encanador' });
  assert.ok(!search!.some((p: { slug: string }) => ['paulo-demo', 'sergio-demo'].includes(p.slug)));
});

test('dados privados: visitante e outro prestador não leem telefone/CPF/endereço', async () => {
  const v = await anon().from('provider_private').select('*');
  assert.ok(v.error || v.data!.length === 0, 'anon não pode ler provider_private');
  const carlos = await signIn('prestador-carlos');
  const { data } = await carlos.from('provider_private').select('provider_id');
  assert.equal(data!.length, 1, 'só o próprio registro');
  assert.equal(data![0].provider_id, await profileId('carlos'));
  // telefone fora da busca/perfil público
  const { data: pub } = await (await viewer()).from('provider_profiles').select('*').limit(1);
  assert.ok(!('phone' in pub![0]) && !('whatsapp' in pub![0]));
  // funções que devolvem o número: só service_role
  const r = await anon().rpc('contact_target_general', { p_provider: await profileId('carlos') });
  assert.equal(r.error?.code, '42501');
  const r2 = await carlos.rpc('contact_target_urgent', { p_provider: await profileId('carlos'), p_service_id: 1, p_neighborhood_id: 1 });
  assert.equal(r2.error?.code, '42501');
});

test('cada prestador só edita o próprio perfil', async () => {
  const carlos = await signIn('prestador-carlos');
  const joanaId = await profileId('joana');
  const upd = await carlos.from('provider_profiles').update({ display_name: 'Hackeado' }).eq('id', joanaId).select();
  assert.equal(upd.data?.length ?? 0, 0);
  const ins = await carlos.from('provider_services').insert({ provider_id: joanaId, service_id: 1 });
  assert.ok(ins.error, 'não insere serviço no perfil de outro');
  const del = await carlos.from('provider_areas').delete().eq('provider_id', joanaId).select();
  assert.equal(del.data?.length ?? 0, 0);
  const { data: still } = await admin.from('provider_profiles').select('display_name').eq('id', joanaId).single();
  assert.equal(still!.display_name, 'Joana Chaves (demo)');
  // o próprio perfil pode ser editado
  const own = await carlos.from('provider_profiles').update({ bio: 'Atualizado no teste' }).eq('id', await profileId('carlos')).select('bio');
  assert.equal(own.data?.[0]?.bio, 'Atualizado no teste');
});

test('prestador não muda o próprio estado para suspenso/publicado direto nem cria disponibilidade direta', async () => {
  const carlos = await signIn('prestador-carlos');
  const id = await profileId('carlos');
  const r = await carlos.from('provider_profiles').update({ status: 'suspended' }).eq('id', id);
  assert.ok(r.error, 'coluna status não é editável');
  const a = await carlos.from('availability_today').insert({ provider_id: id, city_id: 1, service_ids: [1], expires_at: '2099-01-01' });
  assert.ok(a.error);
  // suspenso não consegue se reativar
  const sergio = await signIn('prestador-sergio');
  const s = await sergio.rpc('set_my_profile_status', { p_status: 'published' });
  assert.match(s.error?.message ?? '', /suspenso/i);
});

test('função de administrador definida só pelo servidor', async () => {
  const c = await signIn('cliente');
  const { data: { user } } = await c.auth.getUser();
  const r = await c.from('user_roles').insert({ user_id: user!.id, role: 'admin' });
  assert.ok(r.error);
  const s = await c.rpc('admin_set_provider_status', { p_provider: await profileId('carlos'), p_status: 'suspended', p_note: 'x' });
  assert.match(s.error?.message ?? '', /administradores/);
  const cat = await c.from('services').update({ active: false }).eq('slug', 'encanador').select();
  assert.equal(cat.data?.length ?? 0, 0);
});

test('expiração à meia-noite de America/Campo_Grande', async () => {
  const cases: [string, string][] = [
    ['2026-11-25T23:59:00-04:00', '2026-11-26T04:00:00+00:00'],
    ['2026-11-26T00:01:00-04:00', '2026-11-27T04:00:00+00:00'],
    ['2026-11-25T10:00:00Z', '2026-11-26T04:00:00+00:00'],
  ];
  for (const [at, exp] of cases) {
    const { data } = await admin.rpc('availability_expiry', { p_timezone: 'America/Campo_Grande', p_at: at });
    assert.equal(new Date(data).toISOString(), new Date(exp).toISOString(), at);
  }
});

test('Atendo hoje: padrão, restrição e validação no servidor', async () => {
  const { svc, nb } = await ids();
  const joana = await signIn('prestador-joana');
  const def = await joana.rpc('set_available_today', {});
  assert.ifError(def.error);
  assert.deepEqual(def.data.service_ids, [svc('chaveiro')]);
  assert.deepEqual([...def.data.neighborhood_ids].sort(), [nb('centro'), nb('tiradentes'), nb('universitario')].sort());
  const exp = new Date(def.data.expires_at);
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Campo_Grande', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(exp);
  assert.equal(local, '00:00', 'expira à meia-noite local');
  const restricted = await joana.rpc('set_available_today', { p_neighborhood_ids: [nb('tiradentes')] });
  assert.deepEqual(restricted.data.neighborhood_ids, [nb('tiradentes')]);
  const outside = await joana.rpc('set_available_today', { p_neighborhood_ids: [nb('aero-rancho')] });
  assert.match(outside.error?.message ?? '', /fora da sua área/);
  const otherSvc = await joana.rpc('set_available_today', { p_service_ids: [svc('encanador')] });
  assert.match(otherSvc.error?.message ?? '', /fora do seu perfil/);
  const paulo = await signIn('prestador-paulo');
  const paused = await paulo.rpc('set_available_today', {});
  assert.match(paused.error?.message ?? '', /Publique/);
});

test('busca urgente: bairro opcional, cidade inteira, fora do bairro e serviço fora do "Preciso para hoje"', async () => {
  const { nb } = await ids();
  const slugs = async (svc: string, b: string | null) => ((await (await viewer()).rpc('urgent_search', { p_service_slug: svc, p_neighborhood_id: b ? nb(b) : null })).data ?? []).map((r: { slug: string }) => r.slug).sort();
  assert.deepEqual(await slugs('encanador', 'centro'), ['carlos-demo', 'hidro-demo']);
  assert.deepEqual(await slugs('encanador', 'caranda-bosque'), ['hidro-demo', 'marcos-demo'], 'Marcos só no Carandá Bosque; Hidro na cidade toda');
  assert.deepEqual(await slugs('encanador', 'carlota'), ['hidro-demo'], 'Carlos atende Carlota, mas hoje só Centro/Amambaí');
  // Todos os bairros: cidade inteira + quem confirmou bairros (área do dia)
  assert.deepEqual(await slugs('encanador', null), ['carlos-demo', 'hidro-demo', 'marcos-demo'], 'sem bairro = toda Campo Grande');
  assert.ok(!(await slugs('encanador', null)).includes('paulo-demo'), 'pausado fora');
  assert.ok((await slugs('eletricista', 'universitario')).includes('pantanal-demo'), 'cidade inteira aparece em qualquer bairro');
  assert.ok(!(await slugs('eletricista', 'universitario')).includes('sergio-demo'), 'suspenso fora');
  assert.deepEqual(await slugs('diarista', 'centro'), ['bia-demo'], 'serviço presencial entra no Preciso para hoje');
  // administrador pode tirar um serviço do "Preciso para hoje"
  await admin.from('services').update({ urgent_pilot: false }).eq('slug', 'diarista');
  try { assert.deepEqual(await slugs('diarista', 'centro'), [], 'fora do Preciso para hoje'); }
  finally { await admin.from('services').update({ urgent_pilot: true }).eq('slug', 'diarista'); }
  const { data: online } = await admin.from('services').update({ urgent_pilot: true }).eq('slug', 'tradutor').select('urgent_pilot').single();
  assert.equal(online!.urgent_pilot, false, 'serviço só online nunca entra');
  assert.deepEqual(await slugs('tecnico-de-ar-condicionado', 'centro'), [], 'sem disponibilidade');
});

test('busca geral: bairro x área declarada, cidade inteira, sinônimos e sem acento', async () => {
  const s = async (args: object) => ((await (await viewer()).rpc('search_providers', args)).data ?? []).map((r: { slug: string }) => r.slug);
  assert.deepEqual(await s({ p_service_slug: 'piscineiro', p_city_slug: 'campo-grande-ms', p_neighborhood_slug: 'caranda-bosque' }), ['rafa-demo']);
  assert.ok((await s({ p_service_slug: 'eletricista', p_city_slug: 'campo-grande-ms', p_neighborhood_slug: 'nova-lima' })).includes('pantanal-demo'));
  assert.deepEqual((await s({ p_q: 'vazamento' })).sort(), ['carlos-demo', 'hidro-demo', 'marcos-demo']);
  assert.deepEqual(await s({ p_q: 'limpar piscina' }), ['rafa-demo']);
  assert.deepEqual(await s({ p_q: 'formatar computador' }), ['leo-demo']);
  assert.deepEqual(await s({ p_q: 'T.I.' }), ['leo-demo']);
  assert.deepEqual(await s({ p_q: 'tecnico de ti' }), ['leo-demo']);
  assert.deepEqual(await s({ p_q: 'eletrica pantanal' }), ['pantanal-demo'], 'nome sem acento');
  assert.deepEqual(await s({ p_online: true }), ['leo-demo']);
  // exemplos pedidos: cidade inteira x bairro
  const enc = async (b?: string) => (await s({ p_service_slug: 'encanador', p_city_slug: 'campo-grande-ms', p_neighborhood_slug: b ?? null })).sort();
  assert.deepEqual(await enc(), ['carlos-demo', 'hidro-demo', 'marcos-demo'], 'Todos os bairros');
  assert.deepEqual(await enc('caranda-bosque'), ['hidro-demo', 'marcos-demo'], 'Carandá Bosque: cidade inteira + bairro');
  assert.deepEqual(await enc('centro'), ['carlos-demo', 'hidro-demo'], 'Centro: Marcos (só Carandá Bosque) fica fora');
  // perfil antigo só com endereço (sem área escolhida) não aparece
  assert.ok(!(await s({ p_q: 'pedreiro' })).includes('ze-demo'), 'sem área confirmada fica fora da busca');
  // categoria
  assert.deepEqual((await s({ p_category_slug: 'hidraulica-e-manutencao' })).sort(), ['carlos-demo', 'hidro-demo', 'marcos-demo']);
  const today = await s({ p_today: true, p_city_slug: 'campo-grande-ms', p_neighborhood_slug: 'centro' });
  assert.ok(today.includes('bia-demo') && today.includes('carlos-demo') && today.includes('pantanal-demo') && !today.includes('rafa-demo'));
});

test('contato urgente (API): válido, desativado, vencido, fora do bairro, fora do piloto', async () => {
  const { svc, nb } = await ids();
  const carlos = await profileId('carlos');
  assert.equal((await urgentContact({ providerId: carlos, serviceId: svc('encanador'), neighborhoodId: nb('centro') }, undefined, null)).status, 401, 'sem conta não chama');
  const ok = await urgentContact({ providerId: carlos, serviceId: svc('encanador'), neighborhoodId: nb('centro') });
  assert.equal(ok.status, 200);
  const u = new URL(ok.body.url);
  assert.equal(u.hostname, 'wa.me');
  assert.equal(u.searchParams.get('text'), 'Olá! Encontrei seu perfil no Próximo. Preciso de encanador hoje no bairro Centro, em Campo Grande. Qual horário você consegue atender?');
  assert.equal((await urgentContact({ providerId: carlos, serviceId: svc('encanador'), neighborhoodId: nb('aero-rancho') })).status, 409, 'fora do bairro');
  // sem bairro: mensagem diz só a cidade
  const noNb = await urgentContact({ providerId: await profileId('marcos'), serviceId: svc('encanador'), neighborhoodId: null });
  assert.equal(noNb.status, 200, 'Todos os bairros');
  assert.equal(new URL(noNb.body.url).searchParams.get('text'), 'Olá! Encontrei seu perfil no Próximo. Preciso de encanador hoje em Campo Grande. Qual horário você consegue atender?');
  assert.equal((await urgentContact({ providerId: await profileId('marcos'), serviceId: svc('encanador'), neighborhoodId: nb('centro') })).status, 409, 'Marcos não atende o Centro');
  const bia = await profileId('bia');
  await admin.from('services').update({ urgent_pilot: false }).eq('slug', 'diarista');
  try { assert.equal((await urgentContact({ providerId: bia, serviceId: svc('diarista'), neighborhoodId: nb('centro') })).status, 409, 'fora do Preciso para hoje'); }
  finally { await admin.from('services').update({ urgent_pilot: true }).eq('slug', 'diarista'); }
  const paulo = await profileId('paulo');
  assert.equal((await urgentContact({ providerId: paulo, serviceId: svc('encanador'), neighborhoodId: nb('centro') })).status, 409, 'pausado');

  // vencido: expiração no passado
  await admin.from('availability_today').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('provider_id', carlos);
  assert.equal((await urgentContact({ providerId: carlos, serviceId: svc('encanador'), neighborhoodId: nb('centro') })).status, 409, 'vencido');
  const { data: list } = await (await viewer()).rpc('urgent_search', { p_service_slug: 'encanador', p_neighborhood_id: nb('centro') });
  assert.ok(!list!.some((r: { slug: string }) => r.slug === 'carlos-demo'), 'vencido some da lista');

  // desativação manual pelo prestador
  const joanaC = await signIn('prestador-joana');
  const joana = await profileId('joana');
  await joanaC.rpc('set_available_today', {});
  assert.equal((await urgentContact({ providerId: joana, serviceId: svc('chaveiro'), neighborhoodId: nb('tiradentes') })).status, 200);
  await joanaC.rpc('clear_available_today');
  assert.equal((await urgentContact({ providerId: joana, serviceId: svc('chaveiro'), neighborhoodId: nb('tiradentes') })).status, 409, 'desativado');

  // pausar o perfil remove a disponibilidade
  const pantanalC = await signIn('prestador-pantanal');
  await pantanalC.rpc('set_my_profile_status', { p_status: 'paused' });
  const { data: av } = await admin.from('availability_today').select('*').eq('provider_id', await profileId('pantanal'));
  assert.equal(av!.length, 0);
  await pantanalC.rpc('set_my_profile_status', { p_status: 'published' });
});

test('contato urgente tem limite de frequência', async () => {
  const { svc, nb } = await ids();
  const body = { providerId: await profileId('marcos'), serviceId: svc('encanador'), neighborhoodId: nb('caranda-bosque') };
  const statuses: number[] = [];
  for (let i = 0; i < 22; i++) statuses.push((await urgentContact(body, '10.9.9.9')).status);
  assert.equal(statuses.filter((s) => s === 200).length, 20);
  assert.equal(statuses.at(-1), 429);
});

test('contato da busca geral exige login', async () => {
  const res = await fetch(`${APP}/api/contact/general`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: await profileId('rafa'), message: 'Olá, teste' }),
  });
  assert.equal(res.status, 401);
});

test('denúncia: autenticada, sem duplicar', async () => {
  const c = await signIn('cliente');
  const { data: { user } } = await c.auth.getUser();
  const rafa = await profileId('rafa');
  const r1 = await c.from('reports').insert({ reporter_id: user!.id, provider_id: rafa, reason: 'outro', details: 'teste automatizado' });
  assert.ifError(r1.error);
  const r2 = await c.from('reports').insert({ reporter_id: user!.id, provider_id: rafa, reason: 'outro', details: 'de novo' });
  assert.equal(r2.error?.code, '23505');
  const v = await anon().from('reports').insert({ provider_id: rafa, reason: 'outro' });
  assert.ok(v.error, 'visitante não denuncia');
});

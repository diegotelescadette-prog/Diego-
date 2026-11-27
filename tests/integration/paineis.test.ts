import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { admin, anon, ids, profileId, signIn, viewer } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

type Row = { slug: string; total_count: number };
const total = (d: unknown) => Number((d as Row[] | null)?.[0]?.total_count ?? 0);

test('admin: usuários comuns e visitantes recebem acesso restrito nas funções administrativas', async () => {
  const pro = await signIn('prestador-carlos');
  for (const c of [pro, anon()]) {
    const r1 = await c.rpc('admin_providers', {});
    assert.ok(r1.error, 'admin_providers deveria recusar');
    const r2 = await c.rpc('admin_category_coverage', {});
    assert.ok(r2.error);
    const r3 = await c.rpc('admin_moderation_log', {});
    assert.ok(r3.error);
  }
  const { error } = await pro.rpc('admin_providers', {});
  assert.match(error!.message, /Apenas administradores|permission denied/);
});

test('admin: cada indicador bate com a lista que ele abre, por cidade', async () => {
  const a = await signIn('admin');
  const cg = 'campo-grande-ms';
  const list = async (f: Record<string, unknown>) => {
    const { data, error } = await a.rpc('admin_providers', { p_city_slug: cg, p_limit: 200, ...f });
    assert.equal(error, null);
    return data as Row[];
  };
  const pub = await list({ p_status: 'published' });
  assert.equal(total(pub), pub.length);
  for (const s of ['carlos-demo', 'hidro-demo', 'ze-demo']) assert.ok(pub.some((r) => r.slug === s), s);
  for (const s of ['paulo-demo', 'sergio-demo']) assert.ok(!pub.some((r) => r.slug === s), s);

  const today = (await list({ p_today: true })).map((r) => r.slug).sort();
  assert.deepEqual(today, ['bia-demo', 'carlos-demo', 'hidro-demo', 'joana-demo', 'marcos-demo', 'pantanal-demo']);
  assert.equal(total((await a.rpc('admin_providers', { p_city_slug: cg, p_today: true, p_limit: 1 })).data), today.length);

  const pend = (await list({ p_area_pending: true })).map((r) => r.slug);
  assert.deepEqual(pend, ['ze-demo']);

  // cidade inexistente: zero (não "todas")
  assert.equal(total((await a.rpc('admin_providers', { p_city_slug: 'cidade-que-nao-existe' })).data), 0);
  // todas as cidades inclui pelo menos os de Campo Grande
  assert.ok(total((await a.rpc('admin_providers', { p_status: 'published', p_limit: 1 })).data) >= pub.length);
});

test('admin: cobertura por categoria conta cada profissional uma vez e bate com a lista filtrada', async () => {
  const a = await signIn('admin');
  const { data, error } = await a.rpc('admin_category_coverage', { p_city_slug: 'campo-grande-ms' });
  assert.equal(error, null);
  const hid = (data as { slug: string; published: number; available_today: number }[]).find((r) => r.slug === 'hidraulica-e-manutencao')!;
  // Carlos oferece encanador e desentupidor (mesma categoria) e conta uma vez.
  const listPub = await a.rpc('admin_providers', { p_city_slug: 'campo-grande-ms', p_status: 'published', p_category_slug: 'hidraulica-e-manutencao', p_limit: 200 });
  const slugs = (listPub.data as Row[]).map((r) => r.slug);
  assert.equal(Number(hid.published), slugs.length);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.includes('carlos-demo'));
  const listToday = await a.rpc('admin_providers', { p_city_slug: 'campo-grande-ms', p_today: true, p_category_slug: 'hidraulica-e-manutencao', p_limit: 200 });
  assert.equal(Number(hid.available_today), (listToday.data as Row[]).length);
  // categoria sem ninguém mostra zero
  const pets = (data as { slug: string; published: number }[]).find((r) => r.slug === 'pets')!;
  assert.equal(Number(pets.published), 0);
});

test('mudança na área habitual revalida o "Atendo hoje": ajusta e depois remove', async () => {
  const { nb } = await ids();
  const id = await profileId('carlos');
  const c = await signIn('prestador-carlos');
  // Carlos: área Centro, Amambaí, Carlota; hoje Centro e Amambaí. Tira Amambaí da área habitual.
  await c.from('provider_areas').delete().eq('provider_id', id).eq('neighborhood_id', nb('amambai'));
  const r1 = await c.rpc('revalidate_my_available_today');
  assert.equal(r1.data, 'ajustada');
  const { data: a1 } = await admin.from('availability_today').select('neighborhood_ids').eq('provider_id', id).single();
  assert.deepEqual(a1!.neighborhood_ids, [nb('centro')]);
  assert.equal((await c.rpc('revalidate_my_available_today')).data, 'mantida');
  // Tira o Centro: nada do dia continua na área → desativa
  await c.from('provider_areas').delete().eq('provider_id', id).eq('neighborhood_id', nb('centro'));
  assert.equal((await c.rpc('revalidate_my_available_today')).data, 'removida');
  const { data: a2 } = await admin.from('availability_today').select('provider_id').eq('provider_id', id).maybeSingle();
  assert.equal(a2, null);
});

test('"Preciso para hoje" pela cidade inteira exige cobertura confirmada; bairro e serviço fora dos quatro iniciais', async () => {
  const sb = await viewer();
  const names = async (svc: string, nbId: number | null) =>
    ((await sb.rpc('urgent_search', { p_service_slug: svc, p_neighborhood_id: nbId })).data as { slug: string }[]).map((r) => r.slug);
  const { nb } = await ids();
  const all = await names('encanador', null);
  assert.ok(all.includes('hidro-demo') && all.includes('marcos-demo'), 'cidade inteira inclui os dois tipos de cobertura');
  const centro = await names('encanador', nb('centro'));
  assert.ok(centro.includes('hidro-demo'));
  assert.ok(!centro.includes('marcos-demo'), 'Marcos atende só o Carandá Bosque');
  assert.ok((await names('diarista', nb('centro'))).includes('bia-demo'), 'serviço presencial fora dos quatro iniciais');

  // Marcos perde a área (cadastro antigo): some da busca da cidade inteira mesmo com disponibilidade gravada.
  const marcos = await profileId('marcos');
  await admin.from('provider_areas').delete().eq('provider_id', marcos);
  assert.ok(!(await names('encanador', null)).includes('marcos-demo'));
});

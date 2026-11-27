import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { admin, anon, APP, appCookie, ids, signIn, DOMAIN, PASSWORD } from './helpers.ts';

const created: string[] = [];
after(async () => { for (const id of created) await admin.auth.admin.deleteUser(id); });

async function freshAccount(tag: string) {
  const email = `${tag}-${Date.now()}@${DOMAIN}`;
  const { data } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  created.push(data.user!.id);
  const c = anon();
  await c.auth.signInWithPassword({ email, password: PASSWORD });
  return { c, id: data.user!.id, email };
}

test('visitante sem conta não lê o conteúdo do app; catálogo, cidades e bairros continuam abertos', async () => {
  const v = anon();
  for (const t of ['posts', 'post_media', 'post_comments', 'post_reactions', 'stories', 'jobs', 'provider_profiles', 'provider_services', 'provider_work_photos', 'availability_today', 'provider_follows']) {
    const r = await v.from(t).select('*').limit(1);
    assert.ok(r.error || (r.data ?? []).length === 0, `visitante leu ${t}`);
  }
  for (const [fn, args] of [['feed_posts', { p_city_slug: 'campo-grande-ms' }], ['search_providers', { p_q: 'encanador' }], ['urgent_search', { p_service_slug: 'encanador', p_neighborhood_id: null }], ['stories_feed', {}]] as const) {
    assert.ok((await v.rpc(fn, args)).error, `visitante chamou ${fn}`);
  }
  assert.ok(((await v.from('services').select('id').limit(1)).data ?? []).length === 1);
  assert.ok(((await v.from('neighborhoods').select('id').limit(1)).data ?? []).length === 1);
});

test('cadastro: dados só da própria pessoa e da equipe; ninguém grava pelo outro; celular com +55 e ofensa no nome', async () => {
  const { nb } = await ids();
  const { c, id } = await freshAccount('cadastro');
  assert.equal(((await c.from('member_accounts').select('user_id')).data ?? []).length, 0, 'conta nova sem cadastro');
  assert.ok((await c.rpc('save_signup', { p_user: id, p_full_name: 'Fulano de Tal', p_public_name: 'Fulano', p_phone: '67999990000', p_neighborhood: nb('centro'), p_terms: true, p_goal: null })).error, 'só o servidor grava direto');
  const semAceite = await c.rpc('complete_signup', { p_full_name: 'Fulano de Tal', p_public_name: 'Fulano', p_phone: '67999990000', p_neighborhood: nb('centro'), p_terms: false });
  assert.match(semAceite.error!.message, /aceitar/);
  assert.match((await c.rpc('complete_signup', { p_full_name: 'Fulano de Tal', p_public_name: 'Fulano', p_phone: '123', p_neighborhood: nb('centro'), p_terms: true })).error!.message, /celular/);
  assert.match((await c.rpc('complete_signup', { p_full_name: 'Fulano Otário', p_public_name: 'Fulano', p_phone: '67999990000', p_neighborhood: nb('centro'), p_terms: true })).error!.message, /carinho/);
  assert.equal((await c.rpc('complete_signup', { p_full_name: 'Fulano de Tal', p_public_name: 'Fulano do Centro', p_phone: '+55 (67) 99999-0000', p_neighborhood: nb('centro'), p_terms: true })).error, null);
  const { data: mine } = await c.from('member_accounts').select('phone, terms_accepted_at, privacy_accepted_at, phone_verified_at').single();
  assert.equal(mine!.phone, '67999990000');
  assert.ok(mine!.terms_accepted_at && mine!.privacy_accepted_at);
  assert.equal(mine!.phone_verified_at, null, 'confirmação do celular fica para a fase 7');
  assert.equal((await c.from('member_names').select('name').single()).data!.name, 'Fulano do Centro');
  const outro = await signIn('cliente');
  assert.equal(((await outro.from('member_accounts').select('phone').eq('user_id', id)).data ?? []).length, 0, 'outra conta não vê o celular');
  const adm = await signIn('admin');
  assert.equal(((await adm.from('member_accounts').select('phone').eq('user_id', id)).data ?? []).length, 1, 'a equipe vê');
  assert.equal((await c.rpc('set_first_goal', { p_goal: 'emprego' })).error, null);
  assert.ok((await c.rpc('set_first_goal', { p_goal: 'qualquer' })).error);
});

test('rotas: visitante vai para o login com o link de volta; conta antiga completa o cadastro antes de seguir', async () => {
  const r = await fetch(`${APP}/p/carlos-demo?x=1`, { redirect: 'manual' });
  const to = (res: Response) => { const u = new URL(res.headers.get('location')!, APP); return u.pathname + u.search; };
  assert.equal(r.status, 307);
  assert.equal(to(r), '/entrar?next=%2Fp%2Fcarlos-demo%3Fx%3D1');
  for (const p of ['/', '/entrar', '/cadastrar', '/privacidade', '/termos', '/recuperar-senha']) {
    assert.equal((await fetch(`${APP}${p}`, { redirect: 'manual' })).status, 200, p);
  }
  assert.equal((await fetch(`${APP}/api/contact/general`, { method: 'POST', redirect: 'manual' })).status, 401);
  // conta com cadastro completo segue direto
  assert.equal((await fetch(`${APP}/vagas`, { redirect: 'manual', headers: { cookie: await appCookie('cliente') } })).status, 200);
  // conta antiga (sem os dados do cadastro) completa antes, e volta para onde ia
  const { data: u } = await admin.from('member_accounts').select('*').eq('user_id', (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((x) => x.email === `leitor@${DOMAIN}`)!.id).single();
  await admin.from('member_accounts').delete().eq('user_id', u!.user_id);
  try {
    const cookie = await appCookie('leitor');
    const old = await fetch(`${APP}/vagas?area=1`, { redirect: 'manual', headers: { cookie } });
    assert.equal(to(old), '/completar-cadastro?next=%2Fvagas%3Farea%3D1');
    assert.equal((await fetch(`${APP}/conta`, { redirect: 'manual', headers: { cookie } })).status, 200, 'excluir a conta continua possível');
    assert.equal((await fetch(`${APP}/api/contact/general`, { method: 'POST', redirect: 'manual', headers: { cookie } })).status, 403);
  } finally {
    await admin.from('member_accounts').insert(u!);
  }
});

test('página de entrada: vitrine devolve só cargo, bairro e tipo; números de confiança só contam', async () => {
  const v = anon();
  const { data, error } = await v.rpc('entry_job_showcase', { p_q: 'COZÍNHA' });
  assert.equal(error, null);
  const show = data as { total: number; vagas: Record<string, unknown>[] };
  assert.equal(show.total, 1, 'acento e maiúscula não atrapalham');
  assert.deepEqual(Object.keys(show.vagas[0]).sort(), ['bairro', 'cargo', 'tipo']);
  const all = (await v.rpc('entry_job_showcase', {})).data as { total: number; vagas: unknown[] };
  assert.ok(all.total >= all.vagas.length && all.vagas.length <= 5);
  assert.ok(!JSON.stringify(all).includes('Restaurante'), 'nunca o nome da empresa');
  const trust = (await v.rpc('entry_trust_numbers')).data as Record<string, number>;
  assert.deepEqual(Object.keys(trust).sort(), ['concluidos', 'vagas', 'verificados']);
});

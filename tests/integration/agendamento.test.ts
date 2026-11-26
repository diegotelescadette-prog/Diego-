import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { admin, anon, signIn } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const pkg = async (slug: string) => (await admin.from('service_packages').select('id').eq('slug', slug).single()).data!.id as number;
const hood = async (slug: string) => (await admin.from('neighborhoods').select('id').eq('slug', slug).single()).data!.id as number;
const tomorrow = () => {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Campo_Grande' }).format(new Date()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const args = async (over: Record<string, unknown> = {}) => ({
  p_package: await pkg('diaria-4-horas'), p_qty: 2, p_addons: [] as number[], p_date: tomorrow(), p_slot: 'manha',
  p_neighborhood: await hood('centro'), p_address: 'Rua Teste, 10', p_phone: '(67) 98888-7777', p_notes: null, p_payment: 'dinheiro_na_entrega', ...over,
});

test('o total é calculado no banco (quantidade e adicionais); dados inválidos são recusados', async () => {
  const c = await signIn('cliente');
  const addon = (await admin.from('package_addons').select('id, price_cents').eq('package_id', await pkg('diaria-4-horas')).single()).data!;
  const { data: id, error } = await c.rpc('create_booking', await args({ p_addons: [addon.id] }));
  assert.equal(error, null);
  const { data: b } = await c.from('bookings').select('total_cents, status').eq('id', id).single();
  assert.equal(b!.total_cents, (12000 + addon.price_cents) * 2);
  const { data: pay } = await c.from('payments').select('method, status, amount_cents').eq('booking_id', id).single();
  assert.deepEqual(pay, { method: 'dinheiro_na_entrega', status: 'pendente', amount_cents: (12000 + addon.price_cents) * 2 });
  for (const [over, code] of [
    [{ p_slot: 'madrugada' }, 'invalid_slot'], [{ p_date: '2020-01-01' }, 'invalid_slot'], [{ p_qty: 11 }, 'invalid_qty'],
    [{ p_phone: '123' }, 'invalid_phone'], [{ p_addons: [999999] }, 'invalid_addons'], [{ p_payment: 'cartao' }, 'invalid_payment'],
  ] as const) {
    const { error: e } = await c.rpc('create_booking', await args(over));
    assert.match(e?.message ?? '', new RegExp(code));
  }
  // pacote desativado não pode ser agendado
  await admin.from('service_packages').update({ active: false }).eq('slug', 'diaria-4-horas');
  assert.match((await c.rpc('create_booking', await args())).error?.message ?? '', /package_unavailable/);
  await admin.from('service_packages').update({ active: true }).eq('slug', 'diaria-4-horas');
  // visitante não agenda nem lê pedidos
  assert.ok((await anon().rpc('create_booking', await args())).error);
  assert.deepEqual((await anon().from('bookings').select('id')).data ?? [], []);
});

test('endereço e telefone: o profissional só vê depois de confirmar; outro usuário não vê nada', async () => {
  const c = await signIn('cliente');
  const { data: id } = await c.rpc('create_booking', await args());
  // Bia é a única diarista que atende o Centro: escolhida automaticamente
  const { data: b } = await admin.from('bookings').select('provider_id').eq('id', id).single();
  const bia = (await admin.from('provider_profiles').select('id').eq('slug', 'bia-demo').single()).data!.id;
  assert.equal(b!.provider_id, bia);
  const pro = await signIn('prestador-bia');
  assert.equal((await pro.from('bookings').select('id').eq('id', id)).data!.length, 1);
  assert.equal((await pro.from('booking_private').select('address_line').eq('booking_id', id)).data!.length, 0);
  const before = (await pro.rpc('booking_contacts', { p_booking: id })).data![0];
  assert.equal(before.client_phone, null);
  assert.equal(before.address_line, null);
  // cliente não confirma o próprio pedido
  assert.match((await c.rpc('booking_action', { p_booking: id, p_action: 'confirmado' })).error?.message ?? '', /not_allowed/);
  assert.equal((await pro.rpc('booking_action', { p_booking: id, p_action: 'confirmado' })).data, 'confirmado');
  assert.equal((await pro.from('booking_private').select('address_line').eq('booking_id', id)).data![0].address_line, 'Rua Teste, 10');
  // pular etapa é recusado
  assert.match((await pro.rpc('booking_action', { p_booking: id, p_action: 'concluido' })).error?.message ?? '', /invalid_status/);
  // outro usuário não vê
  const other = await signIn('empresa');
  assert.equal((await other.from('bookings').select('id').eq('id', id)).data!.length, 0);
  assert.equal((await other.rpc('booking_contacts', { p_booking: id })).data!.length, 0);
  assert.match((await other.rpc('booking_action', { p_booking: id, p_action: 'cancelar' })).error?.message ?? '', /not_allowed/);
  // e não escreve direto na tabela
  assert.ok((await c.from('bookings').update({ total_cents: 1 }).eq('id', id)).error || (await admin.from('bookings').select('total_cents').eq('id', id).single()).data!.total_cents !== 1);
});

test('comissão configurável é gravada ao concluir; equipe registra "não compareceu"', async () => {
  await admin.from('app_settings').upsert({ key: 'comissao', value: { percent: 15 } });
  const c = await signIn('cliente');
  const pro = await signIn('prestador-bia');
  const { data: id, error: ce } = await c.rpc('create_booking', await args({ p_qty: 1, p_slot: 'tarde' }));
  assert.equal(ce, null);
  for (const s of ['confirmado', 'a_caminho', 'em_andamento', 'concluido']) {
    assert.equal((await pro.rpc('booking_action', { p_booking: id, p_action: s })).data, s);
  }
  const { data: b } = await admin.from('bookings').select('commission_pct, commission_cents').eq('id', id).single();
  assert.equal(Number(b!.commission_pct), 15);
  assert.equal(b!.commission_cents, 1800);
  await admin.from('app_settings').upsert({ key: 'comissao', value: { percent: 12 } });

  const { data: id2 } = await c.rpc('create_booking', await args({ p_qty: 1, p_slot: 'noite' }));
  await pro.rpc('booking_action', { p_booking: id2, p_action: 'confirmado' });
  const adm = await signIn('admin');
  assert.equal((await adm.rpc('booking_action', { p_booking: id2, p_action: 'cancelar', p_cancel_kind: 'nao_compareceu', p_note: 'Não apareceu' })).data, 'cancelado');
  const later = new Date(tomorrow() + 'T12:00:00Z'); later.setUTCDate(later.getUTCDate() + 1);
  const cand = (await c.rpc('create_booking', await args({ p_qty: 1, p_date: later.toISOString().slice(0, 10) })));
  const { data: rows } = await adm.rpc('booking_candidates', { p_booking: cand.data });
  const biaRow = (rows as { display_name: string; show_rate: number; completed: number }[]).find((r) => r.display_name.startsWith('Bia'));
  assert.equal(biaRow?.completed, 1);
  assert.equal(biaRow?.show_rate, 50);
});

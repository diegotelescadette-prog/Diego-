import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anon, signIn } from './helpers.ts';

// Fase 3 (parte 1): reações com tipo, "Feito pelo Próximo" e seguir prestadores.
const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const uid = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
type Row = { id: string; display_name: string; author_id: string; reactions: number; reacted: boolean; my_reaction: string | null;
  reaction_counts: Record<string, number>; proof: { done_at: string | null; rating: number | null } | null };
const feed = async (c: SupabaseClient, extra: Record<string, unknown> = {}) =>
  ((await c.rpc('feed_posts', { p_city_slug: 'campo-grande-ms', ...extra })).data ?? []) as Row[];
const one = async (slug: string, table: 'services' | 'neighborhoods') => (await admin.from(table).select('id').eq('slug', slug).single()).data!.id as number;

test('reações: o "Útil" antigo vira Valeu; trocar o tipo mantém uma reação por pessoa; tipo inválido é recusado', async () => {
  const cliente = await signIn('cliente');
  const me = await uid(cliente);
  const pant = (await feed(cliente)).find((r) => r.display_name === 'Elétrica Pantanal (demo)')!;
  assert.equal(pant.my_reaction, 'valeu', 'reação da demonstração vira Valeu');
  assert.deepEqual(pant.reaction_counts, { valeu: 1 });

  assert.ok(!(await cliente.from('post_reactions').update({ reaction: 'inspirou' }).eq('post_id', pant.id).eq('user_id', me)).error);
  const after1 = (await feed(cliente, { p_post: pant.id }))[0];
  assert.equal(after1.my_reaction, 'inspirou');
  assert.equal(after1.reactions, 1);
  assert.deepEqual(after1.reaction_counts, { inspirou: 1 });

  assert.ok((await cliente.from('post_reactions').update({ reaction: 'curti' }).eq('post_id', pant.id).eq('user_id', me)).error, 'tipo fora da lista');
  const outro = await signIn('prestador-carlos');
  await outro.from('post_reactions').update({ reaction: 'indico' }).eq('post_id', pant.id).eq('user_id', me);
  assert.equal((await feed(cliente, { p_post: pant.id }))[0].my_reaction, 'inspirou', 'ninguém troca a reação dos outros');
  assert.equal((await feed(anon(), { p_post: pant.id }))[0].my_reaction, null);
});

test('Feito pelo Próximo: só pedido concluído do próprio prestador; mostra a nota; vínculo não muda depois', async () => {
  const carlos = await signIn('prestador-carlos');
  const me = await uid(carlos);
  const cliente = await signIn('cliente');
  const client = await uid(cliente);
  const enc = await one('encanador', 'services');
  const { data: prof } = await admin.from('provider_profiles').select('city_id').eq('id', me).single();
  const nb = (await admin.from('neighborhoods').select('id').eq('city_id', prof!.city_id).limit(1).single()).data!.id;
  const base = { client_id: client, city_id: prof!.city_id, neighborhood_id: nb, service_id: enc, scheduled_date: '2026-11-20',
    time_slot: 'manha', total_cents: 15000, payment_method: 'pix_na_entrega', provider_id: me };
  const done = (await admin.from('bookings').insert({ ...base, status: 'concluido', completed_at: '2026-11-20T15:00:00Z' }).select('id').single()).data!.id;
  const open = (await admin.from('bookings').insert({ ...base, status: 'confirmado' }).select('id').single()).data!.id;
  await admin.from('booking_reviews').insert({ booking_id: done, provider_id: me, client_id: client, rating: 5 });

  const list = (await carlos.rpc('my_bookings_to_show')).data as { id: string }[];
  assert.ok(list.some((b) => b.id === done) && !list.some((b) => b.id === open), 'lista só pedidos concluídos');
  assert.equal(((await cliente.rpc('my_bookings_to_show')).data ?? []).length, 0, 'cliente não vê pedidos de prestador');

  const T = { author_id: me, kind: 'trabalho', body: 'Troca de registro', service_id: enc };
  assert.ok((await carlos.from('posts').insert({ ...T, booking_id: open })).error, 'pedido em andamento não vale');
  assert.ok((await carlos.from('posts').insert({ ...T, kind: 'divulgacao', body: 'Atendo a cidade toda', booking_id: done })).error, 'só trabalho');
  const { data: post, error } = await carlos.from('posts').insert({ ...T, booking_id: done }).select('id').single();
  assert.ok(!error, error?.message);
  await admin.from('post_media').insert({ post_id: post!.id, kind: 'foto', path: `${me}/prova.webp`, sort: 0 });
  const row = (await feed(anon(), { p_post: post!.id }))[0];
  assert.equal(row.proof?.rating, 5);
  assert.ok(row.proof?.done_at);
  assert.ok((await carlos.from('posts').insert({ ...T, booking_id: done })).error, 'um post por pedido');
  assert.equal(((await carlos.rpc('my_bookings_to_show')).data as { id: string }[]).some((b) => b.id === done), false);

  await carlos.from('posts').update({ body: 'Troca de registro (editado)' }).eq('id', post!.id);
  const { data: again } = await admin.from('posts').select('booking_id, body').eq('id', post!.id).single();
  assert.equal(again!.booking_id, done);

  const bia = await signIn('prestador-bia');
  assert.ok((await bia.from('posts').insert({ ...T, author_id: await uid(bia), booking_id: done })).error, 'pedido de outro prestador');
  const plain = (await feed(anon())).find((r) => r.id !== post!.id && r.display_name === 'Elétrica Pantanal (demo)')!;
  assert.equal(plain.proof, null, 'post sem pedido não tem selo');
});

test('seguir: conta logada segue prestador publicado; contagem pública; lista privada; filtro "Quem eu sigo"', async () => {
  const cliente = await signIn('cliente');
  const me = await uid(cliente);
  const pantId = (await feed(anon())).find((r) => r.display_name === 'Elétrica Pantanal (demo)')!.author_id;
  assert.equal((await feed(cliente, { p_following: true })).length, 0);
  assert.ok((await anon().from('provider_follows').insert({ follower_id: me, provider_id: pantId })).error, 'visitante não segue');
  assert.ok(!(await cliente.from('provider_follows').insert({ follower_id: me, provider_id: pantId })).error);
  assert.ok((await cliente.from('provider_follows').insert({ follower_id: me, provider_id: me })).error, 'não segue a si mesmo');

  const rows = await feed(cliente, { p_following: true });
  assert.ok(rows.length > 0 && rows.every((r) => r.author_id === pantId));
  assert.equal((await anon().rpc('follower_count', { p_provider: pantId })).data, 1);
  const carlos = await signIn('prestador-carlos');
  assert.equal(((await carlos.from('provider_follows').select('*')).data ?? []).length, 0, 'ninguém vê quem os outros seguem');
  assert.equal((await feed(anon(), { p_following: true })).length, 0, 'visitante não tem "Quem eu sigo"');

  await cliente.from('provider_follows').delete().eq('follower_id', me).eq('provider_id', pantId);
  assert.equal((await anon().rpc('follower_count', { p_provider: pantId })).data, 0);
});

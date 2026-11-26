import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, signIn } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const uid = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
const unread = async (c: SupabaseClient) => ((await c.from('notifications').select('kind, read_at')).data ?? []).filter((n) => !n.read_at).map((n) => n.kind).sort();

test('filtro de ofensas: post, comentário, nome e legenda; acento, maiúscula e espaço não enganam; sem falso positivo', async () => {
  const cliente = await signIn('cliente');
  const me = await uid(cliente);
  const p = await cliente.from('posts').insert({ author_id: me, kind: 'dia_a_dia', body: 'Que MÉRDA de trânsito hoje' });
  assert.equal(p.error?.code, '23514');
  assert.match(p.error!.message, /carinho/);
  const ok = await cliente.from('posts').insert({ author_id: me, kind: 'dia_a_dia', body: 'Promoção de mexerica no mercado do bairro.' }).select('id').single();
  assert.equal(ok.error, null, 'palavra inteira, sem falso positivo');
  assert.equal((await cliente.from('post_comments').insert({ post_id: ok.data!.id, author_id: me, body: 'seu idiota' })).error?.code, '23514');
  assert.equal((await cliente.from('member_names').update({ name: 'Otário da Silva' }).eq('user_id', me)).error?.code, '23514');
  await admin.from('posts').delete().eq('id', ok.data!.id);
  assert.equal((await cliente.from('stories').insert({ author_id: me, kind: 'foto', path: `${me}/m.webp`, caption: 'que porra' })).error?.code, '23514');
});

test('palavras bloqueadas: só a equipe vê e edita a lista', async () => {
  const cliente = await signIn('cliente');
  const me = await uid(cliente);
  assert.equal(((await cliente.from('blocked_words').select('word')).data ?? []).length, 0, 'lista não é pública');
  assert.ok((await cliente.from('blocked_words').insert({ word: 'teste' })).error);
  const adm = await signIn('admin');
  await admin.from('blocked_words').delete().eq('word', 'jabuticaba podre');
  assert.equal((await adm.from('blocked_words').insert({ word: 'jabuticaba podre' })).error, null);
  assert.equal((await cliente.from('posts').insert({ author_id: me, kind: 'dia_a_dia', body: 'Olha essa JABUTICABA  podre' })).error?.code, '23514');
  assert.ok((await adm.from('blocked_words').insert({ word: 'Com Acento é' })).error, 'formato da palavra');
  await adm.from('blocked_words').delete().eq('word', 'jabuticaba podre');
});

test('notificações: reação, comentário, resposta e seguidor; só o dono lê; ninguém cria na mão; marcar como lido', async () => {
  const pant = await signIn('prestador-pantanal');
  const pantId = await uid(pant);
  const cliente = await signIn('cliente');
  const clienteId = await uid(cliente);
  await admin.from('notifications').delete().in('user_id', [pantId, clienteId]);
  const { data: post } = await admin.from('posts').select('id').eq('author_id', pantId).limit(1).single();
  // reação nova (a do seed já existe: troca não gera aviso; tirar e pôr de novo gera um só)
  await admin.from('post_reactions').delete().eq('post_id', post!.id).eq('user_id', clienteId);
  assert.equal((await cliente.from('post_reactions').insert({ post_id: post!.id, user_id: clienteId, reaction: 'inspirou' })).error, null);
  await cliente.from('post_reactions').delete().eq('post_id', post!.id).eq('user_id', clienteId);
  await cliente.from('post_reactions').insert({ post_id: post!.id, user_id: clienteId, reaction: 'valeu' });
  const { data: c } = await cliente.from('post_comments').insert({ post_id: post!.id, author_id: clienteId, body: 'Ficou ótimo!' }).select('id').single();
  assert.deepEqual(await unread(pant), ['comentario', 'reacao']);
  const { data: n } = await pant.from('notifications').select('data').eq('kind', 'reacao').single();
  assert.equal((n!.data as { reacao: string }).reacao, 'inspirou');
  // resposta avisa quem comentou
  await pant.from('post_comments').insert({ post_id: post!.id, author_id: pantId, body: 'Obrigado!', parent_id: c!.id });
  assert.deepEqual(await unread(cliente), ['resposta']);
  // seguir avisa o prestador
  await admin.from('provider_follows').delete().eq('follower_id', clienteId).eq('provider_id', pantId);
  assert.equal((await cliente.from('provider_follows').insert({ follower_id: clienteId, provider_id: pantId })).error, null);
  assert.deepEqual(await unread(pant), ['comentario', 'reacao', 'seguiu']);
  // privacidade
  assert.equal(((await cliente.from('notifications').select('id').eq('user_id', pantId)).data ?? []).length, 0);
  assert.ok((await cliente.from('notifications').insert({ user_id: pantId, kind: 'seguiu' })).error);
  assert.ok((await cliente.rpc('notify', { p_user: pantId, p_kind: 'seguiu', p_actor: clienteId, p_post: null, p_comment: null, p_data: {} })).error);
  assert.equal((await pant.rpc('mark_notifications_read')).error, null);
  assert.deepEqual(await unread(pant), []);
  // reagir na própria publicação não avisa
  await admin.from('post_reactions').delete().eq('post_id', post!.id).eq('user_id', pantId);
  await pant.from('post_reactions').insert({ post_id: post!.id, user_id: pantId, reaction: 'valeu' });
  assert.deepEqual(await unread(pant), []);
});

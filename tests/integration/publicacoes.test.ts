import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anon, signIn } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const uid = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
const feed = async (c: SupabaseClient, extra: Record<string, unknown> = {}) =>
  ((await c.rpc('feed_posts', { p_city_slug: 'campo-grande-ms', ...extra })).data ?? []) as { id: string; display_name: string; reactions: number; comments: number; reacted: boolean; media: unknown[]; last_comment: { name: string } | null }[];

test('feed: visitante vê publicações de perfis publicados com mídia, contagens e último comentário', async () => {
  const rows = await feed(anon());
  assert.ok(rows.length >= 3);
  const pant = rows.find((r) => r.display_name === 'Elétrica Pantanal (demo)')!;
  assert.equal(pant.reactions, 1);
  assert.equal(pant.comments, 1);
  assert.equal(pant.last_comment?.name, 'Ana Cliente (demo)');
  assert.equal(rows.find((r) => r.display_name === 'Bia Faxina (demo)')!.media.length, 5);
  assert.equal(pant.reacted, false);
  assert.equal((await feed(await signIn('cliente'))).find((r) => r.display_name === 'Elétrica Pantanal (demo)')!.reacted, true);
});

test('publicar: só prestador publicado, só no próprio perfil, sem mudar estado nem data', async () => {
  const carlos = await signIn('prestador-carlos');
  const me = await uid(carlos);
  const cliente = await signIn('cliente');
  assert.ok((await anon().from('posts').insert({ author_id: me, body: 'x' })).error, 'visitante não publica');
  assert.ok((await cliente.from('posts').insert({ author_id: await uid(cliente), body: 'x' })).error, 'quem não é prestador não publica');
  assert.ok((await cliente.from('posts').insert({ author_id: me, body: 'x' })).error, 'não publica em nome de outro');
  const paulo = await signIn('prestador-paulo'); // pausado
  assert.ok((await paulo.from('posts').insert({ author_id: await uid(paulo), body: 'x' })).error, 'perfil pausado não publica');
  assert.ok((await carlos.from('posts').insert({ author_id: me, body: 'x', status: 'removido' })).error, 'não define o estado');
  const { data: post, error } = await carlos.from('posts').insert({ author_id: me, body: '  Teste de publicação  ' }).select('id, body, status').single();
  assert.equal(error, null);
  assert.equal(post!.body, 'Teste de publicação');
  assert.ok((await carlos.from('posts').update({ status: 'removido' }).eq('id', post!.id)).error, 'não muda o estado direto');
  assert.ok((await feed(anon())).some((r) => r.id === post!.id));
  // outro prestador não edita nem apaga
  const bia = await signIn('prestador-bia');
  assert.equal(((await bia.from('posts').delete().eq('id', post!.id).select('id')).data ?? []).length, 0);
  assert.equal(((await carlos.from('posts').delete().eq('id', post!.id).select('id')).data ?? []).length, 1);
});

test('mídia: arquivo na própria pasta; um vídeo OU até 6 fotos; storage barra pasta alheia', async () => {
  const carlos = await signIn('prestador-carlos');
  const me = await uid(carlos);
  const bia = await signIn('prestador-bia');
  const other = await uid(bia);
  const vid = Buffer.from('fake-mp4');
  assert.ok((await carlos.storage.from('post-media').upload(`${other}/v.mp4`, vid, { contentType: 'video/mp4' })).error, 'pasta de outro');
  assert.equal((await carlos.storage.from('post-media').upload(`${me}/v-${crypto.randomUUID()}.mp4`, vid, { contentType: 'video/mp4' })).error, null);
  assert.ok((await carlos.storage.from('post-media').upload(`${me}/x.exe`, vid, { contentType: 'application/x-msdownload' })).error, 'tipo proibido');

  const { data: post } = await carlos.from('posts').insert({ author_id: me, body: 'mídia' }).select('id').single();
  assert.ok((await carlos.from('post_media').insert({ post_id: post!.id, kind: 'foto', path: `${other}/a.webp` })).error, 'arquivo de outra pessoa');
  assert.ok((await bia.from('post_media').insert({ post_id: post!.id, kind: 'foto', path: `${other}/a.webp` })).error, 'anexar na publicação de outro');
  assert.equal((await carlos.from('post_media').insert({ post_id: post!.id, kind: 'video', path: `${me}/v1.mp4` })).error, null);
  assert.ok((await carlos.from('post_media').insert({ post_id: post!.id, kind: 'foto', path: `${me}/f.webp` })).error, 'vídeo + foto');
  const { data: p2 } = await carlos.from('posts').insert({ author_id: me, body: 'fotos' }).select('id').single();
  for (let i = 0; i < 6; i++) assert.equal((await carlos.from('post_media').insert({ post_id: p2!.id, kind: 'foto', path: `${me}/f${i}.webp`, sort: i })).error, null);
  assert.ok((await carlos.from('post_media').insert({ post_id: p2!.id, kind: 'foto', path: `${me}/f7.webp` })).error, '7ª foto');
  await carlos.from('posts').delete().in('id', [post!.id, p2!.id]);
});

test('comentários: nome vem do perfil ou do cadastro, nunca do cliente; autor oculta; denúncia sem duplicar', async () => {
  const [pant] = (await feed(anon())).filter((r) => r.display_name === 'Elétrica Pantanal (demo)');
  const cliente = await signIn('cliente');
  const me = await uid(cliente);
  assert.ok((await anon().from('post_comments').insert({ post_id: pant.id, author_id: me, body: 'oi' })).error, 'visitante não comenta');
  const { data: c, error } = await cliente.from('post_comments').insert({ post_id: pant.id, author_id: me, body: 'Muito bom!', author_name: 'Admin Oficial', status: 'oculto' } as never).select('id').single();
  assert.ok(error, 'colunas protegidas (nome e estado) não são aceitas');
  const ok = await cliente.from('post_comments').insert({ post_id: pant.id, author_id: me, body: 'Muito bom!' }).select('id, author_name, status').single();
  assert.equal(ok.error, null);
  assert.equal(ok.data!.author_name, 'Ana Cliente (demo)');
  assert.equal(ok.data!.status, 'visivel');
  void c;
  // quem não tem nome precisa informar
  const cand = await signIn('candidata');
  assert.ok((await cand.from('post_comments').insert({ post_id: pant.id, author_id: await uid(cand), body: 'oi' })).error);
  // autor da publicação oculta; o comentário some para os outros e continua para o autor do comentário
  const pantanal = await signIn('prestador-pantanal');
  assert.equal((await pantanal.rpc('hide_comment', { p_comment: ok.data!.id, p_hide: true })).error, null);
  assert.ok((await cliente.rpc('hide_comment', { p_comment: ok.data!.id, p_hide: false })).error, 'só o autor da publicação');
  const pub = await anon().from('post_comments').select('id').eq('id', ok.data!.id);
  assert.equal(pub.data!.length, 0);
  assert.equal((await cliente.from('post_comments').select('id').eq('id', ok.data!.id)).data!.length, 1);
  // denúncia: uma aberta por pessoa e item; visitante não denuncia
  const rep = { reporter_id: me, post_id: pant.id, reason: 'spam' };
  assert.equal((await cliente.from('post_reports').insert(rep)).error, null);
  assert.equal((await cliente.from('post_reports').insert(rep)).error?.code, '23505');
  assert.ok((await anon().from('post_reports').insert({ ...rep, reporter_id: null })).error);
  assert.equal(((await (await signIn('prestador-bia')).from('post_reports').select('id')).data ?? []).length, 0, 'denúncias não são públicas');
});

test('moderação: só admin remove; publicação removida some do feed e o autor não a reativa', async () => {
  const [ze] = (await feed(anon())).filter((r) => r.display_name === 'Zé Reformas (demo)');
  const cliente = await signIn('cliente');
  assert.ok((await cliente.rpc('admin_remove_post', { p_post: ze.id, p_note: 'x' })).error);
  const adm = await signIn('admin');
  assert.ok((await adm.rpc('admin_remove_post', { p_post: ze.id, p_note: '' })).error, 'motivo obrigatório');
  assert.equal((await adm.rpc('admin_remove_post', { p_post: ze.id, p_note: 'Teste de moderação' })).error, null);
  assert.ok(!(await feed(anon())).some((r) => r.id === ze.id));
  const zeC = await signIn('prestador-ze');
  assert.ok((await zeC.from('posts').update({ body: 'voltei' }).eq('id', ze.id)).error, 'removida não é editada');
  const { data: log } = await admin.from('moderation_log').select('action').eq('target_id', ze.id);
  assert.deepEqual(log!.map((l) => l.action), ['remover_publicacao']);
});

test('perfil pausado ou suspenso: publicações saem do feed', async () => {
  const [bia] = (await feed(anon())).filter((r) => r.display_name === 'Bia Faxina (demo)');
  const { data: me } = await admin.from('posts').select('author_id').eq('id', bia.id).single();
  await admin.from('provider_profiles').update({ status: 'paused' }).eq('id', me!.author_id);
  assert.ok(!(await feed(anon())).some((r) => r.id === bia.id));
  assert.equal((await anon().from('posts').select('id').eq('id', bia.id)).data!.length, 0);
  await admin.from('provider_profiles').update({ status: 'published' }).eq('id', me!.author_id);
});

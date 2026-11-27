import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anon, signIn, viewer } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const uid = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
type FeedRow = { id: string; kind: string; display_name: string; reactions: number; comments: number; reacted: boolean; saved: boolean; found: boolean;
  available_today: boolean; created_at: string; media: { path: string; label: string | null }[]; last_comment: { name: string } | null };
const feed = async (c: SupabaseClient, extra: Record<string, unknown> = {}) =>
  ((await c.rpc('feed_posts', { p_city_slug: 'campo-grande-ms', ...extra })).data ?? []) as FeedRow[];
const svc = async (slug: string) => (await admin.from('services').select('id').eq('slug', slug).single()).data!.id as number;
const hood = async (slug: string) => (await admin.from('neighborhoods').select('id').eq('slug', slug).single()).data!.id as number;

test('feed: quem tem conta vê publicações de perfis publicados com mídia, contagens e último comentário', async () => {
  const rows = await feed(await viewer());
  assert.ok(rows.length >= 3);
  const pant = rows.find((r) => r.display_name === 'Elétrica Pantanal (demo)')!;
  assert.equal(pant.reactions, 1);
  assert.equal(pant.comments, 1);
  assert.equal(pant.last_comment?.name, 'Ana Cliente (demo)');
  assert.equal(rows.find((r) => r.display_name === 'Bia Faxina (demo)')!.media.length, 5);
  assert.equal(pant.reacted, false);
  assert.equal((await feed(await signIn('cliente'))).find((r) => r.display_name === 'Elétrica Pantanal (demo)')!.reacted, true);
});

test('trabalho e divulgação: só prestador publicado com cobertura e serviço do próprio perfil', async () => {
  const carlos = await signIn('prestador-carlos');
  const me = await uid(carlos);
  const cliente = await signIn('cliente');
  const enc = await svc('encanador');
  const T = { kind: 'trabalho', service_id: enc };
  assert.ok((await anon().from('posts').insert({ author_id: me, body: 'x', ...T })).error, 'visitante não publica');
  assert.ok((await cliente.from('posts').insert({ author_id: await uid(cliente), body: 'x', ...T })).error, 'quem não é prestador não mostra trabalho');
  assert.ok((await cliente.from('posts').insert({ author_id: me, body: 'x', ...T })).error, 'não publica em nome de outro');
  const paulo = await signIn('prestador-paulo'); // pausado
  assert.ok((await paulo.from('posts').insert({ author_id: await uid(paulo), body: 'x', ...T })).error, 'perfil pausado não publica');
  const ze = await signIn('prestador-ze'); // publicado, sem área confirmada
  assert.equal((await ze.from('posts').insert({ author_id: await uid(ze), body: 'x', kind: 'trabalho', service_id: await svc('pedreiro') })).error?.code, '42501', 'sem cobertura não publica');
  assert.ok((await carlos.from('posts').insert({ author_id: me, body: 'x', kind: 'trabalho', service_id: await svc('eletricista') })).error, 'serviço fora do perfil');
  assert.ok((await carlos.from('posts').insert({ author_id: me, body: 'x', kind: 'trabalho' })).error, 'serviço obrigatório');
  assert.ok((await carlos.from('posts').insert({ author_id: me, body: '', kind: 'divulgacao', service_id: enc })).error, 'divulgação exige texto');
  assert.ok((await carlos.from('posts').insert({ author_id: me, body: 'x', status: 'removido', ...T })).error, 'não define o estado');
  const { data: post, error } = await carlos.from('posts').insert({ author_id: me, body: '  Teste de publicação  ', ...T }).select('id, body, status').single();
  assert.equal(error, null);
  assert.equal(post!.body, 'Teste de publicação');
  assert.ok((await carlos.from('posts').update({ status: 'removido' }).eq('id', post!.id)).error, 'não muda o estado direto');
  assert.ok((await feed(await viewer())).some((r) => r.id === post!.id));
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

  const T = { kind: 'trabalho', service_id: await svc('encanador') };
  const { data: post } = await carlos.from('posts').insert({ author_id: me, body: 'mídia', ...T }).select('id').single();
  assert.ok((await carlos.from('post_media').insert({ post_id: post!.id, kind: 'foto', path: `${other}/a.webp` })).error, 'arquivo de outra pessoa');
  assert.ok((await bia.from('post_media').insert({ post_id: post!.id, kind: 'foto', path: `${other}/a.webp` })).error, 'anexar na publicação de outro');
  assert.equal((await carlos.from('post_media').insert({ post_id: post!.id, kind: 'video', path: `${me}/v1.mp4` })).error, null);
  assert.ok((await carlos.from('post_media').insert({ post_id: post!.id, kind: 'foto', path: `${me}/f.webp` })).error, 'vídeo + foto');
  const { data: p2 } = await carlos.from('posts').insert({ author_id: me, body: 'fotos', ...T }).select('id').single();
  for (let i = 0; i < 6; i++) assert.equal((await carlos.from('post_media').insert({ post_id: p2!.id, kind: 'foto', path: `${me}/f${i}.webp`, sort: i })).error, null);
  assert.ok((await carlos.from('post_media').insert({ post_id: p2!.id, kind: 'foto', path: `${me}/f7.webp` })).error, '7ª foto');
  // ordem e Antes/Depois: o autor troca; outra conta não
  const { data: m0 } = await carlos.from('post_media').select('id').eq('path', `${me}/f0.webp`).single();
  assert.equal(((await bia.from('post_media').update({ label: 'antes' }).eq('id', m0!.id).select('id')).data ?? []).length, 0);
  assert.equal((await carlos.from('post_media').update({ sort: 9, label: 'depois' }).eq('id', m0!.id)).error, null);
  assert.ok((await carlos.from('post_media').update({ label: 'durante' } as never).eq('id', m0!.id)).error, 'rótulo inválido');
  await carlos.from('posts').delete().in('id', [post!.id, p2!.id]);
});

test('comentários: nome vem do perfil ou do cadastro, nunca do cliente; autor oculta; denúncia sem duplicar', async () => {
  const [pant] = (await feed(await viewer())).filter((r) => r.display_name === 'Elétrica Pantanal (demo)');
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
  // quem não tem nome (conta antiga) precisa informar
  const cand = await signIn('candidata');
  await admin.from('member_names').delete().eq('user_id', await uid(cand));
  assert.ok((await cand.from('post_comments').insert({ post_id: pant.id, author_id: await uid(cand), body: 'oi' })).error);
  // autor da publicação oculta; o comentário some para os outros e continua para o autor do comentário
  const pantanal = await signIn('prestador-pantanal');
  assert.equal((await pantanal.rpc('hide_comment', { p_comment: ok.data!.id, p_hide: true })).error, null);
  assert.ok((await cliente.rpc('hide_comment', { p_comment: ok.data!.id, p_hide: false })).error, 'só o autor da publicação');
  const pub = await (await viewer()).from('post_comments').select('id').eq('id', ok.data!.id);
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
  const [ze] = (await feed(await viewer())).filter((r) => r.display_name === 'Elétrica Pantanal (demo)');
  const cliente = await signIn('cliente');
  assert.ok((await cliente.rpc('admin_remove_post', { p_post: ze.id, p_note: 'x' })).error);
  const adm = await signIn('admin');
  assert.ok((await adm.rpc('admin_remove_post', { p_post: ze.id, p_note: '' })).error, 'motivo obrigatório');
  assert.equal((await adm.rpc('admin_remove_post', { p_post: ze.id, p_note: 'Teste de moderação' })).error, null);
  assert.ok(!(await feed(await viewer())).some((r) => r.id === ze.id));
  const zeC = await signIn('prestador-pantanal');
  assert.ok((await zeC.from('posts').update({ body: 'voltei' }).eq('id', ze.id)).error, 'removida não é editada');
  const { data: log } = await admin.from('moderation_log').select('action').eq('target_id', ze.id);
  assert.deepEqual(log!.map((l) => l.action), ['remover_publicacao']);
  // a mídia também deixa de ser servida: a página não recebe mais o caminho
  assert.equal((await (await viewer()).from('post_media').select('path').eq('post_id', ze.id)).data!.length, 0);
  await admin.from('posts').update({ status: 'publicado', removed_note: null }).eq('id', ze.id); // devolve para os próximos testes
});

test('perfil pausado ou suspenso: publicações saem do feed', async () => {
  const [bia] = (await feed(await viewer())).filter((r) => r.display_name === 'Bia Faxina (demo)');
  const { data: me } = await admin.from('posts').select('author_id').eq('id', bia.id).single();
  await admin.from('provider_profiles').update({ status: 'paused' }).eq('id', me!.author_id);
  assert.ok(!(await feed(await viewer())).some((r) => r.id === bia.id));
  assert.equal((await (await viewer()).from('posts').select('id').eq('id', bia.id)).data!.length, 0);
  await admin.from('provider_profiles').update({ status: 'published' }).eq('id', me!.author_id);
});

test('pedido de indicação: qualquer conta com nome público; categoria ou serviço; "Indicação encontrada" só pelo autor', async () => {
  const cand = await signIn('candidata');
  const candId = await uid(cand);
  await admin.from('member_names').delete().eq('user_id', candId); // conta antiga, sem nome público
  const P = { kind: 'pedido', category_id: (await admin.from('service_categories').select('id').eq('slug', 'eletrica-e-climatizacao').single()).data!.id };
  assert.equal((await cand.from('posts').insert({ author_id: candId, body: 'Preciso de eletricista', ...P })).error?.code, '23514', 'sem nome público');
  await cand.from('member_names').upsert({ user_id: candId, name: 'Carla Teste' });
  assert.ok((await cand.from('posts').insert({ author_id: candId, body: 'Preciso de eletricista', kind: 'pedido' })).error, 'sem categoria');
  const { data: post, error } = await cand.from('posts').insert({ author_id: candId, body: 'Preciso de eletricista', ...P, price_label: 'R$ 10' })
    .select('id, city_id, price_label').single();
  assert.equal(error, null);
  assert.equal(post!.price_label, null, 'pedido não tem preço');
  assert.ok(post!.city_id, 'cidade do piloto por padrão');
  const row = (await feed(await viewer(), { p_kind: 'pedido' })).find((r) => r.id === post!.id)!;
  assert.equal(row.display_name, 'Carla Teste');
  const cliente = await signIn('cliente');
  assert.equal(((await cliente.from('posts').update({ found: true }).eq('id', post!.id).select('id')).data ?? []).length, 0, 'outra conta não marca');
  assert.equal((await cand.from('posts').update({ found: true }).eq('id', post!.id)).error, null);
  assert.equal((await feed(await viewer(), { p_post: post!.id }))[0].found, true);
  // comentário indicando um perfil público; perfil pausado não pode ser indicado
  const pantId = (await admin.from('provider_profiles').select('id').eq('slug', (await admin.from('provider_profiles').select('slug').ilike('display_name', 'Elétrica Pantanal%').single()).data!.slug).single()).data!.id;
  const pauloId = (await admin.from('provider_profiles').select('id').eq('status', 'paused').limit(1).single()).data!.id;
  assert.equal((await cliente.from('post_comments').insert({ post_id: post!.id, author_id: await uid(cliente), body: 'Chama a Pantanal', provider_id: pantId })).error, null);
  assert.ok((await cliente.from('post_comments').insert({ post_id: post!.id, author_id: await uid(cliente), body: 'x', provider_id: pauloId })).error);
  await admin.from('posts').delete().eq('id', post!.id);
  await admin.from('member_names').delete().eq('user_id', candId);
});

test('filtros: tipo, categoria e bairro pela área de atendimento; cidade inteira entra em qualquer bairro', async () => {
  const names = async (extra: Record<string, unknown>) => (await feed(await viewer(), extra)).map((r) => `${r.kind}:${r.display_name}`).sort();
  const tira = await hood('tiradentes');
  assert.deepEqual(await names({ p_neighborhood: tira }), ['pedido:Ana Cliente (demo)', 'trabalho:Elétrica Pantanal (demo)']);
  assert.deepEqual(await names({ p_neighborhood: await hood('amambai') }), ['trabalho:Carlos Hidráulica (demo)', 'trabalho:Elétrica Pantanal (demo)']);
  assert.deepEqual(await names({ p_kind: 'divulgacao' }), ['divulgacao:Bia Faxina (demo)']);
  assert.deepEqual(await names({ p_category: 'eletrica-e-climatizacao' }), ['pedido:Ana Cliente (demo)', 'trabalho:Elétrica Pantanal (demo)']);
  // pedido para a cidade toda aparece em qualquer bairro
  const cliente = await signIn('cliente');
  const { data: geral } = await cliente.from('posts').insert({ author_id: await uid(cliente), body: 'Procuro pintor para a cidade toda', kind: 'pedido', service_id: await svc('pintor-residencial') }).select('id').single();
  assert.ok((await feed(await viewer(), { p_neighborhood: await hood('amambai') })).some((r) => r.id === geral!.id));
  await admin.from('posts').delete().eq('id', geral!.id);
});

test('paginação estável: data + id, sem repetir nem pular', async () => {
  const all = await feed(await viewer(), { p_limit: 50 });
  const first = await feed(await viewer(), { p_limit: 2 });
  const last = first[first.length - 1];
  const rest = await feed(await viewer(), { p_limit: 50, p_before: last.created_at, p_before_id: last.id });
  assert.deepEqual([...first, ...rest].map((r) => r.id), all.map((r) => r.id));
});

test('salvos: só a própria conta vê; visitante não salva; aparece com p_saved', async () => {
  const [bia] = (await feed(await viewer())).filter((r) => r.display_name === 'Bia Faxina (demo)');
  const cliente = await signIn('cliente');
  const me = await uid(cliente);
  assert.ok((await anon().from('post_saves').insert({ user_id: me, post_id: bia.id })).error);
  assert.equal((await cliente.from('post_saves').insert({ user_id: me, post_id: bia.id })).error, null);
  assert.deepEqual((await feed(cliente, { p_saved: true })).map((r) => r.id), [bia.id]);
  assert.equal((await feed(cliente, { p_post: bia.id }))[0].saved, true);
  const carlos = await signIn('prestador-carlos');
  assert.equal(((await carlos.from('post_saves').select('post_id')).data ?? []).length, 0, 'salvos são privados');
  assert.equal((await feed(carlos, { p_saved: true })).length, 0);
  await cliente.from('post_saves').delete().eq('post_id', bia.id);
});

test('comentários: respostas de um nível; só o autor edita; ocultar pelo autor do post fica no histórico', async () => {
  const [pant] = (await feed(await viewer())).filter((r) => r.display_name === 'Elétrica Pantanal (demo)');
  const cliente = await signIn('cliente');
  const carlos = await signIn('prestador-carlos');
  const { data: c1 } = await cliente.from('post_comments').insert({ post_id: pant.id, author_id: await uid(cliente), body: 'Pergunta' }).select('id').single();
  const { data: r1, error } = await carlos.from('post_comments').insert({ post_id: pant.id, author_id: await uid(carlos), body: 'Resposta', parent_id: c1!.id }).select('id').single();
  assert.equal(error, null);
  assert.ok((await cliente.from('post_comments').insert({ post_id: pant.id, author_id: await uid(cliente), body: 'x', parent_id: r1!.id })).error, 'só um nível');
  assert.equal(((await carlos.from('post_comments').update({ body: 'hack' }).eq('id', c1!.id).select('id')).data ?? []).length, 0, 'outra conta não edita');
  const ed = await cliente.from('post_comments').update({ body: 'Pergunta corrigida' }).eq('id', c1!.id).select('body, edited_at, author_name').single();
  assert.equal(ed.data!.body, 'Pergunta corrigida');
  assert.ok(ed.data!.edited_at);
  assert.ok((await cliente.from('post_comments').update({ status: 'oculto' } as never).eq('id', c1!.id)).error, 'estado não é editável');
  const pantanal = await signIn('prestador-pantanal');
  await pantanal.rpc('hide_comment', { p_comment: c1!.id, p_hide: true });
  const { data: log } = await admin.from('moderation_log').select('action, actor_id').eq('target_id', String(c1!.id));
  assert.deepEqual(log!.map((l) => l.action), ['autor_ocultou_comentario']);
});

test('mídia privada: links assinados só para publicações visíveis; endereço público não serve', async () => {
  const [carlosPost] = (await feed(await viewer())).filter((r) => r.display_name === 'Carlos Hidráulica (demo)');
  assert.deepEqual(carlosPost.media.map((m) => m.label), ['antes', 'depois', null], 'ordem e rótulos');
  const path = carlosPost.media[0].path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
  assert.notEqual((await fetch(`${base}/storage/v1/object/public/post-media/${path}`)).status, 200);
  const { data } = await admin.storage.from('post-media').createSignedUrl(path, 60);
  assert.equal((await fetch(data!.signedUrl)).status, 200);
  // perfil suspenso: post e mídia somem para visitantes
  const { data: me } = await admin.from('posts').select('author_id').eq('id', carlosPost.id).single();
  await admin.from('provider_profiles').update({ status: 'suspended' }).eq('id', me!.author_id);
  assert.equal((await (await viewer()).from('post_media').select('path').eq('post_id', carlosPost.id)).data!.length, 0);
  await admin.from('provider_profiles').update({ status: 'published' }).eq('id', me!.author_id);
  assert.equal((await (await viewer()).from('post_media').select('path').eq('post_id', carlosPost.id)).data!.length, 3, 'volta quando o perfil volta');
});

test('envio repetido com o mesmo token não duplica', async () => {
  const carlos = await signIn('prestador-carlos');
  const me = await uid(carlos);
  const token = crypto.randomUUID();
  const row = { author_id: me, body: 'idempotente', kind: 'divulgacao', service_id: await svc('encanador'), client_token: token };
  assert.equal((await carlos.from('posts').insert(row)).error, null);
  assert.equal((await carlos.from('posts').insert(row)).error?.code, '23505');
  assert.equal((await admin.from('posts').select('id').eq('client_token', token)).data!.length, 1);
  await admin.from('posts').delete().eq('client_token', token);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeHref, adminSection, areaFor, mainItems, navItems, profileLinks, screenTitle, showBottomNav } from '../../src/lib/nav.ts';

const visitor = { loggedIn: false, hasProfile: false, isAdmin: false };
const provider = { loggedIn: true, hasProfile: true, isAdmin: false };
const adm = { loggedIn: true, hasProfile: false, isAdmin: true };

test('área pelo caminho e barra principal em todas as telas', () => {
  assert.equal(areaFor('/'), 'busca');
  assert.equal(areaFor('/p/carlos-demo'), 'busca');
  assert.equal(areaFor('/painel/atendimento'), 'prestador');
  assert.equal(areaFor('/admin'), 'admin');
  assert.equal(areaFor('/painelx'), 'busca');
  assert.equal(showBottomNav('/buscar'), true);
  assert.equal(showBottomNav('/painel'), true);
  assert.equal(showBottomNav('/admin'), true);
});

test('barra principal: cinco itens, sem repetição, Perfil leva ao login para visitante', () => {
  assert.deepEqual(mainItems(visitor).map((i) => i.label), ['Início', 'Comunidade', 'Criar', 'Agenda', 'Perfil']);
  assert.equal(mainItems(visitor).at(-1)!.href, '/entrar');
  assert.equal(mainItems(provider).at(-1)!.href, '/perfil');
  assert.equal(new Set(mainItems(provider).map((i) => i.href)).size, 5);
});

test('Perfil reúne os atalhos; painel e administração conforme a conta', () => {
  const ids = (v: typeof visitor) => profileLinks(v).map((i) => i.testid);
  const client = { loggedIn: true, hasProfile: false, isAdmin: false };
  assert.ok(!ids(client).includes('perfil-admin'));
  assert.equal(profileLinks(client).find((i) => i.testid === 'perfil-painel')!.href, '/sou-prestador');
  assert.equal(profileLinks(provider).find((i) => i.testid === 'perfil-painel')!.href, '/painel');
  assert.ok(ids(adm).includes('perfil-admin'));
  assert.equal(new Set(profileLinks(adm).map((i) => i.href)).size, profileLinks(adm).length);
});

test('abas por área: prestador e admin só para quem tem permissão; sem atalhos repetidos da barra', () => {
  const labels = (a: Parameters<typeof navItems>[0], v: typeof visitor) => navItems(a, v).map((i) => i.label);
  assert.deepEqual(labels('busca', provider), []);
  assert.deepEqual(labels('prestador', provider), ['Visão geral', 'Pedidos para mim', 'Meu perfil', 'Serviços e fotos', 'Pacotes que eu faço', 'Onde atendo', 'Disponibilidade', 'Verificação do perfil', 'Prévia do perfil']);
  assert.deepEqual(labels('prestador', visitor), []);
  assert.deepEqual(labels('admin', provider), []);
  assert.equal(labels('admin', adm)[0], 'Visão geral');
  assert.ok(!labels('admin', adm).includes('Voltar ao início'));
});

test('item ativo: exato, prefixo e seção do admin', () => {
  const main = mainItems(provider);
  assert.equal(activeHref(main, '/'), '/');
  assert.equal(activeHref(main, '/hoje'), '/');
  assert.equal(activeHref(main, '/agendar/trocar-chuveiro'), '/');
  assert.equal(activeHref(main, '/p/carlos-demo'), '/');
  assert.equal(activeHref(main, '/comunidade/abc'), '/comunidade');
  assert.equal(activeHref(main, '/publicar'), '/criar');
  assert.equal(activeHref(main, '/pedidos/abc'), '/agenda');
  assert.equal(activeHref(main, '/perfil'), '/perfil');
  const pro = navItems('prestador', provider);
  assert.equal(activeHref(pro, '/painel'), '/painel');
  assert.equal(activeHref(pro, '/painel/servicos'), '/painel/servicos');
  const a = navItems('admin', adm);
  assert.equal(activeHref(a, '/admin', null), '/admin?aba=visao');
  assert.equal(activeHref(a, '/admin', 'perfis'), '/admin?aba=perfis');
  assert.equal(adminSection('inexistente'), 'visao');
  assert.equal(screenTitle('/admin', 'denuncias'), 'Administração · Denúncias');
  assert.equal(screenTitle('/admin', 'palavras'), 'Administração · Palavras bloqueadas');
  assert.equal(screenTitle('/notificacoes'), 'Notificações');
  assert.equal(screenTitle('/painel/disponibilidade'), 'Disponibilidade');
  assert.equal(screenTitle('/comunidade/abc'), 'Publicação');
  assert.equal(screenTitle('/comunidade/abc/editar'), 'Editar publicação');
});

test('filtros do feed: leitura segura, URL que mantém a seleção e cursor estável', async () => {
  const { readFilters, feedHref, decodeCursor, encodeCursor } = await import('../../src/lib/posts-shared.ts');
  assert.deepEqual(readFilters({ tipo: 'pedido', categoria: 'eletrica-e-climatizacao', bairro: '12' }), { kind: 'pedido', category: 'eletrica-e-climatizacao', neighborhood: 12, following: false });
  assert.deepEqual(readFilters({ tipo: 'x', categoria: '<script>', bairro: '-1' }), { kind: null, category: null, neighborhood: null, following: false });
  const f = readFilters({ tipo: 'trabalho', bairro: '3' });
  assert.equal(feedHref(f), '/comunidade?tipo=trabalho&bairro=3');
  assert.equal(feedHref(f, { pages: 2 }), '/comunidade?tipo=trabalho&bairro=3&pagina=2');
  assert.equal(feedHref(f, { kind: null, neighborhood: null }), '/comunidade');
  assert.equal(readFilters({ seguindo: '1' }).following, true);
  assert.equal(feedHref(readFilters({ seguindo: '1' })), '/comunidade?seguindo=1');
  const c = encodeCursor({ createdAt: '2026-11-25T19:00:00.123456+00:00', id: '5cdbd068-4211-4ce4-8c9b-d0a9c883cf93' });
  assert.deepEqual(decodeCursor(c), { before: '2026-11-25T19:00:00.123456+00:00', beforeId: '5cdbd068-4211-4ce4-8c9b-d0a9c883cf93' });
  assert.equal(decodeCursor('lixo'), null);
});

test('reações: resumo com total e o tipo mais usado', async () => {
  const { reactionSummary, isReaction } = await import('../../src/lib/posts-shared.ts');
  assert.equal(reactionSummary({}), '');
  assert.equal(reactionSummary({ valeu: 1 }), '1 reação · Valeu');
  assert.equal(reactionSummary({ valeu: 2, inspirou: 5 }), '7 reações · mais: Inspirou');
  assert.equal(isReaction('to_junto'), true);
  assert.equal(isReaction('util'), false);
});

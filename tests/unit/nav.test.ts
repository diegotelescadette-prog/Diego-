import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeHref, adminSection, areaFor, navItems, screenTitle, showBottomNav } from '../../src/lib/nav.ts';

const visitor = { loggedIn: false, hasProfile: false, isAdmin: false };
const provider = { loggedIn: true, hasProfile: true, isAdmin: false };
const adm = { loggedIn: true, hasProfile: false, isAdmin: true };

test('área pelo caminho e barra inferior só na busca', () => {
  assert.equal(areaFor('/'), 'busca');
  assert.equal(areaFor('/p/carlos-demo'), 'busca');
  assert.equal(areaFor('/painel/atendimento'), 'prestador');
  assert.equal(areaFor('/admin'), 'admin');
  assert.equal(areaFor('/painelx'), 'busca');
  assert.equal(showBottomNav('/buscar'), true);
  assert.equal(showBottomNav('/painel'), false);
  assert.equal(showBottomNav('/admin'), false);
});

test('menu por perfil: visitante, prestador e admin só veem a área permitida', () => {
  const labels = (a: Parameters<typeof navItems>[0], v: typeof visitor) => navItems(a, v).map((i) => i.label);
  assert.deepEqual(labels('busca', visitor), ['Início', 'Catálogo de serviços', 'Preciso para hoje', 'Buscar profissional', 'Vagas de emprego', 'Meu currículo', 'Quero contratar', 'Minha agenda', 'Salvos', 'Comunidade', 'Trabalhe com a gente']);
  assert.deepEqual(labels('busca', provider), ['Início', 'Catálogo de serviços', 'Preciso para hoje', 'Buscar profissional', 'Vagas de emprego', 'Meu currículo', 'Quero contratar', 'Minha agenda', 'Salvos', 'Comunidade', 'Painel do profissional']);
  assert.deepEqual(labels('prestador', provider), ['Visão geral', 'Pedidos para mim', 'Meu perfil', 'Criar publicação', 'Minhas publicações', 'Serviços e fotos', 'Pacotes que eu faço', 'Onde atendo', 'Disponibilidade', 'Verificação do perfil', 'Prévia do perfil', 'Minha conta', 'Voltar ao início']);
  // sem permissão, a área administrativa mostra o menu da comunidade
  assert.equal(labels('admin', provider)[0], 'Início');
  assert.equal(labels('admin', adm)[0], 'Visão geral');
  assert.equal(labels('prestador', visitor)[0], 'Início');
});

test('item ativo: exato, prefixo e seção do admin', () => {
  const busca = navItems('busca', visitor);
  assert.equal(activeHref(busca, '/'), '/');
  assert.equal(activeHref(busca, '/hoje'), '/hoje');
  assert.equal(activeHref(busca, '/comunidade/abc'), '/comunidade');
  assert.equal(activeHref(busca, '/agendar/trocar-chuveiro'), '/servicos');
  assert.equal(activeHref(busca, '/pedidos/abc'), '/agenda');
  assert.equal(activeHref(busca, '/vagas/nova'), '/vagas/nova');
  assert.equal(activeHref(busca, '/minhas-vagas'), '/vagas/nova');
  assert.equal(activeHref(busca, '/p/carlos-demo'), '/buscar');
  assert.equal(activeHref(busca, '/favoritos'), '/favoritos');
  assert.equal(activeHref(busca, '/minhas-publicacoes'), '/comunidade');
  assert.equal(new Set(busca.map((i) => i.href)).size, busca.length);
  assert.equal(activeHref(busca, '/vagas/123'), '/vagas');
  assert.equal(activeHref(busca, '/minhas-candidaturas'), '/vagas');
  const pro = navItems('prestador', provider);
  assert.equal(activeHref(pro, '/painel'), '/painel');
  assert.equal(activeHref(pro, '/painel/servicos'), '/painel/servicos');
  const a = navItems('admin', adm);
  assert.equal(activeHref(a, '/admin', null), '/admin?aba=visao');
  assert.equal(activeHref(a, '/admin', 'perfis'), '/admin?aba=perfis');
  assert.equal(adminSection('inexistente'), 'visao');
  assert.equal(screenTitle('/admin', 'denuncias'), 'Administração · Denúncias');
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

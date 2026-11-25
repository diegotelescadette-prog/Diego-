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
  assert.deepEqual(labels('busca', visitor), ['Início', 'Preciso para hoje', 'Buscar serviços', 'Categorias', 'Favoritos', 'Sou prestador']);
  assert.ok(labels('busca', provider).includes('Painel do prestador'));
  assert.deepEqual(labels('prestador', provider), ['Visão geral', 'Meu perfil', 'Serviços e fotos', 'Onde atendo', 'Disponibilidade', 'Prévia do perfil', 'Minha conta', 'Buscar serviços']);
  // sem permissão, a área administrativa mostra o menu de busca
  assert.equal(labels('admin', provider)[0], 'Início');
  assert.equal(labels('admin', adm)[0], 'Visão geral');
  assert.equal(labels('prestador', visitor)[0], 'Início');
});

test('item ativo: exato, prefixo e seção do admin', () => {
  const busca = navItems('busca', visitor);
  assert.equal(activeHref(busca, '/'), '/');
  assert.equal(activeHref(busca, '/hoje'), '/#preciso-para-hoje');
  assert.equal(activeHref(busca, '/p/carlos-demo'), '/buscar');
  assert.equal(activeHref(busca, '/favoritos'), '/favoritos');
  const pro = navItems('prestador', provider);
  assert.equal(activeHref(pro, '/painel'), '/painel');
  assert.equal(activeHref(pro, '/painel/servicos'), '/painel/servicos');
  const a = navItems('admin', adm);
  assert.equal(activeHref(a, '/admin', null), '/admin?aba=visao');
  assert.equal(activeHref(a, '/admin', 'perfis'), '/admin?aba=perfis');
  assert.equal(adminSection('inexistente'), 'visao');
  assert.equal(screenTitle('/admin', 'denuncias'), 'Administração · Denúncias');
  assert.equal(screenTitle('/painel/disponibilidade'), 'Disponibilidade');
});

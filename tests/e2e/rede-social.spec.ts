import { test } from '@playwright/test';
import sharp from 'sharp';
import { admin, demoEmail, expect, login, reseed } from './helpers';

// Fase 3 (parte 1): reações, seguir prestador, fim do feed e "Feito pelo Próximo".
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

test('reações: Valeu no botão principal, troca por Inspirou e tira tocando de novo', async ({ page }) => {
  await page.goto('/entrar');
  await login(page, demoEmail('cliente'));
  await expect(page).not.toHaveURL(/entrar/);
  await page.goto('/comunidade');
  const pant = page.getByTestId('post').filter({ hasText: 'Elétrica Pantanal (demo)' });
  await expect(pant.getByTestId('react-main')).toHaveText(/Valeu/);
  await expect(pant.getByTestId('react-main')).toHaveAttribute('aria-pressed', 'true');
  await pant.getByTestId('react-more').click();
  await pant.getByTestId('react-pick').getByRole('button', { name: 'Inspirou' }).click();
  await expect(pant.getByTestId('react-main')).toHaveText(/Inspirou/);
  await expect(pant.getByTestId('useful-count')).toHaveText('1 reação · Inspirou');
  await page.waitForLoadState('networkidle'); // a reação é gravada em segundo plano
  await page.reload();
  await expect(pant.getByTestId('react-main')).toHaveText(/Inspirou/);
  await pant.getByTestId('react-main').click();
  await expect(pant.getByTestId('react-main')).toHaveAttribute('aria-pressed', 'false');
  await expect(pant.getByTestId('useful-count')).toHaveText('');
  await expect(page.getByTestId('feed-end')).toHaveText('Você está em dia. Vai lá viver o seu dia.');
});

test('seguir: botão no perfil, contagem e aba "Quem eu sigo"', async ({ page }) => {
  await page.goto('/entrar');
  await login(page, demoEmail('cliente'));
  await expect(page).not.toHaveURL(/entrar/);
  await page.goto('/comunidade?seguindo=1');
  await expect(page.getByTestId('feed-empty-following')).toBeVisible();
  await page.goto('/comunidade');
  const pant = page.getByTestId('post').filter({ hasText: 'Elétrica Pantanal (demo)' });
  await pant.getByRole('link', { name: 'Ver perfil', exact: true }).click();
  await page.getByTestId('follow').click();
  await expect(page.getByTestId('follow')).toHaveText('Seguindo');
  await expect(page.getByTestId('followers')).toContainText('1');
  await page.goto('/comunidade');
  await page.getByTestId('tab-following').click();
  await expect(page).toHaveURL(/seguindo=1/);
  await expect(page.getByTestId('post')).toHaveCount(1);
  await expect(page.getByTestId('post')).toContainText('Elétrica Pantanal (demo)');
});

test('Feito pelo Próximo: do pedido concluído ao post com selo e nota', async ({ page }) => {
  const { data: carlos } = await admin.from('provider_profiles').select('id, city_id').eq('slug', 'carlos-demo').single();
  const { data: cli } = await admin.auth.admin.listUsers();
  const client = cli.users.find((u) => u.email === demoEmail('cliente'))!.id;
  const enc = (await admin.from('services').select('id').eq('slug', 'encanador').single()).data!.id;
  const nb = (await admin.from('neighborhoods').select('id').eq('city_id', carlos!.city_id).limit(1).single()).data!.id;
  const { data: bk } = await admin.from('bookings').insert({
    client_id: client, city_id: carlos!.city_id, neighborhood_id: nb, service_id: enc, scheduled_date: '2026-11-20', time_slot: 'manha',
    total_cents: 15000, payment_method: 'pix_na_entrega', provider_id: carlos!.id, status: 'concluido', completed_at: '2026-11-20T15:00:00Z',
  }).select('id').single();
  await admin.from('booking_reviews').insert({ booking_id: bk!.id, provider_id: carlos!.id, client_id: client, rating: 5 });

  await page.goto('/entrar');
  await login(page, demoEmail('prestador-carlos'));
  await expect(page).not.toHaveURL(/entrar/);
  await page.goto('/painel/pedidos');
  await page.getByTestId('show-work').first().click();
  await expect(page).toHaveURL(/pedido=/);
  await expect(page.getByLabel('Foi um pedido feito pelo Próximo?')).not.toHaveValue('');
  await page.getByTestId('post-photos').setInputFiles([{ name: 'obra.png', mimeType: 'image/png',
    buffer: await sharp({ create: { width: 300, height: 200, channels: 3, background: '#4f3cf0' } }).png().toBuffer() }]);
  await expect(page.getByTestId('picked')).toHaveCount(1);
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page).toHaveURL(/\/comunidade\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('proof')).toHaveText('Feito pelo Próximo · nota 5');
  await page.goto('/painel/pedidos');
  await expect(page.getByText('Já está no feed com o selo Feito pelo Próximo')).toBeVisible();
});

const photo = () => sharp({ create: { width: 400, height: 600, channels: 3, background: '#ff6b4a' } }).png().toBuffer();

test('dia a dia: cliente conta do dia com foto e aparece no filtro', async ({ page }) => {
  await page.goto('/entrar');
  await login(page, demoEmail('cliente'));
  await expect(page).not.toHaveURL(/entrar/);
  await page.goto('/publicar');
  await page.getByRole('button', { name: /Contar do meu dia/ }).click();
  await page.getByLabel('O que você quer contar?').fill('Primeiro dia no emprego novo! Obrigada a quem me indicou.');
  await page.getByTestId('post-photos').setInputFiles([{ name: 'dia.png', mimeType: 'image/png', buffer: await photo() }]);
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page).toHaveURL(/\/comunidade\/[0-9a-f-]+\?nova=1$/);
  await page.goto('/comunidade?tipo=dia_a_dia');
  const post = page.getByTestId('post').filter({ hasText: 'Primeiro dia no emprego novo!' });
  await expect(post).toHaveCount(1);
  await expect(post).toContainText('Dia a dia');
});

test('momentos: publica uma foto, aparece na faixa e quem vê tira o anel de novidade', async ({ browser, page }) => {
  await page.goto('/entrar');
  await login(page, demoEmail('cliente'));
  await expect(page).not.toHaveURL(/entrar/);
  await page.goto('/comunidade');
  await page.getByTestId('story-mine').click();
  await expect(page).toHaveURL(/\/momentos\/novo/);
  await page.getByTestId('story-photo').setInputFiles([{ name: 'momento.png', mimeType: 'image/png', buffer: await photo() }]);
  await page.getByLabel('Legenda (opcional)').fill('Café antes de começar');
  await page.getByRole('button', { name: 'Publicar momento' }).click();
  await expect(page.getByTestId('story-viewer')).toBeVisible();
  await expect(page.getByTestId('story-viewer')).toContainText('Café antes de começar');
  await expect(page.getByTestId('story-views')).toHaveText('Visto por 0 pessoas');

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto('/entrar');
  await login(other, demoEmail('prestador-carlos'));
  await expect(other).not.toHaveURL(/entrar/);
  await other.goto('/comunidade');
  const ring = other.getByTestId('story-author').filter({ hasText: 'Ana' });
  await expect(ring).toHaveAttribute('aria-label', /novos/);
  await ring.click();
  await expect(other.getByTestId('story-viewer')).toContainText('Café antes de começar');
  await other.waitForLoadState('networkidle');
  await other.goto('/comunidade');
  await expect(other.getByTestId('story-author').filter({ hasText: 'Ana' })).not.toHaveAttribute('aria-label', /novos/);
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId('story-views')).toHaveText('Visto por 1 pessoa');
});

test('aparência: escolher Escuro e voltar para Automático', async ({ page }) => {
  await page.goto('/comunidade');
  await page.getByTestId('theme-picker').getByRole('button', { name: 'Escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-picker').getByRole('button', { name: 'Automático' }).click();
  await expect(page.getByTestId('theme-picker').getByRole('button', { name: 'Automático' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // navegador de teste usa tema claro
});

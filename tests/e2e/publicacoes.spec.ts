import { test } from '@playwright/test';
import path from 'node:path';
import sharp from 'sharp';
import { demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

const FIX = path.join(process.cwd(), 'tests/e2e/fixtures');
const png = (color: string) => sharp({ create: { width: 300, height: 200, channels: 3, background: color } }).png().toBuffer();

test('visitante vê publicações; Útil e comentar pedem login', async ({ page }) => {
  await page.goto('/');
  const posts = page.getByTestId('post');
  await expect(posts.first()).toBeVisible();
  const pant = posts.filter({ hasText: 'Elétrica Pantanal (demo)' });
  await expect(pant).toContainText('Quadro de luz trocado');
  await expect(pant.getByTestId('useful-count')).toHaveText('👍 1 achou útil');
  await expect(pant.getByTestId('last-comment')).toContainText('Ana Cliente (demo)');
  // prestadores sem publicação continuam aparecendo depois
  await expect(page.getByTestId('feed-post').filter({ hasText: 'Carlos Hidráulica (demo)' })).toBeVisible();
  await pant.getByRole('button', { name: 'Útil' }).click();
  await expect(page).toHaveURL(/\/entrar\?motivo=util/);
  await page.goto('/');
  await page.getByTestId('post').filter({ hasText: 'Elétrica Pantanal (demo)' }).getByRole('link', { name: /Comentar/ }).click();
  await expect(page).toHaveURL(/\/publicacoes\/[0-9a-f-]+#comentar$/);
  await expect(page.getByTestId('comment')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Entre para comentar' })).toBeVisible();
});

test('prestador publica texto com fotos e depois um vídeo; limites avisados', async ({ page }) => {
  await page.goto('/entrar?next=%2Fpublicar');
  await login(page, demoEmail('prestador-carlos'));
  await expect(page).toHaveURL(/\/publicar$/);
  await page.getByLabel(/O que você fez/).fill('Troca de registro no Centro hoje cedo. Atendo ainda hoje!');
  await page.getByTestId('post-photos').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: await png('#0f5f73') },
    { name: 'b.png', mimeType: 'image/png', buffer: await png('#ea580c') },
  ]);
  await expect(page.getByRole('list', { name: 'Arquivos escolhidos' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '🎬 Vídeo' })).toBeDisabled(); // um vídeo OU fotos
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Publicado! Seu trabalho já aparece no início.')).toBeVisible();

  await page.getByTestId('post-video').setInputFiles(path.join(FIX, 'video-longo.mp4'));
  await expect(page.getByText('O vídeo deve ter até 60 segundos.')).toBeVisible();
  await page.getByTestId('post-video').setInputFiles(path.join(FIX, 'video-curto.mp4'));
  await page.getByLabel(/O que você fez/).fill('Vídeo do serviço de hoje.');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Publicado! Seu trabalho já aparece no início.')).toBeVisible();

  await page.goto('/');
  const first = page.getByTestId('post').first();
  await expect(first).toContainText('Vídeo do serviço de hoje.');
  const video = first.locator('video');
  await expect(video).toHaveAttribute('src', /\/post-media\/.+\.mp4$/);
  const src = await video.getAttribute('src');
  expect((await page.request.get(src!)).headers()['content-type']).toBe('video/mp4');
  const second = page.getByTestId('post').nth(1);
  await expect(second).toContainText('Troca de registro no Centro');
  await expect(second.locator('.gallery img')).toHaveCount(2);
  await expect(second.getByRole('button', { name: /WhatsApp/ })).toHaveCount(0); // não chama a si mesmo
  // perfil público mostra as publicações
  await page.goto('/p/carlos-demo');
  await expect(page.getByRole('heading', { name: 'Publicações' })).toBeVisible();
  await expect(page.getByTestId('post')).toHaveCount(2);
});

test('cliente sem nome cadastrado informa o nome, comenta e marca Útil; autor oculta; denúncia vai para a moderação', async ({ page, browser }) => {
  await page.goto('/');
  const ze = page.getByTestId('post').filter({ hasText: 'Zé Reformas (demo)' });
  await ze.getByRole('link', { name: /Comentar/ }).click();
  await expect(page).toHaveURL(/\/publicacoes\/[0-9a-f-]+#comentar$/);
  const postUrl = page.url().split('#')[0];
  await page.getByRole('link', { name: 'Entre para comentar' }).click();
  await login(page, demoEmail('candidata'));
  await expect(page).toHaveURL(postUrl);
  await page.getByLabel('Seu nome (aparece no comentário)').fill('Joana Exemplo');
  await page.getByLabel('Escreva um comentário').fill('Ficou muito bom o muro!');
  await page.getByRole('button', { name: 'Comentar' }).click();
  await expect(page.getByTestId('comment').filter({ hasText: 'Ficou muito bom o muro!' })).toContainText('Joana Exemplo');
  await expect(page.getByLabel('Seu nome (aparece no comentário)')).toHaveValue('Joana Exemplo'); // lembra o nome
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/publicacoes/'));
  await page.getByRole('button', { name: 'Útil' }).click();
  await expect(page.getByTestId('useful-count')).toHaveText('👍 1 achou útil');
  await saved; // a marcação é salva no servidor antes de recarregar
  await page.reload();
  await expect(page.getByRole('button', { name: 'Útil' })).toHaveAttribute('aria-pressed', 'true');
  // denuncia a publicação
  await page.getByText('Denunciar esta publicação').click();
  await page.getByLabel('Motivo da denúncia').selectOption({ label: 'Propaganda repetida (spam)' });
  await page.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.getByText('Denúncia enviada.')).toBeVisible();

  // o autor oculta o comentário
  const ctx = await browser.newContext();
  const autor = await ctx.newPage();
  await autor.goto(`/entrar?next=${encodeURIComponent(new URL(postUrl).pathname)}`);
  await login(autor, demoEmail('prestador-ze'));
  const c = autor.getByTestId('comment').filter({ hasText: 'Ficou muito bom o muro!' });
  await c.getByRole('button', { name: 'Ocultar' }).click();
  await expect(c).toContainText('oculto');
  await ctx.close();
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(postUrl);
  await expect(v.getByTestId('comment').filter({ hasText: 'Ficou muito bom o muro!' })).toHaveCount(0);
  await visitor.close();

  // moderação remove a publicação denunciada
  const adm = await browser.newContext();
  const a = await adm.newPage();
  await a.goto('/entrar?next=%2Fadmin%3Faba%3Dpublicacoes');
  await login(a, demoEmail('admin'));
  const card = a.getByTestId('denuncia-publicacao').filter({ hasText: 'Zé Reformas (demo)' });
  await card.getByLabel('Motivo (aparece no histórico)').fill('Propaganda repetida');
  await card.getByRole('button', { name: 'Remover publicação' }).click();
  await expect(a.getByTestId('denuncia-publicacao')).toHaveCount(0);
  await a.goto('/');
  await expect(a.getByTestId('post').filter({ hasText: 'Muro do vizinho' })).toHaveCount(0);
  await adm.close();
});

test('autor apaga a própria publicação', async ({ page }) => {
  await page.goto('/entrar?next=%2Fpublicar');
  await login(page, demoEmail('prestador-bia'));
  const mine = page.getByTestId('post').filter({ hasText: 'Faxina pós-obra' });
  await mine.getByRole('button', { name: 'Mais opções da publicação' }).click();
  await mine.getByRole('button', { name: 'Apagar publicação' }).click();
  await mine.getByRole('button', { name: 'Confirmar: apagar' }).click();
  await expect(page.getByTestId('post').filter({ hasText: 'Faxina pós-obra' })).toHaveCount(0);
});

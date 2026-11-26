import { test } from '@playwright/test';
import path from 'node:path';
import sharp from 'sharp';
import { admin, demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

const FIX = path.join(process.cwd(), 'tests/e2e/fixtures');
const png = (color: string) => sharp({ create: { width: 300, height: 200, channels: 3, background: color } }).png().toBuffer();

test('visitante lê a comunidade, filtra, abre o post e, ao salvar, entra e volta ao post', async ({ page }) => {
  // a comunidade fica em /comunidade (pelo menu e pelo Perfil), fora da tela inicial
  await page.goto('/comunidade');
  await expect(page.getByRole('heading', { name: 'Comunidade de Campo Grande' })).toBeVisible();
  const posts = page.getByTestId('post');
  await expect(posts).toHaveCount(4);
  const pant = posts.filter({ hasText: 'Elétrica Pantanal (demo)' });
  await expect(pant.getByTestId('useful-count')).toHaveText('1 reação · Valeu');
  await expect(pant.getByTestId('last-comment')).toContainText('Ana Cliente (demo)');
  await expect(pant).toContainText('Trabalho');
  await expect(posts.filter({ hasText: 'Bia Faxina' })).toContainText('Diária a partir de R$ 180');
  // filtro por tipo e por bairro (cidade inteira entra)
  await page.getByTestId('feed-tabs').getByRole('link', { name: 'Pedidos de indicação' }).click();
  await expect(page).toHaveURL(/tipo=pedido/);
  await expect(posts).toHaveCount(1);
  await page.goto('/comunidade');
  await page.getByText('Filtrar por categoria e bairro').click();
  await page.getByLabel('Bairro', { exact: true }).selectOption({ label: 'Tiradentes' });
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByTestId('active-filters')).toContainText('Tiradentes');
  await expect(posts).toHaveCount(2);
  await expect(posts.filter({ hasText: 'Quadro de luz trocado' })).toHaveCount(1); // atende a cidade toda
  await expect(posts.filter({ hasText: 'Troca de toda a tubulação' })).toHaveCount(0); // não atende o bairro
  // filtro vazio: um toque tira o filtro
  await page.goto('/comunidade?tipo=divulgacao&bairro=' + (await admin.from('neighborhoods').select('id').eq('slug', 'tiradentes').single()).data!.id);
  await expect(page.getByTestId('feed-empty-filter')).toBeVisible();
  await page.getByRole('link', { name: 'Tirar os filtros' }).click();
  await expect(posts).toHaveCount(4);
  // abrir o post e salvar sem conta
  await posts.filter({ hasText: 'Carlos Hidráulica' }).getByRole('link', { name: /Comentar/ }).click();
  await expect(page).toHaveURL(/\/comunidade\/[0-9a-f-]+#comentar$/);
  const postPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page).toHaveURL(/\/entrar\?motivo=salvar/);
  await expect(page.getByText('Entre para salvar a publicação.')).toBeVisible();
  await login(page, demoEmail('cliente'));
  await expect(page).toHaveURL(new RegExp(`${postPath}$`));
  const save = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByRole('button', { name: /Salvo/ })).toHaveAttribute('aria-pressed', 'true');
  await save;
  await page.goto('/favoritos?aba=publicacoes');
  await expect(page.getByTestId('post').filter({ hasText: 'Carlos Hidráulica' })).toBeVisible();
});

test('galeria: antes e depois na ordem escolhida, com setas e teclado', async ({ page }) => {
  await page.goto('/comunidade?tipo=trabalho');
  const carlos = page.getByTestId('post').filter({ hasText: 'Carlos Hidráulica' });
  await expect(carlos.locator('.ba-tag')).toHaveText(['Antes', 'Depois']);
  await carlos.getByRole('button', { name: /Abrir foto 1 de 3/ }).click();
  const dlg = page.getByRole('dialog', { name: /Fotos da publicação/ });
  await expect(dlg.getByRole('img')).toHaveAttribute('alt', /Foto 1 de 3 .*\(Antes\)/);
  await page.keyboard.press('ArrowRight');
  await expect(dlg.getByRole('img')).toHaveAttribute('alt', /Foto 2 de 3 .*\(Depois\)/);
  await dlg.getByRole('button', { name: 'Próxima foto' }).click();
  await expect(dlg).toContainText('3 de 3');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('prestador mostra um trabalho com antes e depois, reordena, publica e edita', async ({ page }) => {
  await page.goto('/entrar?next=%2Fpublicar');
  await login(page, demoEmail('prestador-carlos'));
  await expect(page).toHaveURL(/\/publicar$/);
  await page.getByRole('button', { name: /Mostrar um trabalho/ }).click();
  await expect(page.getByLabel('Serviço', { exact: true })).toHaveValue(/\d+/);
  await page.getByLabel(/Conte o que foi feito/).fill('Troca de registro no Centro. Antes vazava, agora está novo.');
  await page.getByTestId('post-photos').setInputFiles([
    { name: 'depois.png', mimeType: 'image/png', buffer: await png('#0f5f73') },
    { name: 'antes.png', mimeType: 'image/png', buffer: await png('#ea580c') },
  ]);
  await expect(page.getByTestId('picked')).toHaveCount(2);
  await page.getByRole('button', { name: 'Mover foto 2 para trás' }).click(); // a de antes vira a capa
  await page.getByLabel('Rótulo da foto 1').selectOption('antes');
  await page.getByLabel('Rótulo da foto 2').selectOption('depois');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page).toHaveURL(/\/comunidade\/[0-9a-f-]+\?nova=1$/);
  await expect(page.getByText('Publicado!')).toBeVisible();
  const post = page.getByTestId('post');
  await expect(post.locator('.ba-tag')).toHaveText(['Antes', 'Depois']);
  await expect(post.getByRole('button', { name: /WhatsApp/ })).toHaveCount(0); // não chama a si mesmo
  // editar pelo menu
  await post.getByRole('button', { name: 'Mais opções da publicação' }).click();
  await post.getByRole('link', { name: 'Editar publicação' }).click();
  await page.getByLabel(/Conte o que foi feito/).fill('Troca de registro no Centro (texto corrigido).');
  await page.getByRole('button', { name: 'Tirar foto 2' }).click();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByTestId('post')).toContainText('texto corrigido');
  await expect(page.getByTestId('post')).toContainText('editado');
  await expect(page.getByTestId('post').locator('.gallery img')).toHaveCount(1);
  // outra conta tenta editar
  const editUrl = page.url().replace(/\?.*$/, '') + '/editar';
  await page.goto('/minhas-publicacoes');
  await expect(page.getByTestId('post').filter({ hasText: 'texto corrigido' })).toBeVisible();
  await page.context().clearCookies();
  await page.goto('/entrar?next=' + encodeURIComponent(new URL(editUrl).pathname));
  await login(page, demoEmail('prestador-bia'));
  await expect(page.getByTestId('edit-denied')).toContainText('Acesso restrito');
});

test('vídeo curto: limite de duração avisado e vídeo publicado', async ({ page }) => {
  await page.goto('/entrar?next=%2Fpublicar%3Ftipo%3Dtrabalho');
  await login(page, demoEmail('prestador-carlos'));
  await page.getByTestId('post-video').setInputFiles(path.join(FIX, 'video-longo.mp4'));
  await expect(page.getByText('O vídeo deve ter até 60 segundos.')).toBeVisible();
  await page.getByTestId('post-video').setInputFiles(path.join(FIX, 'video-curto.mp4'));
  await page.getByLabel(/Conte o que foi feito/).fill('Vídeo do serviço de hoje.');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page).toHaveURL(/\/comunidade\//);
  const video = page.getByTestId('post').locator('video');
  await expect(video).toHaveAttribute('src', /\/object\/sign\/post-media\/.+\.mp4\?token=/);
  expect((await page.request.get((await video.getAttribute('src'))!)).headers()['content-type']).toBe('video/mp4');
});

test('morador pede indicação, recebe indicação de perfil e marca "Indicação encontrada"', async ({ page, browser }) => {
  await page.goto('/entrar?next=%2Fpublicar%3Ftipo%3Dpedido%26categoria%3Dconstrucao-e-reformas');
  await login(page, demoEmail('candidata'));
  await expect(page.getByLabel('Categoria', { exact: true })).toHaveValue(/\d+/); // sugerida pelo filtro
  await expect(page.getByTestId('first-post-notice')).toBeVisible();
  await page.getByLabel('Do que você precisa?').fill('Preciso rebocar um muro pequeno no fundo de casa.');
  await page.getByLabel('Bairro', { exact: true }).selectOption({ label: 'Centro' });
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Informe seu nome público.')).toBeVisible();
  await expect(page.getByLabel('Do que você precisa?')).toHaveValue(/rebocar/); // campos preservados
  await page.getByLabel('Seu nome público').fill('Joana do Centro');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page).toHaveURL(/\/comunidade\/[0-9a-f-]+\?nova=1$/);
  const postUrl = page.url().replace(/\?.*$/, '');
  await expect(page.getByTestId('post')).toContainText('Joana do Centro');

  // outro membro indica um prestador e responde
  const ctx = await browser.newContext();
  const o = await ctx.newPage();
  await o.goto(`/entrar?next=${encodeURIComponent(new URL(postUrl).pathname)}`);
  await login(o, demoEmail('cliente'));
  await o.getByLabel('Indique alguém ou comente').fill('Conheço uma ótima equipe!');
  await o.getByLabel(/Indicar um prestador/).fill('Hidro');
  await o.getByRole('button', { name: /Hidro Cidade/ }).click();
  await expect(o.getByTestId('picked-provider')).toContainText('Hidro Cidade');
  await o.getByRole('button', { name: 'Comentar' }).click();
  await expect(o.getByTestId('recommended')).toContainText('Indicou Hidro Cidade');
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId('recommended')).toBeVisible();
  await page.getByRole('button', { name: 'Responder' }).click();
  await page.getByLabel('Sua resposta').fill('Obrigada, vou chamar!');
  await page.getByRole('button', { name: 'Responder', exact: true }).last().click();
  await expect(page.getByTestId('comment').filter({ hasText: 'Obrigada, vou chamar!' }).last()).toContainText('Joana do Centro'); // resposta dentro do comentário
  await page.getByRole('button', { name: 'Marcar: indicação encontrada' }).click();
  await expect(page.getByTestId('found')).toBeVisible();
  await page.goto('/comunidade?tipo=pedido');
  await expect(page.getByTestId('post').filter({ hasText: 'Joana do Centro' }).getByTestId('found')).toBeVisible();
});

test('denúncia vai para a moderação; ocultar tira o post e a mídia do ar', async ({ page, browser }) => {
  await page.goto('/comunidade?tipo=divulgacao');
  await page.getByTestId('post').filter({ hasText: 'Bia Faxina' }).getByRole('link', { name: /Comentar/ }).click();
  await expect(page).toHaveURL(/\/comunidade\/[0-9a-f-]+#comentar$/);
  const postUrl = page.url().split('#')[0];
  const img = await page.getByTestId('post').locator('.gallery img').first().getAttribute('src');
  await page.goto(`/entrar?next=${encodeURIComponent(new URL(postUrl).pathname)}`);
  await login(page, demoEmail('cliente'));
  await page.getByText('Denunciar esta publicação').click();
  await page.getByLabel('Motivo da denúncia').selectOption({ label: 'Propaganda repetida (spam)' });
  await page.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.getByText('Denúncia enviada.')).toBeVisible();

  const adm = await browser.newContext();
  const a = await adm.newPage();
  await a.goto('/entrar?next=%2Fadmin%3Faba%3Dpublicacoes');
  await login(a, demoEmail('admin'));
  const card = a.getByTestId('denuncia-publicacao').filter({ hasText: 'Bia Faxina (demo)' });
  await card.getByLabel('Motivo (aparece no histórico)').fill('Propaganda repetida');
  await card.getByRole('button', { name: 'Ocultar publicação' }).click();
  await expect(a.getByTestId('denuncia-publicacao')).toHaveCount(0);
  await adm.close();

  const v = await (await browser.newContext()).newPage();
  await v.goto(postUrl);
  await expect(v.getByTestId('post-unavailable')).toBeVisible();
  await v.getByRole('link', { name: 'Voltar à comunidade' }).click();
  await expect(v.getByTestId('post').filter({ hasText: 'Bia Faxina' })).toHaveCount(0);
  expect(img).toBeTruthy();
});

test('autor apaga a própria publicação em Minhas publicações', async ({ page }) => {
  await page.goto('/entrar?next=%2Fminhas-publicacoes');
  await login(page, demoEmail('prestador-pantanal'));
  const mine = page.getByTestId('post').filter({ hasText: 'Quadro de luz' });
  await mine.getByRole('button', { name: 'Mais opções da publicação' }).click();
  await mine.getByRole('button', { name: 'Apagar publicação' }).click();
  await mine.getByRole('button', { name: 'Confirmar: apagar' }).click();
  await expect(page.getByTestId('post').filter({ hasText: 'Quadro de luz' })).toHaveCount(0);
});

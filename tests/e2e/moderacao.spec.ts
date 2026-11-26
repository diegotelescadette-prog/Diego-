import { test } from '@playwright/test';
import { admin, demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

test('texto ofensivo pede carinho e o que foi escrito continua no campo', async ({ page }) => {
  await page.goto('/entrar?next=%2Fpublicar%3Ftipo%3Ddia_a_dia');
  await login(page, demoEmail('cliente'));
  await expect(page).toHaveURL(/\/publicar/);
  const body = page.locator('#post-body');
  await body.fill('Que merda de chuva hoje');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText(/Quer reescrever com mais carinho\?/).first()).toBeVisible();
  await expect(body).toHaveValue('Que merda de chuva hoje');
});

test('sino mostra as novas e a lista explica cada uma', async ({ page }) => {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = (l: string) => users.users.find((u) => u.email === demoEmail(l))!.id;
  await admin.from('notifications').delete().eq('user_id', id('prestador-pantanal'));
  const { data: post } = await admin.from('posts').select('id').eq('author_id', id('prestador-pantanal')).limit(1).single();
  await admin.from('post_comments').insert({ post_id: post!.id, author_id: id('cliente'), body: 'Trabalho caprichado!' });
  await page.goto('/entrar');
  await login(page, demoEmail('prestador-pantanal'));
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'));
  await page.goto('/comunidade');
  await expect(page.getByTestId('bell-count').first()).toHaveText('1');
  await page.getByTestId('bell').first().click();
  await expect(page.getByTestId('notifications')).toContainText('Ana Cliente (demo) comentou na sua publicação.');
  await page.goto('/comunidade');
  await expect(page.getByTestId('bell-count')).toHaveCount(0);
});

test('equipe adiciona e remove palavra bloqueada', async ({ page }) => {
  await page.goto('/entrar?next=%2Fadmin%3Faba%3Dpalavras');
  await login(page, demoEmail('admin'));
  await expect(page.getByTestId('blocked-word').filter({ hasText: /^merda$/ })).toBeVisible();
  await page.getByLabel('Nova palavra ou expressão').fill('Jabuticába Podre');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('status')).toHaveText('Palavra adicionada.');
  await page.getByRole('button', { name: 'Remover jabuticaba podre' }).click();
  await expect(page.getByRole('status')).toHaveText('Palavra removida da lista.');
});

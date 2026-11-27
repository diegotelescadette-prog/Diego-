import { test } from '@playwright/test';
import { admin, demoEmail, enter, expect, fillSignup, lastMailLink, login, reseed } from './helpers';

test.beforeAll(reseed);

test('cadastro em uma tela: erros ao lado do campo, confirma o e-mail e escolhe o primeiro destino', async ({ page }, info) => {
  const email = `cad-${info.project.name}-${Date.now()}@teste.resolveaqui.test`;
  // sem conta, qualquer link leva ao login; de lá, "Criar conta" guarda o destino
  await page.goto('/agenda');
  await expect(page).toHaveURL(/\/entrar\?next=%2Fagenda$/);
  await page.goto('/cadastrar');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.locator('#nome_completo-error')).toContainText('nome completo');
  await expect(page.locator('#celular-error')).toContainText('celular com DDD');
  await expect(page.locator('#bairro-error')).toContainText('bairro');
  await expect(page.locator('#aceite-error')).toContainText('Termos de uso');
  await expect(page.getByTestId('aceite-resumo')).toContainText('só aparece com o aceite das duas partes');
  await fillSignup(page, { publico: 'Otário' });
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.locator('#nome_publico-error')).toContainText('carinho');
  await expect(page.getByLabel('Nome completo')).toHaveValue('Maria Teste da Silva'); // o que foi escrito continua
  await page.getByLabel('Nome público').fill('Maria do Centro');
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page).toHaveURL(/verifique-email/);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = data.users.find((u) => u.email === email)!.id;
  const { data: acc } = await admin.from('member_accounts').select('phone, neighborhood_id, terms_accepted_at').eq('user_id', id).single();
  expect(acc!.phone).toBe('67998765432');
  expect(acc!.terms_accepted_at).toBeTruthy();
  await page.goto(await lastMailLink(email, 'signup'));
  await expect(page).toHaveURL(/\/boas-vindas$/);
  await expect(page.getByTestId('primeiro-destino').getByRole('button')).toHaveCount(6);
  await page.getByTestId('goal-emprego').click();
  await expect(page).toHaveURL(/\/vagas$/);
  expect((await admin.from('member_accounts').select('first_goal').eq('user_id', id).single()).data!.first_goal).toBe('emprego');
});

test('conta antiga completa o cadastro uma vez e volta para onde ia', async ({ page }, info) => {
  const email = `antiga-${info.project.name}-${Date.now()}@teste.resolveaqui.test`;
  await admin.auth.admin.createUser({ email, password: 'senha-antiga-1', email_confirm: true });
  await page.goto('/entrar?next=%2Fcomunidade');
  await login(page, email, 'senha-antiga-1');
  await expect(page).toHaveURL(/\/completar-cadastro\?next=%2Fcomunidade$/);
  await fillSignup(page, { celular: '123' });
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(page.locator('#celular-error')).toBeVisible();
  await page.getByLabel('Celular com WhatsApp').fill('(67) 99123-4567');
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(page).toHaveURL(/\/comunidade$/);
  await page.goto('/agenda');
  await expect(page).toHaveURL(/\/agenda$/);
});

test('com conta, Termos e Privacidade explicam o uso dos dados', async ({ page }) => {
  await enter(page, '/termos', 'cliente');
  await expect(page.getByRole('heading', { name: 'Termos de uso' })).toBeVisible();
  await page.goto('/privacidade');
  await expect(page.getByText('Cadastro (todas as contas)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Termos de uso' }).last()).toBeVisible();
  void demoEmail;
});

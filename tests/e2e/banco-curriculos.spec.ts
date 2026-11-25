import { test, type Page } from '@playwright/test';
import { demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

const PDF = { name: 'Meu Currículo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') };

async function signInAs(page: Page, who: string, next: string) {
  await page.goto(`/entrar?next=${encodeURIComponent(next)}`);
  await login(page, demoEmail(who));
  await expect(page).toHaveURL(new RegExp(next.replace(/[/?]/g, '\\$&') + '$'));
}

test('vagas: duas áreas, Oferecer trabalho e Enviar currículo', async ({ page }) => {
  await page.goto('/vagas');
  await expect(page.getByTestId('area-oferecer').getByRole('heading', { name: 'Oferecer trabalho' })).toBeVisible();
  await expect(page.getByTestId('area-curriculo').getByRole('heading', { name: 'Enviar currículo' })).toBeVisible();
  await page.getByTestId('area-curriculo').getByRole('link', { name: 'Deixar meu currículo' }).click();
  await expect(page).toHaveURL(/\/entrar\?next=(%2F|\/)vagas(%2F|\/)meu-curriculo/);
});

test('candidato deixa o currículo no banco, oculta e mostra de novo', async ({ page }) => {
  await signInAs(page, 'cliente', '/vagas/meu-curriculo');
  await page.getByLabel('Nome completo').fill('Carla Teste Souza');
  await page.getByRole('button', { name: 'Enviar meu currículo' }).click();
  await expect(page.getByText('Informe a área ou o cargo que procura')).toBeVisible();
  await expect(page.getByText('Anexe seu currículo em PDF')).toBeVisible();
  await page.getByLabel('Que trabalho você procura?').fill('Recepcionista');
  await page.getByLabel(/Bairro onde mora/).selectOption({ label: 'Centro' });
  await page.getByLabel(/WhatsApp/).fill('(67) 98888-1234');
  await page.getByLabel(/Currículo \(PDF/).setInputFiles(PDF);
  await page.getByRole('checkbox', { name: /Autorizo que/ }).check();
  await page.getByRole('button', { name: 'Enviar meu currículo' }).click();
  await expect(page.getByRole('status')).toContainText('Currículo salvo no banco');
  await expect(page.getByTestId('meu-banco')).toContainText('Visível para quem está contratando');
  await page.getByRole('button', { name: 'Ocultar do banco' }).click();
  await expect(page.getByTestId('meu-banco')).toContainText('Oculto');
  await page.getByRole('button', { name: 'Mostrar de novo' }).click();
  await expect(page.getByTestId('meu-banco')).toContainText('Visível');
});

test('quem tem vaga aberta consulta o banco e baixa; sem vaga, o banco fica fechado', async ({ page, browser }) => {
  await signInAs(page, 'empresa', '/vagas/banco');
  await expect(page.getByTestId('talento').filter({ hasText: 'Carla Teste Souza' })).toContainText('Recepcionista');
  await page.getByLabel('Cargo ou experiência').fill('recepcionista');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page).toHaveURL(/q=recepcionista/);
  const card = page.getByTestId('talento').filter({ hasText: 'Carla Teste Souza' });
  await expect(card.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', /wa\.me\/5567988881234/);
  const href = await card.getByRole('link', { name: 'Baixar currículo' }).getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signInAs(p2, 'prestador-carlos', '/vagas/banco');
  await expect(p2.getByTestId('banco-bloqueado')).toContainText('uma vaga aberta');
  expect((await p2.request.get(href!)).status()).toBe(404);
  await other.close();
});

test('candidato apaga o currículo do banco', async ({ page }) => {
  await signInAs(page, 'cliente', '/vagas/meu-curriculo');
  await page.getByRole('button', { name: 'Apagar currículo' }).click();
  await expect(page.getByRole('status')).toContainText('Currículo apagado');
  await expect(page.getByTestId('meu-banco')).toHaveCount(0);
});

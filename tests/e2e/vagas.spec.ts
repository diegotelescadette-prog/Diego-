import { test, type Page } from '@playwright/test';
import { admin, demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

const PDF = { name: 'Currículo Ana.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') };
const FAKE = { name: 'curriculo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>não é PDF</html>') };

async function signInAs(page: Page, who: string, next: string) {
  await page.goto(`/entrar?next=${encodeURIComponent(next)}`);
  await login(page, demoEmail(who));
  await expect(page).toHaveURL(new RegExp(next.replace(/[/?]/g, '\\$&') + '$'));
}

test('empresa publica vaga: valida campos e cai no painel da vaga', async ({ page }, info) => {
  const title = `Atendente ${info.project.name}`;
  await signInAs(page, 'empresa', '/vagas/nova');
  await page.getByLabel('Cargo').fill('A');
  await page.getByRole('button', { name: 'Publicar vaga' }).click();
  await expect(page.getByText('Informe o cargo, ex.: Auxiliar de cozinha')).toBeVisible();
  await expect(page.getByText('Confirme as regras para publicar').or(page.getByText('Descreva a vaga em pelo menos 20 caracteres'))).toBeVisible();

  await page.getByLabel('Cargo').fill(title);
  await page.getByLabel('Empresa ou contratante').fill('Padaria Teste');
  await page.getByLabel('Tipo de contratação').selectOption('clt');
  await page.getByLabel(/Bairro/).selectOption({ label: 'Centro' });
  await page.getByLabel(/Salário/).fill('R$ 1.800');
  await page.getByLabel('Descrição da vaga').fill('Atendimento no balcão, caixa e reposição. Das 6h às 14h, segunda a sábado.');
  await page.getByRole('checkbox', { name: /não vou cobrar nada/ }).check();
  await page.getByRole('button', { name: 'Publicar vaga' }).click();
  await expect(page).toHaveURL(/\/minhas-vagas\/[0-9a-f-]{36}\?msg=/);
  await expect(page.getByRole('status')).toContainText('Vaga publicada');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Ninguém se candidatou ainda.')).toBeVisible();

  await page.goto('/vagas?q=atendente');
  await expect(page.getByTestId('job-card').filter({ hasText: title })).toContainText('Centro, Campo Grande–MS');
});

test('candidato entra, envia currículo em PDF com consentimento e acompanha', async ({ page }) => {
  await page.goto('/vagas');
  await page.getByTestId('job-card').filter({ hasText: 'Auxiliar de cozinha (demo)' }).click();
  await expect(page.getByRole('heading', { name: 'Auxiliar de cozinha (demo)' })).toBeVisible();
  await page.getByRole('link', { name: 'Entrar para se candidatar' }).click();
  await login(page, demoEmail('cliente'));
  await expect(page).toHaveURL(/\/vagas\/[0-9a-f-]{36}$/);

  await page.getByLabel('Nome completo').fill('Ana Teste da Silva');
  await page.getByRole('button', { name: 'Enviar candidatura' }).click();
  await expect(page.getByText('Anexe seu currículo em PDF')).toBeVisible();
  await expect(page.getByText(/autorize o envio dos seus dados/)).toBeVisible();

  await page.getByLabel(/Currículo \(PDF/).setInputFiles(FAKE);
  await page.getByRole('checkbox', { name: /Autorizo o envio/ }).check();
  await page.getByRole('button', { name: 'Enviar candidatura' }).click();
  await expect(page.getByText('O arquivo precisa ser um PDF')).toBeVisible();

  await page.getByLabel(/WhatsApp/).fill('(67) 99999-1234');
  await page.getByLabel(/Currículo \(PDF/).setInputFiles(PDF);
  await page.getByRole('button', { name: 'Enviar candidatura' }).click();
  await expect(page.getByTestId('candidatura-ok')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('ja-candidatou')).toContainText('Recebida');
  await page.goto('/minhas-candidaturas');
  await expect(page.getByTestId('minha-candidatura')).toContainText('Auxiliar de cozinha (demo)');
  await expect(page.getByTestId('minha-candidatura')).toContainText('Currículo Ana.pdf');
});

test('quem publicou vê o candidato, baixa o PDF e a situação muda; outra conta não baixa', async ({ page, browser }) => {
  await signInAs(page, 'empresa', '/minhas-vagas');
  const row = page.getByTestId('minha-vaga').filter({ hasText: 'Auxiliar de cozinha (demo)' });
  await expect(row).toContainText('1 novo');
  await row.click();
  const card = page.getByTestId('candidato');
  await expect(card).toContainText('Ana Teste da Silva');
  await expect(card).toContainText('Recebida');
  await expect(card.getByRole('link', { name: /WhatsApp \(67\) 99999-1234/ })).toHaveAttribute('href', /wa\.me\/5567999991234/);
  const href = await card.getByTestId('baixar-curriculo').getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['content-disposition']).toContain('attachment');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.reload();
  await expect(page.getByTestId('candidato')).toContainText('Currículo visto');

  await page.getByLabel('Situação').selectOption('em_contato');
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByTestId('candidato')).toContainText('Em contato');

  // outra conta (prestador) e visitante não baixam
  const other = await browser.newContext();
  const p2 = await other.newPage();
  expect((await p2.request.get(href!)).status()).toBe(401);
  await signInAs(p2, 'prestador-carlos', '/');
  expect((await p2.request.get(href!)).status()).toBe(404);
  await other.close();
});

test('candidato retira a candidatura e o currículo é apagado', async ({ page }) => {
  await signInAs(page, 'cliente', '/minhas-candidaturas');
  const { data: before } = await admin.from('job_applications').select('id, resume_path');
  expect(before!.length).toBe(1);
  await page.getByRole('button', { name: 'Retirar candidatura e apagar currículo' }).click();
  await expect(page.getByRole('status')).toContainText('Candidatura retirada');
  await expect(page.getByText('Você ainda não se candidatou a nenhuma vaga.')).toBeVisible();
  const { data: after } = await admin.from('job_applications').select('id');
  expect(after!.length).toBe(0);
  const { error } = await admin.storage.from('curriculos').download(before![0].resume_path);
  expect(error).toBeTruthy();
});

test('visitante: vagas no menu e páginas privadas pedem login', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.getByRole('navigation', { name: 'Navegação rápida' }).getByRole('link', { name: 'Vagas' }).click();
  else await page.getByRole('navigation', { name: 'Para quem busca' }).getByRole('link', { name: 'Vagas de emprego' }).click();
  await expect(page).toHaveURL(/\/vagas$/);
  await expect(page.getByTestId('vagas-total')).toContainText('vagas abertas');
  await page.goto('/minhas-candidaturas');
  await expect(page).toHaveURL(/\/entrar\?next=%2Fminhas-candidaturas/);
});

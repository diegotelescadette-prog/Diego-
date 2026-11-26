import { test } from '@playwright/test';
import { admin, demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

test('prestador preenche a verificação do perfil e envia para análise', async ({ page }) => {
  await page.goto('/entrar?next=/painel');
  await login(page, demoEmail('prestador-marcos'));
  await expect(page.getByTestId('panel-verification')).toContainText('Rascunho');
  await page.getByTestId('panel-verification').getByRole('link', { name: 'Começar verificação' }).click();
  await expect(page).toHaveURL(/\/painel\/verificacao$/);
  await expect(page.getByTestId('verif-label')).toHaveText('Rascunho');
  await expect(page.getByTestId('privacy-notice')).toContainText('Não fazemos consulta de processos ou antecedentes');
  await page.getByLabel('Nome completo').fill('Marcos Exemplo da Silva');
  await page.getByLabel('Tempo de experiência (anos)').fill('7');
  const r1 = page.getByTestId('ref-1');
  await r1.getByLabel('Nome do cliente').fill('Dona Teresa');
  await r1.getByLabel('WhatsApp do cliente (com DDD)').fill('(67) 99999-1234');
  await r1.getByLabel('Serviço realizado').fill('Troca da torneira da cozinha');
  // sem os consentimentos, não envia e mantém o que foi digitado
  await page.getByRole('button', { name: 'Enviar para análise' }).click();
  await expect(page.getByTestId('verif-error')).toContainText('avisou');
  await expect(r1.getByLabel('Nome do cliente')).toHaveValue('Dona Teresa');
  await page.getByLabel(/Avisei essas pessoas/).check();
  await page.getByLabel(/Li o aviso/).check();
  await page.getByRole('button', { name: 'Enviar para análise' }).click();
  await expect(page.getByTestId('verif-ok')).toContainText('Enviado para análise');
  await page.reload();
  await expect(page.getByTestId('verif-label')).toHaveText('Em análise');
  await expect(page.getByTestId('ref-1')).toContainText('A conferir');
});

test('equipe confere na fila, aprova e o perfil passa a contar no lançamento com selos', async ({ page }) => {
  await page.goto('/entrar?next=%2Fadmin%3Faba%3Dlancamento');
  await login(page, demoEmail('admin'));
  await expect(page.getByRole('heading', { name: 'Preparar lançamento' })).toBeVisible();
  const row = page.locator('[data-testid="launch-row"][data-service="diarista"]');
  await expect(row.getByRole('link', { name: /aptos em Diarista/ })).toHaveText('0');
  await expect(row).toContainText('Sem prestador');
  await expect(page.getByTestId('rule-off')).toBeVisible();
  // linha de crédito: pronta, mas com a categoria desligada
  await expect(page.locator('[data-testid="launch-row"][data-service="financiamento-imobiliario"]')).toContainText('categoria desligada');

  await row.getByRole('link', { name: /em análise em Diarista/ }).click();
  await expect(page.getByTestId('admin-provider')).toHaveCount(1);
  await page.getByTestId('admin-provider').getByRole('link', { name: 'Conferir cadastro' }).click();
  await expect(page.getByRole('heading', { name: 'Bia Faxina (demo)' })).toBeVisible();
  await expect(page.getByTestId('admin-verif-status')).toHaveText('Em análise');
  await page.getByRole('button', { name: 'Aprovar cadastro' }).click();
  await expect(page.getByRole('status')).toContainText('Para aprovar');
  await page.getByRole('button', { name: 'Marcar identidade conferida' }).click();
  await expect(page.getByRole('status')).toContainText('Identidade conferida');
  await page.getByRole('button', { name: 'Marcar WhatsApp conferido' }).click();
  await expect(page.getByRole('status')).toContainText('WhatsApp conferido');
  await page.getByTestId('admin-ref').first().getByRole('button', { name: 'Confirmou o serviço' }).click();
  await expect(page.getByRole('status')).toContainText('Referência confirmada');
  await page.getByRole('button', { name: 'Aprovar cadastro' }).click();
  await expect(page.getByTestId('admin-verif-status')).toHaveText('Aprovado');

  await page.goto('/admin?aba=lancamento');
  await expect(page.locator('[data-testid="launch-row"][data-service="diarista"]').getByRole('link', { name: /aptos em Diarista/ })).toHaveText('1');

  // selos no perfil e no post
  const v = await (await page.context().browser()!.newContext()).newPage();
  await v.goto('/p/bia-demo');
  await expect(v.getByTestId('profile-badges')).toContainText('Identidade conferida');
  await expect(v.getByTestId('profile-badges')).toContainText('1 referência conferida');
  await expect(v.getByTestId('profile-badges')).toContainText('Experiência informada: 5 anos');
  await v.getByText('O que os selos significam').click();
  await expect(v.getByTestId('badges-explained')).toContainText('Não são garantia');
  await v.goto('/comunidade?tipo=divulgacao');
  await expect(v.getByTestId('post').filter({ hasText: 'Bia Faxina' }).getByTestId('post-badges')).toContainText('Identidade conferida');
});

test('pendência aparece para o prestador com o motivo', async ({ page }) => {
  await page.goto('/entrar?next=/painel/verificacao');
  await login(page, demoEmail('prestador-joana'));
  await expect(page.getByTestId('verif-label')).toHaveText('Pendência');
  await expect(page.getByTestId('verif-next')).toContainText('não confirmou o serviço');
  await expect(page.getByRole('button', { name: 'Reenviar para análise' })).toBeVisible();
});

test('conta sem permissão não abre documentos e contatos de referência', async ({ page }) => {
  const id = (await admin.from('provider_profiles').select('id').eq('slug', 'carlos-demo').single()).data!.id;
  await page.goto(`/entrar?next=${encodeURIComponent(`/admin/verificacao/${id}`)}`);
  await login(page, demoEmail('cliente'));
  await expect(page.getByTestId('acesso-restrito')).toBeVisible();
  await expect(page.getByText('Cliente 1 de')).toHaveCount(0);
});

test('serviço sem prestador mostra que estamos cadastrando', async ({ page }) => {
  await page.goto('/buscar?servico=marceneiro');
  await expect(page.getByTestId('cadastrando')).toHaveText('Estamos cadastrando profissionais para este serviço.');
});

test('crédito imobiliário: oculto até a aprovação; depois mostra quem atende e o canal oficial', async ({ page }) => {
  await page.goto('/p/ana-demo');
  await expect(page.getByTestId('canal-oficial')).toHaveCount(0);
  await page.goto('/buscar?q=financiamento');
  await expect(page.getByTestId('empty-search')).toBeVisible();

  await page.goto('/entrar?next=%2Fadmin%3Faba%3Dcatalogo');
  await login(page, demoEmail('admin'));
  const cat = page.locator('details').filter({ hasText: 'Crédito imobiliário' });
  await cat.locator('summary').click();
  await expect(cat.getByTestId('credit-gate')).toContainText('Banco Central');
  await cat.getByRole('button', { name: 'Habilitar categoria (após aprovação)' }).click();
  await expect(page.locator('details').filter({ hasText: 'Crédito imobiliário' }).locator('summary')).not.toContainText('desativada');

  const v = await (await page.context().browser()!.newContext()).newPage();
  await v.goto('/buscar?q=financiamento');
  await expect(v.getByTestId('result-count')).toHaveText('1 prestador encontrado');
  await expect(v.getByRole('button', { name: /Ana Crédito/ })).toBeVisible();
  await v.goto('/p/ana-demo');
  await expect(v.getByTestId('official-channel')).toContainText('correspondente de Banco Exemplo S.A. (demo)');
  await expect(v.getByTestId('credit-notice')).toContainText('canal oficial');
  const link = v.getByTestId('canal-oficial');
  await expect(link).toHaveAttribute('href', /\/api\/canal\/[0-9a-f-]+$/);
  const res = await v.request.get((await link.getAttribute('href'))!, { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()['location']).toBe('https://www.bcb.gov.br/meubc/encontreinstituicao');
  await admin.from('service_categories').update({ active: false }).eq('slug', 'credito-imobiliario');
});

test('regra de verificação: prévia do impacto e liga/desliga pela configuração', async ({ page }) => {
  await page.goto('/entrar?next=%2Fadmin%3Faba%3Dconfig');
  await login(page, demoEmail('admin'));
  await expect(page.getByTestId('rule-preview')).toContainText('perfis publicados');
  await page.getByTestId('rule-form').getByLabel('Exigir verificação aprovada para aparecer').check();
  await page.getByTestId('rule-form').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status')).toContainText('Regra de verificação ligada');
  const v = await (await page.context().browser()!.newContext()).newPage();
  await v.goto('/buscar?servico=chaveiro');
  await expect(v.getByTestId('cadastrando')).toBeVisible();
  await v.goto('/buscar?servico=encanador');
  await expect(v.getByRole('button', { name: /Carlos Hidráulica/ })).toBeVisible();
  await page.getByTestId('rule-form').getByLabel('Exigir verificação aprovada para aparecer').uncheck();
  await page.getByTestId('rule-form').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status')).toContainText('desligada');
});

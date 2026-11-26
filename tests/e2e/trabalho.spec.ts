import { test, type Page } from '@playwright/test';
import { admin, demoEmail, expect, login, reseed, enter } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

async function signInAs(page: Page, who: string, next: string) {
  await page.goto(`/entrar?next=${encodeURIComponent(next)}`);
  await login(page, demoEmail(who));
  await expect(page).toHaveURL(new RegExp(next.replace(/[/?]/g, '\\$&') + '$'));
}
const inDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Campo_Grande' }).format(new Date(Date.now() + n * 86_400_000));

test('currículo no app: barra mostra o que falta, salva e baixa em PDF', async ({ page }) => {
  await signInAs(page, 'candidata', '/curriculo');
  await expect(page.getByTestId('resume-progress')).toContainText('80% completo · falta adicionar uma referência');
  await page.getByRole('button', { name: 'Adicionar referência' }).click();
  const ref = page.getByTestId('ref-row');
  await ref.getByLabel('Nome').fill('Maria Souza');
  await ref.getByLabel('De onde conhece').fill('Ex-chefe na clínica');
  await ref.getByLabel('Telefone').fill('(67) 98888-1111');
  await expect(page.getByTestId('resume-progress')).toContainText('95% completo');
  await page.getByRole('button', { name: 'Salvar currículo' }).click();
  await expect(page.getByTestId('resume-msg')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('ref-row')).toHaveCount(1);
  const res = await page.request.get(await page.getByTestId('resume-pdf').getAttribute('href') as string);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('vagas: filtros por área e salário', async ({ page }) => {
  await enter(page, '/vagas?area=cozinha-alimentacao');
  await expect(page.getByTestId('job-card')).toHaveCount(1);
  await expect(page.getByTestId('job-card')).toContainText('Auxiliar de cozinha (demo)');
  await page.goto('/vagas?salario=1500-3000&tipo=clt');
  await expect(page.getByTestId('job-card').filter({ hasText: 'Vendedor(a) de loja (demo)' })).toBeVisible();
  await page.goto('/vagas');
  const card = page.getByTestId('job-card').filter({ hasText: 'Vendedor(a) de loja (demo)' });
  await expect(card.getByTestId('verified')).toBeVisible();
  await card.click();
  await expect(page.getByTestId('job-safety')).toContainText('Por que é seguro se candidatar');
});

test('candidata envia o currículo em um toque, sem mostrar o telefone', async ({ page }) => {
  await signInAs(page, 'candidata', '/vagas');
  await page.getByTestId('job-card').filter({ hasText: 'Vendedor(a) de loja (demo)' }).click();
  await page.getByTestId('apply-resume').getByRole('button', { name: 'Enviar meu currículo' }).click();
  await expect(page.getByTestId('candidatura-ok').or(page.getByTestId('ja-candidatou')).first()).toBeVisible();
  await page.goto('/minhas-candidaturas');
  const item = page.getByTestId('minha-candidatura').filter({ hasText: 'Vendedor(a) de loja (demo)' });
  await expect(item.getByTestId('app-status')).toHaveText('Enviado');
  await expect(item.getByTestId('app-steps')).toBeVisible();
});

test('empresa abre o candidato, compara e convida para entrevista', async ({ page }) => {
  // segundo candidato para comparar
  const { data: job } = await admin.from('jobs').select('id').eq('title', 'Vendedor(a) de loja (demo)').single();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const cliente = users.users.find((u) => u.email === demoEmail('cliente'))!;
  await admin.from('job_applications').insert({
    job_id: job!.id, applicant_id: cliente.id, full_name: 'Bruno Comparação', email: demoEmail('cliente'), consent_at: new Date().toISOString(),
    resume_snapshot: { full_name: 'Bruno Comparação', headline: 'Vendedor', summary: null, neighborhood: null, photo_path: null, experiences: [], education: [], skills: ['Vendas'], references: [] },
  });
  await signInAs(page, 'empresa', '/minhas-vagas');
  await page.getByTestId('minha-vaga').filter({ hasText: 'Vendedor(a) de loja (demo)' }).click();
  await expect(page.getByTestId('candidato')).toHaveCount(2);
  for (const c of await page.getByTestId('candidato').all()) await c.getByLabel('Comparar').check();
  await page.getByTestId('compare-btn').click();
  await expect(page.getByTestId('compare-table')).toContainText('Joana Exemplo (demo)');
  await expect(page.getByTestId('compare-table')).toContainText('Bruno Comparação');
  await page.goBack();

  await page.getByTestId('candidato').filter({ hasText: 'Joana Exemplo (demo)' }).getByTestId('ver-curriculo').click();
  await expect(page.getByTestId('cand-status')).toHaveText('Visualizado');
  await expect(page.getByTestId('phone-hidden')).toBeVisible();
  const form = page.getByTestId('invite-form');
  await form.getByLabel('Dia').fill(inDays(3));
  await form.getByLabel('Horário').fill('10:30');
  await expect(form.getByLabel('Endereço (presencial)')).not.toHaveValue('');
  await form.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(page.getByTestId('cand-detail-msg')).toContainText('Convite enviado');
  await expect(page.getByTestId('interview-employer')).toContainText('10:30');
  await page.goto('/agenda');
  await expect(page.getByTestId('agenda-item').filter({ hasText: 'Entrevista' })).toContainText('Joana Exemplo (demo)');
});

test('candidata confirma a entrevista e ela aparece na agenda', async ({ page }) => {
  await signInAs(page, 'candidata', '/minhas-candidaturas');
  const iv = page.getByTestId('interview');
  await expect(iv).toContainText('Entrevista proposta');
  await iv.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('cand-msg')).toContainText('Entrevista confirmada');
  await expect(page.getByTestId('interview')).toContainText('Entrevista confirmada');
  await expect(page.getByTestId('app-status')).toHaveText('Entrevista marcada');
  await page.goto('/agenda');
  await expect(page.getByTestId('agenda-item').filter({ hasText: 'Entrevista' })).toContainText('Vendedor(a) de loja (demo)');
  await page.goto('/');
  await expect(page.getByTestId('next-meeting')).toContainText('Entrevista');
});

test('contratante novo: vaga guardada até a equipe conferir; depois entra com o selo', async ({ page, browser }, info) => {
  const title = `Repositor ${info.project.name}`;
  await signInAs(page, 'contratante', '/vagas/nova');
  await page.getByLabel('Cargo').fill(title);
  await page.getByLabel('Empresa ou contratante').fill('Mercadinho Teste');
  await page.getByLabel('Área').selectOption('atendimento-vendas');
  await page.getByLabel('Tipo de contratação').selectOption('clt');
  await page.getByLabel('Descrição da vaga').fill('Reposição de mercadorias e organização das gôndolas.');
  await page.getByRole('checkbox', { name: /não vou cobrar nada/ }).check();
  await page.getByRole('button', { name: 'Publicar vaga' }).click();
  await expect(page).toHaveURL(/\/vagas\/verificacao\?vaga=/);
  await expect(page.getByTestId('job-held')).toBeVisible();
  const form = page.getByTestId('employer-form');
  await form.getByRole('textbox', { name: 'CNPJ' }).fill('11.444.777/0001-61');
  await form.getByLabel(/Razão social/).fill('Mercadinho Teste LTDA');
  await form.getByLabel(/Endereço/).fill('Rua das Flores, 120');
  await form.getByRole('button').last().click();
  await expect(page.getByTestId('employer-status')).toContainText('Em conferência');

  await page.goto(`/vagas?q=${encodeURIComponent(title)}`);
  await expect(page.getByTestId('job-card').filter({ hasText: title })).toHaveCount(0);

  const ctx = await browser.newContext();
  const adm = await ctx.newPage();
  await signInAs(adm, 'admin', '/admin/contratantes');
  const row = adm.getByTestId('employer-row').filter({ hasText: 'Mercadinho Teste LTDA' });
  await expect(row).toContainText('1 vaga guardada');
  await row.getByRole('button', { name: 'Verificar' }).click();
  await expect(adm.getByTestId('employer-msg')).toBeVisible();
  await ctx.close();

  await page.goto(`/vagas?q=${encodeURIComponent(title)}`);
  await expect(page.getByTestId('job-card').filter({ hasText: title }).getByTestId('verified')).toBeVisible();
});

test('prestador escolhe os pacotes que faz', async ({ page }) => {
  await signInAs(page, 'prestador-carlos', '/painel/pacotes');
  await expect(page.getByTestId('pkg-commission')).toContainText('só é cobrada quando o serviço é concluído');
  const first = page.getByTestId('pkg-row').first().getByRole('checkbox');
  await expect(first).toBeChecked();
  await first.uncheck();
  await page.getByRole('button', { name: 'Salvar pacotes' }).click();
  await expect(page.getByTestId('pkg-msg')).toContainText('Pacotes salvos');
  await expect(page.getByTestId('pkg-row').first().getByRole('checkbox')).not.toBeChecked();
});

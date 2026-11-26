import { test } from '@playwright/test';
import { demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

test('menu: destaca a opção em uso, navega com teclado e abre o destino certo', async ({ page, isMobile }) => {
  await page.goto('/buscar?q=encanador');
  if (isMobile) {
    const menu = page.getByRole('button', { name: /^Menu/ });
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await expect(drawer.getByRole('link', { name: /Buscar profissional/ })).toHaveAttribute('aria-current', 'page');
    await expect(drawer.getByRole('link', { name: /Buscar profissional/ })).toContainText('atual'); // não só pela cor
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(menu).toBeFocused(); // foco volta ao botão
    await menu.click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Preciso para hoje' }).click();
    await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0); // fecha ao navegar
  } else {
    const nav = page.getByRole('navigation', { name: 'Menu principal' });
    await expect(nav.getByRole('link', { name: /Buscar profissional/ })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: /Buscar profissional/ }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(nav.getByRole('link', { name: 'Preciso para hoje' })).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(page).toHaveURL(/\/hoje$/);
  await expect(page.getByRole('heading', { name: 'Preciso para hoje' })).toBeVisible();
});

test('acesso: visitante vai ao login; usuário comum recebe acesso restrito no admin', async ({ page }) => {
  await page.goto('/painel/disponibilidade');
  await expect(page).toHaveURL(/\/entrar\?next=%2Fpainel%2Fdisponibilidade/);
  await login(page, demoEmail('cliente'));
  await expect(page).toHaveURL(/\/painel\/disponibilidade|\/painel\/perfil/); // sem perfil, começa o cadastro
  await page.goto('/admin?aba=perfis');
  await expect(page.getByTestId('acesso-restrito')).toContainText('Acesso restrito');
  await expect(page.getByText('Frio Bom Climatização')).toHaveCount(0);
});

test('prestador: ajusta o dia, confere na busca e pausa; Ver perfil abre só o perfil', async ({ page, isMobile }) => {
  await page.goto('/entrar?next=/painel');
  await login(page, demoEmail('prestador-carlos'));
  await expect(page.getByTestId('status')).toHaveText('Publicado');
  await expect(page.getByTestId('visibility')).toContainText('Visível na busca');
  await expect(page.getByTestId('area-summary')).toContainText('Amambaí, Carlota, Centro');
  await expect(page.getByTestId('today-active')).toContainText('Amambaí, Centro');

  // Disponibilidade: hoje só Centro e só Encanador
  await page.getByRole('link', { name: 'Ajustar disponibilidade de hoje' }).click();
  await expect(page).toHaveURL(/\/painel\/disponibilidade$/);
  await page.getByRole('checkbox', { name: 'Desentupidor' }).uncheck();
  await page.getByRole('checkbox', { name: 'Amambaí' }).uncheck();
  await page.getByRole('button', { name: 'Salvar ajuste de hoje' }).click();
  await expect(page.getByText('Disponibilidade de hoje atualizada.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('today-active')).not.toContainText('Desentupidor');
  await expect(page.getByTestId('today-active')).not.toContainText('Amambaí');

  const visitor = await page.context().browser()!.newPage();
  await visitor.goto('/hoje?servico=encanador&bairro=amambai');
  await expect(visitor.getByTestId('urgent-result').filter({ hasText: 'Carlos Hidráulica' })).toHaveCount(0);
  await visitor.goto('/hoje?servico=encanador&bairro=centro');
  const card = visitor.getByTestId('urgent-result').filter({ hasText: 'Carlos Hidráulica' });
  await expect(card).toContainText('Chamar no WhatsApp');
  await card.getByRole('link', { name: 'Ver perfil' }).click();
  await expect(visitor).toHaveURL(/\/p\/carlos-demo\?/);
  await visitor.getByTestId('back-to-results').click();
  await expect(visitor).toHaveURL(/\/hoje\?servico=encanador&bairro=centro$/);

  // Pausar: some da busca; painel mostra o estado confirmado pelo servidor
  if (isMobile) await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('link', { name: 'Visão geral' }).click();
  await page.getByRole('button', { name: 'Pausar publicação' }).click();
  await expect(page.getByTestId('status')).toHaveText('Pausado');
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Pausado');
  await visitor.reload();
  await expect(visitor.getByTestId('urgent-result').filter({ hasText: 'Carlos Hidráulica' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reativar publicação' }).click();
  await expect(page.getByTestId('status')).toHaveText('Publicado');
  await visitor.close();
});

test('admin: indicadores levam à lista com os mesmos números e filtro de cidade', async ({ page }) => {
  await page.goto('/entrar?next=/admin');
  await login(page, demoEmail('admin'));
  await page.waitForURL((u) => u.pathname === '/admin');
  for (const name of ['Prestadores publicados', 'Disponíveis hoje', 'Perfis sem área confirmada']) {
    await page.goto('/admin');
    const kpi = page.getByTestId(`kpi-${name}`);
    const n = Number(await kpi.getByTestId('kpi-num').textContent());
    await kpi.click();
    await expect(page).toHaveURL(/aba=perfis/);
    await expect(page).toHaveURL(/cidade=campo-grande-ms/);
    await expect(page.getByTestId('admin-total')).toHaveText(n === 1 ? '1 prestador' : `${n} prestadores`);
    await expect(page.getByTestId('admin-provider')).toHaveCount(n);
  }
  await expect(page.getByTestId('admin-provider')).toContainText('Zé Reformas'); // último: área pendente
  // cobertura por categoria → lista
  await page.goto('/admin');
  const row = page.getByTestId('coverage-table').locator('tr').filter({ hasText: 'Hidráulica e manutenção' });
  const pub = Number(await row.locator('td').first().textContent());
  await row.locator('td').first().getByRole('link').click();
  await expect(page.getByTestId('admin-provider')).toHaveCount(pub);
});

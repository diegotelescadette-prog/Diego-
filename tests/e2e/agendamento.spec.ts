import { test, type Page } from '@playwright/test';
import { admin, demoEmail, expect, login, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });
test.afterAll(async () => { await reseed(); });

async function fillWhere(page: Page) {
  await page.getByLabel('Bairro em Campo Grande').selectOption({ label: 'Centro' });
  await page.getByLabel('Rua, número e complemento').fill('Rua 14 de Julho, 1000, apto 3');
  await page.getByLabel('Seu WhatsApp (com DDD)').fill('(67) 99999-0000');
}

test('tela inicial: amanhecer, atalhos principais, sem seções vazias e sem links repetidos no menu', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(Bom dia|Boa tarde|Boa noite)\.$/);
  await expect(page.getByText('Gente de confiança, perto de você.')).toBeVisible();
  await expect(page.getByTestId('home-servico').getByRole('heading', { name: 'Preciso de um serviço' })).toBeVisible();
  await expect(page.getByTestId('cta-hoje')).toHaveText(/Preciso para hoje/);
  await expect(page.getByTestId('home-trabalho')).toContainText('Procuro trabalho');
  await expect(page.getByTestId('home-contratar')).toHaveAttribute('href', '/vagas/nova');
  const most = page.getByTestId('most-requested');
  await expect(most.getByTestId('package-card').filter({ hasText: 'Trocar chuveiro' })).toContainText('R$ 90');
  await expect(page.getByTestId('guarantee')).toContainText('Preço combinado é preço pago');
  await expect(page.getByTestId('home-quote')).toHaveText('Servir bem é a nossa forma de cuidar do próximo.');
  // sem login não há agenda; seções sem dados não aparecem
  await expect(page.getByTestId('next-meeting')).toHaveCount(0);
  for (const empty of ['Indicados pela sua rede', 'Palestras esta semana', 'Ninguém confirmou ainda hoje', 'Nenhuma vaga aberta agora']) {
    await expect(page.getByText(empty)).toHaveCount(0);
  }
  if (isMobile) {
    const bottom = page.getByRole('navigation', { name: 'Navegação rápida' });
    await expect(bottom.getByRole('link')).toHaveText(['Início', 'Serviços', 'Trabalho', 'Agenda', 'Perfil']);
    await page.getByRole('button', { name: /^Menu/ }).click();
  }
  const hrefs = await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(hrefs.length);
  expect(hrefs.filter((h) => h === '/')).toHaveLength(1);
});

test('cliente agenda "Trocar chuveiro" pelo preço fixo e acompanha até concluir', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByTestId('most-requested').getByTestId('package-card').filter({ hasText: 'Trocar chuveiro' }).getByTestId('agendar').click();
  await expect(page).toHaveURL(/\/agendar\/trocar-chuveiro$/);
  await expect(page.getByTestId('price').first()).toHaveText('R$ 90');
  await expect(page.getByTestId('includes')).toContainText('Instalação e teste do novo');
  await expect(page.getByTestId('excludes')).toContainText('Chuveiro novo');
  await page.getByTestId('login-to-book').click();
  await expect(page.getByText('Entre ou crie sua conta para agendar.')).toBeVisible();
  await login(page, demoEmail('cliente'));
  await expect(page).toHaveURL(/\/agendar\/trocar-chuveiro$/);

  // o primeiro dia livre já vem escolhido (hoje, enquanto houver faixa)
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Campo_Grande' }).format(new Date()));
  if (hour < 20) await expect(page.getByLabel(/Hoje/)).toBeChecked();
  await page.getByLabel('Trocar a resistência do chuveiro antigo também').check();
  await expect(page.getByTestId('total')).toHaveText('R$ 110');
  await page.getByLabel('Trocar a resistência do chuveiro antigo também').uncheck();
  await fillWhere(page);
  await expect(page.getByTestId('summary')).toContainText('Centro');
  await expect(page.getByTestId('total')).toHaveText('R$ 90');
  await page.getByRole('button', { name: /Confirmar agendamento · R\$ 90/ }).click();

  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+\?novo=1$/);
  const bookingUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId('booking-created')).toBeVisible();
  await expect(page.getByTestId('status-now')).toContainText('Solicitado');
  await expect(page.getByTestId('booking-total')).toHaveText('R$ 90');
  // só um eletricista atende: já vem escolhido; o contato aparece só depois da confirmação
  await expect(page.getByTestId('booking-provider')).toContainText('Elétrica Pantanal (demo)');
  await expect(page.getByRole('link', { name: 'Falar no WhatsApp' })).toHaveCount(0);
  await page.goto('/agenda');
  await expect(page.getByTestId('agenda-item').first()).toContainText('Trocar chuveiro');
  await page.goto('/');
  await expect(page.getByTestId('next-meeting')).toContainText('Trocar chuveiro');
  await page.goto(bookingUrl);
  const { data: priv } = await admin.from('booking_private').select('contact_phone').eq('booking_id', bookingUrl.split('/').pop()!).single();
  expect(priv!.contact_phone).toBe('67999990000');

  // profissional confirma e avança
  const pro = await (await browser.newContext()).newPage();
  await pro.goto('/entrar?next=%2Fpainel%2Fpedidos');
  await login(pro, demoEmail('prestador-pantanal'));
  const card = pro.getByTestId('provider-booking').filter({ hasText: 'Trocar chuveiro' });
  await expect(card.getByTestId('client-contact')).toContainText('aparecem quando você confirmar');
  await expect(card.getByTestId('client-contact')).not.toContainText('14 de Julho');
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await expect(pro.getByTestId('provider-msg')).toContainText('Pedido confirmado');
  await expect(card.getByTestId('client-contact')).toContainText('Rua 14 de Julho, 1000, apto 3');
  await card.getByRole('button', { name: 'Estou a caminho' }).click();
  await expect(card).toHaveAttribute('data-status', 'a_caminho');

  await page.reload();
  await expect(page.getByTestId('status-now')).toContainText('A caminho');
  await expect(page.getByRole('link', { name: 'Falar no WhatsApp' })).toHaveAttribute('href', /wa\.me\/5567900000/);

  await card.getByRole('button', { name: 'Comecei o serviço' }).click();
  await expect(card).toHaveAttribute('data-status', 'em_andamento');
  await card.getByRole('button', { name: 'Terminei o serviço' }).click();
  await expect(card).toHaveAttribute('data-status', 'concluido');
  await expect(card).toContainText('Comissão da plataforma: R$ 10,80');
  await card.getByRole('button', { name: 'Recebi R$ 90' }).click();
  await expect(pro.getByTestId('provider-msg')).toContainText('Pagamento registrado');

  await page.reload();
  await expect(page.getByTestId('status-now')).toContainText('Concluído');
  await expect(page.getByTestId('booking-items')).toContainText('Pix na entrega · pago');
  // avaliação: última etapa
  await page.getByLabel('5 de 5: Excelente').check({ force: true });
  await page.getByLabel('Comentário (opcional)').fill('Chegou no horário e deixou tudo limpo.');
  await page.getByRole('button', { name: 'Enviar avaliação' }).click();
  await expect(page.getByTestId('booking-msg')).toContainText('Obrigado pela avaliação');
  await expect(page.getByTestId('status-now')).toContainText('Avaliação');
  await expect(page.getByTestId('review-done')).toContainText('5 de 5');
  await page.goto('/pedidos');
  await expect(page.getByTestId('my-booking').first()).toContainText('Concluído');
});

test('com mais de um profissional, o cliente escolhe entre os melhores; a equipe vê e troca', async ({ page, browser }) => {
  await page.goto('/entrar?next=%2Fagendar%2Fdesentupir-pia');
  await login(page, demoEmail('cliente'));
  await page.getByText('Amanhã', { exact: true }).click();
  await expect(page.getByLabel(/Amanhã/)).toBeChecked();
  await fillWhere(page);
  await page.getByRole('button', { name: /Confirmar agendamento/ }).click();
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+\?novo=1$/);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const cands = page.getByTestId('candidate');
  await expect(cands).toHaveCount(2); // Carlos (atende o Centro) e Hidro (cidade toda); Marcos só no Carandá Bosque
  await expect(cands.filter({ hasText: 'Carlos Hidráulica (demo)' })).toHaveCount(1);
  await expect(cands.first()).not.toContainText('Atende hoje'); // o pedido é para amanhã
  await cands.filter({ hasText: 'Hidro Cidade (demo)' }).getByRole('button', { name: 'Escolher' }).click();
  await expect(page.getByTestId('booking-msg')).toContainText('Profissional escolhido');
  await expect(page.getByTestId('booking-provider')).toContainText('Hidro Cidade (demo)');

  // outro cliente não abre o pedido (RLS)
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/entrar?next=${encodeURIComponent(`/pedidos/${id}`)}`);
  await login(other, demoEmail('empresa'));
  await expect(other.getByText('Pedido #')).toHaveCount(0);

  // equipe: lista, atribui outro e o cliente cancela
  const adm = await (await browser.newContext()).newPage();
  await adm.goto('/entrar?next=%2Fadmin%2Fpedidos%3Fstatus%3Dabertos');
  await login(adm, demoEmail('admin'));
  await adm.getByTestId('admin-booking').filter({ hasText: 'Desentupir pia' }).getByRole('link').click();
  await expect(adm.getByTestId('admin-provider')).toContainText('Hidro Cidade (demo)');
  await adm.getByLabel('Atribuir ou trocar').selectOption({ label: 'Carlos Hidráulica (demo)' });
  await adm.getByTestId('assign-form').getByRole('button', { name: 'Salvar' }).click();
  await expect(adm.getByTestId('admin-booking-msg')).toContainText('Profissional atribuído');
  await expect(adm.getByTestId('admin-provider')).toContainText('Carlos Hidráulica (demo)');

  await page.reload();
  await expect(page.getByTestId('booking-provider')).toContainText('Carlos Hidráulica (demo)');
  await page.getByText('Cancelar pedido', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByTestId('booking-msg')).toContainText('Pedido cancelado');
  await expect(page.getByTestId('status-now')).toContainText('Cancelado');
});

test('equipe muda o preço do pacote e o cliente vê o novo valor', async ({ page }) => {
  await page.goto('/entrar?next=%2Fadmin%2Fpacotes');
  await login(page, demoEmail('admin'));
  const pkg = page.locator('[data-testid="admin-package"][data-slug="copia-de-chave"]');
  await pkg.locator('summary').click();
  await pkg.getByLabel('Preço (R$)').fill('18');
  await pkg.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByTestId('pkg-msg')).toContainText('“Cópia de chave” salvo.');
  await page.goto('/servicos/portas-janelas-e-seguranca');
  await expect(page.getByTestId('package-card').filter({ hasText: 'Cópia de chave' }).getByTestId('price')).toHaveText('R$ 18');
  await admin.from('service_packages').update({ price_cents: 1500 }).eq('slug', 'copia-de-chave');
});

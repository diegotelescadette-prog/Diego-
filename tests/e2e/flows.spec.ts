import { test } from '@playwright/test';
import sharp from 'sharp';
import { admin, captureWhatsApp, demoEmail, expect, lastMailLink, login, profileId, reseed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await reseed(); });

test('visitante: Preciso para hoje → WhatsApp sem conta', async ({ page }) => {
  const wa = await captureWhatsApp(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Preciso para hoje' })).toBeVisible();
  await expect(page.getByText('Campo Grande–MS').first()).toBeVisible();
  await page.getByText('Encanador', { exact: true }).click();
  await page.getByLabel('2. Em qual bairro?').selectOption({ label: 'Centro' });
  await page.getByRole('button', { name: 'Ver quem atende hoje' }).click();
  await expect(page).toHaveURL(/\/hoje\?servico=encanador&bairro=centro/);
  const results = page.getByTestId('urgent-result');
  await expect(results).toHaveCount(2); // Carlos (bairros do dia) + Hidro (cidade inteira)
  const carlos = results.filter({ hasText: 'Carlos Hidráulica (demo)' });
  await expect(carlos).toContainText('Atende hoje');
  await expect(carlos).toContainText('Horário a combinar pelo WhatsApp');
  await expect(results.filter({ hasText: 'Hidro Cidade (demo)' })).toContainText('Atende toda Campo Grande');
  await expect(page.getByText('Marcos Encanador')).toHaveCount(0); // só Carandá Bosque
  await expect(page.getByText('Paulo Pausado')).toHaveCount(0); // pausado
  await carlos.getByRole('button', { name: /Chamar no WhatsApp/ }).click(); // o card inteiro é o botão
  await expect.poll(() => wa.length).toBe(1);
  const u = new URL(wa[0]);
  expect(u.pathname).toBe('/5567900000001');
  expect(u.searchParams.get('text')).toBe('Olá! Encontrei seu perfil no Resolve Aqui. Preciso de encanador hoje no bairro Centro, em Campo Grande. Qual horário você consegue atender?');
});

test('Todos os bairros: sem informar bairro nem criar conta, abre o WhatsApp só com a cidade', async ({ page }) => {
  const wa = await captureWhatsApp(page);
  await page.goto('/');
  await page.getByLabel('Filtrar serviços').fill('encan');
  await page.getByText('Encanador', { exact: true }).click();
  await expect(page.getByLabel('2. Em qual bairro?')).toHaveValue(''); // padrão: Todos os bairros
  await page.getByRole('button', { name: 'Ver quem atende hoje' }).click();
  await expect(page).toHaveURL(/\/hoje\?servico=encanador&bairro=$/);
  const results = page.getByTestId('urgent-result');
  await expect(results).toHaveCount(3); // cidade inteira + quem confirmou bairros
  await expect(results.filter({ hasText: 'Marcos Encanador (demo)' })).toContainText('Atende: Carandá Bosque');
  await results.filter({ hasText: 'Marcos Encanador (demo)' }).getByRole('button').click();
  await expect.poll(() => wa.length).toBe(1);
  expect(new URL(wa[0]).searchParams.get('text')).toBe('Olá! Encontrei seu perfil no Resolve Aqui. Preciso de encanador hoje em Campo Grande. Qual horário você consegue atender?');
});

test('cidade inteira aparece em qualquer bairro; bairro do dia; serviço fora do "Preciso para hoje"', async ({ page }) => {
  await page.goto('/hoje?servico=eletricista&bairro=nova-lima');
  await expect(page.getByTestId('urgent-result').filter({ hasText: 'Elétrica Pantanal (demo)' })).toBeVisible();
  await expect(page.getByTestId('urgent-result').first()).toContainText('Atende toda Campo Grande');
  // Marcos atende só o Carandá Bosque: aparece lá e fica fora do Centro
  await page.goto('/hoje?servico=encanador&bairro=caranda-bosque');
  await expect(page.getByTestId('urgent-result').filter({ hasText: 'Marcos Encanador (demo)' })).toBeVisible();
  await expect(page.getByTestId('urgent-result').filter({ hasText: 'Hidro Cidade (demo)' })).toBeVisible();
  await page.goto('/hoje?servico=diarista&bairro=centro');
  await expect(page.getByTestId('urgent-result').filter({ hasText: 'Bia Faxina' })).toBeVisible(); // serviço presencial entra
  await page.goto('/hoje?servico=tradutor&bairro=centro');
  await expect(page.getByText('Tradutor ainda não faz parte do “Preciso para hoje”.')).toBeVisible();
  await page.getByRole('link', { name: /Buscar tradutor/ }).click();
  await expect(page).toHaveURL(/\/buscar\?servico=tradutor&cidade=campo-grande-ms&bairro=centro/);
});

test('clique com disponibilidade vencida: avisa, atualiza e mantém serviço e bairro', async ({ page }) => {
  const wa = await captureWhatsApp(page);
  await page.goto('/hoje?servico=chaveiro&bairro=tiradentes');
  await expect(page.getByTestId('urgent-result')).toHaveCount(1);
  // vence entre a busca e o clique (meia-noite simulada)
  await admin.from('availability_today').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('provider_id', await profileId('joana-demo'));
  await page.getByRole('button', { name: /Chamar no WhatsApp/ }).click();
  await expect(page.getByRole('status')).toContainText('A disponibilidade de Joana Chaves (demo) mudou');
  await expect(page.getByTestId('urgent-result')).toHaveCount(0);
  await expect(page).toHaveURL(/servico=chaveiro&bairro=tiradentes/);
  expect(wa.length).toBe(0);
  await expect(page.getByRole('link', { name: 'Buscar em toda Campo Grande' })).toHaveAttribute('href', '/hoje?servico=chaveiro');
  const all = page.getByRole('link', { name: 'Ver todos os prestadores desse serviço' });
  await expect(all).toHaveAttribute('href', '/buscar?servico=chaveiro&cidade=campo-grande-ms&bairro=tiradentes');
  await all.click();
  await expect(page.getByTestId('provider-card').filter({ hasText: 'Joana Chaves' })).toBeVisible();
});

test('busca geral: sinônimo, login antes do contato, retorno ao mesmo perfil, favoritos', async ({ page, isMobile }) => {
  const wa = await captureWhatsApp(page);
  await page.goto('/');
  await page.getByLabel('O que você procura?').fill('limpar piscina');
  await page.getByRole('button', { name: 'Buscar prestadores' }).click();
  await expect(page.getByText('“limpar piscina” inclui: Piscineiro')).toBeVisible();
  // filtro de bairro (Carandá Bosque) cruza a área declarada; endereço de referência é no Centro
  if (isMobile) await page.getByRole('button', { name: /^Filtros/ }).click();
  await page.getByLabel('Bairro').selectOption({ label: 'Carandá Bosque' });
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByRole('link', { name: 'Remover filtro Bairro: Carandá Bosque' })).toBeVisible();
  await expect(page.getByText('Limpar filtros')).toBeVisible();
  await page.getByTestId('provider-card').filter({ hasText: 'Rafa Piscinas' }).getByRole('link', { name: 'Ver perfil' }).click();
  await page.waitForURL(/\/p\/rafa-demo/);
  const profileUrl = page.url();
  await page.getByRole('link', { name: 'Chamar no WhatsApp' }).click();
  await expect(page).toHaveURL(/\/entrar\?motivo=contato&next=/);
  await expect(page.getByText('Entre para chamar o prestador no WhatsApp.')).toBeVisible();
  await login(page, demoEmail('cliente'));
  await expect(page).toHaveURL(profileUrl);
  await page.getByRole('button', { name: 'Chamar no WhatsApp' }).click();
  const box = page.getByLabel('Mensagem (você pode editar antes de enviar)');
  await expect(box).toHaveValue('Olá! Encontrei seu perfil no Resolve Aqui. Preciso de piscineiro em Carandá Bosque, Campo Grande. Você tem disponibilidade?');
  await box.fill('Olá! Preciso limpar a piscina no sábado. Pode?');
  await page.getByRole('button', { name: 'Abrir WhatsApp' }).click();
  await expect.poll(() => wa.length).toBe(1);
  expect(new URL(wa[0]).searchParams.get('text')).toBe('Olá! Preciso limpar a piscina no sábado. Pode?');

  await page.goto(profileUrl);
  await page.getByRole('button', { name: '☆ Salvar nos favoritos' }).click();
  await expect(page.getByRole('button', { name: '★ Salvo nos favoritos' })).toBeVisible();
  await page.goto('/favoritos');
  await expect(page.getByTestId('provider-card').filter({ hasText: 'Rafa Piscinas' })).toBeVisible();
  await page.goto(profileUrl);
  await page.getByRole('button', { name: '★ Salvo nos favoritos' }).click();
  await expect(page.getByRole('button', { name: '☆ Salvar nos favoritos' })).toBeVisible();
});

test('busca geral: tocar no card pede login uma vez e depois abre o WhatsApp direto', async ({ page }) => {
  const wa = await captureWhatsApp(page);
  await page.goto('/buscar?servico=encanador&bairro=caranda-bosque');
  await expect(page.getByLabel('Cidade', { exact: true })).toHaveValue('campo-grande-ms'); // Campo Grande já selecionada
  const cards = page.getByTestId('provider-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Hidro Cidade' })).toContainText('Atende toda Campo Grande');
  await cards.filter({ hasText: 'Marcos Encanador' }).getByRole('button').click();
  await expect(page).toHaveURL(/\/entrar\?motivo=contato&next=/);
  await login(page, demoEmail('cliente'));
  await expect.poll(() => wa.length).toBe(1);
  expect(new URL(wa[0]).searchParams.get('text')).toBe('Olá! Encontrei seu perfil no Resolve Aqui. Preciso de encanador em Carandá Bosque, Campo Grande. Você tem disponibilidade?');
  // já logado: direto, sem pedir login de novo
  await page.goto('/buscar?servico=encanador');
  await expect(page.getByTestId('provider-card')).toHaveCount(3);
  await page.getByTestId('provider-card').filter({ hasText: 'Hidro Cidade' }).getByRole('button').click();
  await expect.poll(() => wa.length).toBe(2);
  expect(new URL(wa[1]).searchParams.get('text')).toBe('Olá! Encontrei seu perfil no Resolve Aqui. Preciso de encanador em Campo Grande. Você tem disponibilidade?');
  await page.goto('/buscar?servico=encanador&bairro=centro');
  await expect(page.getByTestId('provider-card').filter({ hasText: 'Marcos Encanador' })).toHaveCount(0);
});

test('perfil antigo só com endereço pede confirmação da área', async ({ page }) => {
  await page.goto('/entrar?next=/painel');
  await login(page, demoEmail('prestador-ze'));
  await expect(page.getByTestId('confirm-area')).toContainText('Confirme sua área de atendimento');
  await page.getByRole('link', { name: 'Confirmar área' }).click();
  await expect(page.getByText('Confirme sua área de atendimento. Só assim')).toBeVisible();
  await page.getByText('Atendo em toda Campo Grande').click();
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page).toHaveURL(/\/painel\/previa$/);
  await page.goto('/buscar?q=pedreiro&bairro=universitario');
  await expect(page.getByTestId('provider-card').filter({ hasText: 'Zé Reformas' })).toContainText('Atende toda Campo Grande');
});

test('favorito como visitante pede login e volta ao perfil', async ({ page }) => {
  await page.goto('/p/leo-demo');
  await page.getByRole('button', { name: '☆ Salvar nos favoritos' }).click();
  await expect(page).toHaveURL(/\/entrar\?motivo=favorito&next=%2Fp%2Fleo-demo/);
  await login(page, demoEmail('cliente'));
  await expect(page).toHaveURL(/\/p\/leo-demo$/);
});

test('busca sem resultados sugere retirar filtro e manter a consulta', async ({ page }) => {
  await page.goto('/buscar?q=piscina&cidade=campo-grande-ms&bairro=aero-rancho');
  await expect(page.getByTestId('empty-search')).toContainText('Nenhum prestador encontrado para “piscina”');
  await page.getByRole('link', { name: 'Buscar em toda Campo Grande' }).click();
  // navegação no cliente: aguarda a URL sem depender do evento "load" (era instável)
  await expect(page).not.toHaveURL(/bairro=/);
  await expect(page.getByLabel('Nome, serviço ou problema')).toHaveValue('piscina');
  await expect(page.getByTestId('provider-card').filter({ hasText: 'Rafa Piscinas' })).toBeVisible();
});

test('prestador: cria conta, confirma e-mail, publica e ativa/desativa Atendo hoje', async ({ page, browserName }, info) => {
  const email = `novo-${info.project.name}-${Date.now()}@teste.resolveaqui.test`;
  // remove EXIF/GPS: foto de teste com coordenadas
  const jpeg = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#88aacc' } })
    .jpeg().withExif({ IFD0: { Make: 'CameraTeste' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '20/1 27/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '54/1 37/1 0/1' } }).toBuffer();
  expect((await sharp(jpeg).metadata()).exif).toBeTruthy();

  await page.goto('/');
  await page.getByRole('link', { name: 'Sou prestador' }).first().click();
  await expect(page).toHaveURL(/\/cadastrar\?next=%2Fpainel%2Fperfil/);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByLabel(/Li e concordo/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/verifique-email/);
  expect(page.url()).not.toContain(encodeURIComponent(email));
  await page.goto(await lastMailLink(email, 'signup'));
  await expect(page).toHaveURL(/\/painel\/perfil$/);

  // Etapa 1 — erros no servidor ao lado do campo
  await page.getByLabel('Nome profissional').fill('Teste Encanamentos');
  await page.getByLabel('Telefone com DDD').fill('(67) 1234');
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(page.locator('#phone-error')).toContainText('Telefone inválido');
  await expect(page.getByText('Escolha pelo menos um serviço')).toBeVisible();
  await expect(page.getByText('Envie uma foto de perfil')).toBeVisible();

  await page.locator('#photo').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByText('Foto atualizada.')).toBeVisible();
  await page.getByLabel('Telefone com DDD').fill('(67) 98888-7777');
  await page.getByLabel('Procurar serviço').fill('encan');
  await page.getByRole('checkbox', { name: 'Encanador' }).check();
  await page.getByLabel('Procurar serviço').fill('desent');
  await page.getByRole('checkbox', { name: 'Desentupidor' }).check();
  await page.getByLabel('Serviço principal').selectOption({ label: 'Encanador' });
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(page).toHaveURL(/\/painel\/atendimento$/);

  // foto publicada sem metadados
  const { data: prof } = await admin.from('provider_profiles').select('id, photo_path').eq('display_name', 'Teste Encanamentos').order('created_at', { ascending: false }).limit(1).single();
  const img = await (await fetch(`http://localhost:54321/storage/v1/object/public/profile-photos/${prof!.photo_path}`)).arrayBuffer();
  const meta = await sharp(Buffer.from(img)).metadata();
  expect(meta.format).toBe('webp');
  expect(meta.exif).toBeUndefined();

  // Etapa 2 — endereço manual (CEP sem internet) e área ≠ endereço
  await page.getByLabel('CEP').fill('79002-000');
  await page.getByLabel('Rua').fill('Rua de Teste');
  await page.getByLabel('Número').fill('10');
  await page.getByLabel('Bairro', { exact: true }).fill('Centro');
  await page.getByLabel('Cidade', { exact: true }).fill('Campo Grande');
  await page.getByLabel('UF').selectOption('MS');
  await page.getByRole('button', { name: 'Ver prévia do perfil' }).click();
  await expect(page.getByText('Escolha se você atende toda a cidade ou bairros selecionados')).toBeVisible();
  await page.getByLabel('CEP').fill('79002-000');
  await page.getByLabel('Número').fill('10');
  await page.getByText('Atendo em bairros selecionados').click();
  await page.getByLabel('Procurar bairro').fill('mata do');
  await page.getByRole('checkbox', { name: 'Mata do Jacinto' }).check();
  await page.getByRole('button', { name: 'Ver prévia do perfil' }).click();
  await expect(page).toHaveURL(/\/painel\/previa$/);
  await expect(page.getByText('Atende: Mata do Jacinto').first()).toBeVisible();
  await expect(page.getByText('Rua de Teste')).toHaveCount(0); // endereço não aparece
  await page.getByRole('button', { name: 'Publicar meu perfil' }).click();
  await expect(page).toHaveURL(/\/painel\?publicado=1/);
  await expect(page.getByTestId('status')).toHaveText('Publicado');

  // Atendo hoje
  await expect(page.getByText(/visitantes sem cadastro podem te chamar no WhatsApp/)).toBeVisible();
  await page.getByRole('button', { name: 'Atendo hoje' }).click();
  await expect(page.getByTestId('today-active')).toContainText('ativo até 23:59 de hoje');
  await expect(page.getByTestId('today-active')).toContainText('Encanador · contato sem login');
  await expect(page.getByTestId('today-active')).toContainText('Mata do Jacinto');

  const visitor = await page.context().browser()!.newPage();
  await visitor.goto('/hoje?servico=encanador&bairro=mata-do-jacinto');
  await expect(visitor.getByTestId('urgent-result').filter({ hasText: 'Teste Encanamentos' })).toBeVisible();

  await page.getByRole('button', { name: 'Desativar “Atendo hoje”' }).click();
  await expect(page.getByRole('button', { name: 'Atendo hoje' })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByTestId('urgent-result').filter({ hasText: 'Teste Encanamentos' })).toHaveCount(0);

  // pausar remove da busca
  await page.getByRole('button', { name: 'Pausar publicação' }).click();
  await expect(page.getByTestId('status')).toHaveText('Pausado');
  await visitor.goto('/buscar?q=teste encanamentos');
  await expect(visitor.getByText('Carlos Hidráulica (demo)')).toBeVisible();
  await expect(visitor.getByTestId('provider-card').filter({ hasText: 'Teste Encanamentos' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reativar publicação' }).click();
  await expect(page.getByTestId('status')).toHaveText('Publicado');
  await visitor.close();
  void browserName;
});

test('recuperação de senha por e-mail', async ({ page }, info) => {
  const email = `rec-${info.project.name}-${Date.now()}@teste.resolveaqui.test`;
  await admin.auth.admin.createUser({ email, password: 'senha-antiga-1', email_confirm: true });
  await page.goto('/entrar');
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail da conta').fill(email);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByText(/Se existir uma conta/)).toBeVisible();
  await page.goto(await lastMailLink(email, 'recovery'));
  await expect(page).toHaveURL(/\/redefinir-senha/);
  await page.getByLabel('Nova senha', { exact: true }).fill('senha-nova-123');
  await page.getByLabel('Repita a nova senha').fill('senha-nova-123');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByText('Senha alterada.')).toBeVisible();
});

test('admin suspende e reativa perfil com histórico; suspenso sai da busca', async ({ page }) => {
  await page.goto('/entrar?next=/admin?aba=perfis');
  await login(page, demoEmail('admin'));
  await page.waitForURL((u) => u.pathname === '/admin');
  await page.goto('/admin?aba=perfis&q=Frio');
  const row = page.getByTestId('admin-provider').filter({ hasText: 'Frio Bom Climatização' });
  await row.getByRole('button', { name: 'Suspender' }).click();
  await expect(row.getByText('Suspender Frio Bom Climatização (demo)?')).toBeVisible(); // confirmação
  await row.getByPlaceholder('Motivo (obrigatório)').fill('Teste automatizado');
  await row.getByRole('button', { name: 'Confirmar suspensão' }).click();
  await expect(page.getByText('Perfil suspenso: Frio Bom Climatização (demo)')).toBeVisible();
  await expect(page).toHaveURL(/q=Frio/); // volta para a mesma lista filtrada
  const visitor = await page.context().browser()!.newPage();
  await visitor.goto('/buscar?q=frio bom');
  await expect(visitor.getByTestId('empty-search')).toBeVisible();
  await page.goto('/admin?aba=historico');
  const log = page.locator('tr').filter({ hasText: /Teste automatizado \(de published para suspended\)/ }).first();
  await expect(log).toContainText('admin@demo.resolveaqui.test'); // responsável
  await expect(log).toContainText('Perfil: Frio Bom Climatização (demo)');
  await page.goto('/admin?aba=perfis&q=Frio');
  await row.getByRole('button', { name: 'Reativar' }).click();
  await row.getByPlaceholder('Motivo (obrigatório)').fill('Revisado');
  await row.getByRole('button', { name: 'Confirmar reativação' }).click();
  await expect(page.getByText('Perfil reativado e publicado: Frio Bom Climatização (demo)')).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByTestId('provider-card').filter({ hasText: 'Frio Bom' })).toBeVisible();
  await visitor.close();
});

test('admin desativa serviço e mantém vínculos; adiciona sinônimo', async ({ page }) => {
  await page.goto('/entrar?next=/admin');
  await login(page, demoEmail('admin'));
  await page.waitForURL((u) => u.pathname === '/admin');
  await page.goto('/admin?aba=catalogo');
  const cat = page.locator('details').filter({ hasText: 'Piscina, jardim e área externa' });
  await cat.locator('summary').click();
  const item = cat.locator('li').filter({ hasText: /^Piscineiro/ });
  await item.getByLabel('Novo sinônimo para Piscineiro').fill('piscina suja');
  await item.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText('Sinônimo “piscina suja” adicionado')).toBeVisible();
  const { data } = await admin.rpc('search_providers', { p_q: 'piscina suja' });
  expect(data.map((r: { slug: string }) => r.slug)).toContain('rafa-demo');
  // desativa e reativa
  await page.locator('details').filter({ hasText: 'Piscina, jardim e área externa' }).locator('summary').click();
  const pisc = page.locator('details').filter({ hasText: 'Piscina, jardim e área externa' }).locator('li').filter({ hasText: /^Piscineiro/ });
  await pisc.getByRole('button', { name: 'Desativar' }).click();
  await expect.poll(async () => (await admin.from('services').select('active').eq('slug', 'piscineiro').single()).data!.active).toBe(false);
  const off = await admin.rpc('search_providers', { p_q: 'piscineiro' });
  expect(off.data.map((r: { slug: string }) => r.slug)).not.toContain('rafa-demo'); // inativo sai da busca por termo
  const { count } = await admin.from('provider_services').select('*', { count: 'exact', head: true }).eq('service_id', (await admin.from('services').select('id').eq('slug', 'piscineiro').single()).data!.id);
  expect(count).toBeGreaterThan(0);
  await admin.from('services').update({ active: true }).eq('slug', 'piscineiro');
  await admin.from('service_synonyms').delete().eq('term', 'piscina suja');
});

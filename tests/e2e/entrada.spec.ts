import { test } from '@playwright/test';
import { expect, reseed } from './helpers';

test.beforeAll(reseed);

test('página de entrada: explica cada área, vitrine de vagas sem empresa nem salário e sem navegação interna', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gente de confiança, perto de você.');
  await expect(page.getByTestId('cta-criar')).toHaveAttribute('href', '/cadastrar');
  await expect(page.getByTestId('cta-entrar')).toHaveAttribute('href', '/entrar');
  const areas = page.getByTestId('entrada-areas').getByRole('link');
  await expect(areas).toHaveCount(6);
  await expect(page.getByTestId('area-emprego')).toContainText('Ninguém cobra para você conseguir vaga.');
  await expect(page.getByTestId('area-prestar')).toHaveAttribute('href', '/cadastrar?next=%2Fsou-prestador');
  // sem conta não aparece a barra do app
  await expect(page.getByRole('navigation', { name: 'Navegação rápida' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
  // vitrine: total e títulos, sem empresa, salário ou contato
  await expect(page.getByTestId('vitrine-total')).toHaveText('3 vagas abertas');
  await expect(page.getByTestId('vitrine-vaga')).toHaveCount(3);
  const vitrine = page.getByTestId('vitrine-vagas');
  await expect(vitrine).not.toContainText('R$');
  await expect(vitrine).not.toContainText('Restaurante');
  await page.getByLabel('Qual vaga você procura?').fill('cozinha');
  await page.getByRole('button', { name: 'Ver vagas' }).click();
  await expect(page.getByTestId('vitrine-total')).toHaveText('1 vaga aberta para “cozinha”');
  await expect(page.getByTestId('vitrine-vaga')).toHaveText(['Auxiliar de cozinha (demo) · Centro · CLT (carteira assinada)']);
  await page.getByLabel('Qual vaga você procura?').fill('astronauta');
  await page.getByRole('button', { name: 'Ver vagas' }).click();
  await expect(page.getByTestId('vitrine-total')).toHaveText('Nenhuma vaga aberta para “astronauta” agora.');
  // números de confiança só quando não são zero
  await expect(page.getByTestId('confianca')).toContainText('4 profissionais verificados');
  await expect(page.getByTestId('confianca')).not.toContainText('serviços concluídos');
  await expect(page.getByTestId('seguranca')).toContainText('É proibido cobrar para alguém conseguir vaga.');
  // cada área leva ao cadastro e, depois, à área escolhida
  await page.getByTestId('area-comunidade').click();
  await expect(page).toHaveURL(/\/cadastrar\?next=%2Fcomunidade$/);
});

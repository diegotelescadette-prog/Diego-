import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
try { process.loadEnvFile('.env.local'); } catch { /* */ }

export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
export const PASSWORD = 'demo-senha-123';
export const demoEmail = (l: string) => `${l}@demo.resolveaqui.test`;
export const reseed = async () => {
  await admin.from('app_settings').upsert({ key: 'verificacao_obrigatoria', value: { enabled: false } });
  execSync('npm run -s seed:demo', { stdio: 'ignore' });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users.filter((x) => x.email?.endsWith('@teste.resolveaqui.test'))) await admin.auth.admin.deleteUser(u.id);
  await admin.from('services').update({ active: true }).eq('slug', 'piscineiro');
  await admin.from('service_synonyms').delete().eq('term', 'piscina suja');
  await admin.from('rate_events').delete().gte('id', 0); // zera limites de frequência entre execuções
  await admin.from('service_categories').update({ active: false }).eq('slug', 'credito-imobiliario');
  await admin.from('app_settings').upsert({ key: 'verificacao_obrigatoria', value: { enabled: false } });
};

/** Intercepta a abertura do WhatsApp e devolve a URL gerada. */
export async function captureWhatsApp(page: Page) {
  const urls: string[] = [];
  await page.route(/https:\/\/(wa\.me|api\.whatsapp\.com)\/.*/, async (route) => {
    urls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>WhatsApp (simulado)</body></html>' });
  });
  return urls;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Desde o v3 todo o app exige conta: abre `path` já entrando com uma conta (por padrão, a de quem só lê). */
export async function enter(page: Page, path: string, local = 'leitor') {
  await page.goto(`/entrar?next=${encodeURIComponent(path)}`);
  await login(page, demoEmail(local));
  await expect(page).not.toHaveURL(/\/entrar/);
}

/** Preenche os dados do cadastro (os mesmos no "Criar conta" e no "Complete seu cadastro"). */
export async function fillSignup(page: Page, o: { nome?: string; publico?: string; celular?: string; bairro?: string } = {}) {
  await page.getByLabel('Nome completo').fill(o.nome ?? 'Maria Teste da Silva');
  await page.getByLabel('Nome público').fill(o.publico ?? 'Maria do Centro');
  await page.getByLabel('Celular com WhatsApp').fill(o.celular ?? '(67) 99876-5432');
  await page.getByLabel('Bairro de Campo Grande').selectOption({ label: o.bairro ?? 'Centro' });
  await page.getByLabel(/Li e aceito/).check();
}

export async function lastMailLink(to: string, kind: 'signup' | 'recovery'): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const mails: { to: string[]; raw: string }[] = await (await fetch('http://localhost:54321/_mail')).json();
    const m = mails.reverse().find((x) => x.to.includes(to) && x.raw.includes(`type=${kind}`));
    if (m) return m.raw.match(/http:\/\/localhost:54321\/auth\/v1\/verify\?[^"\s<>]+/)![0].replace(/&amp;/g, '&');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('e-mail não chegou');
}

export async function profileId(slug: string) {
  const { data } = await admin.from('provider_profiles').select('id').eq('slug', slug).single();
  return data!.id as string;
}

export { expect };

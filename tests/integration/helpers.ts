// Integração contra a stack local (ver docs/TESTES.md). Exige `npm run seed:demo` antes.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
try { process.loadEnvFile('.env.local'); } catch { /* ambiente */ }

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const APP = process.env.APP_URL ?? 'http://localhost:3000';
export const PASSWORD = 'demo-senha-123';
export const DOMAIN = 'demo.resolveaqui.test';

export const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
export const anon = () => createClient(URL, ANON, { auth: { persistSession: false } });

export async function signIn(local: string): Promise<SupabaseClient> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: `${local}@${DOMAIN}`, password: PASSWORD });
  if (error) throw error;
  return c;
}

/** Conta comum de quem só lê (sem posts, reações ou seguidores): desde o v3, ver o conteúdo exige conta. */
let reader: Promise<SupabaseClient> | null = null;
export const viewer = () => (reader ??= signIn('leitor'));

export async function profileId(key: string): Promise<string> {
  const { data } = await admin.from('provider_profiles').select('id').eq('slug', `${key}-demo`).single();
  return data!.id;
}
export async function ids() {
  const { data: s } = await admin.from('services').select('id, slug');
  const { data: n } = await admin.from('neighborhoods').select('id, slug');
  return {
    svc: (slug: string) => s!.find((x) => x.slug === slug)!.id as number,
    nb: (slug: string) => n!.find((x) => x.slug === slug)!.id as number,
  };
}
/** Cookie de sessão do app (o mesmo que o navegador guarda ao entrar), para chamar rotas que exigem conta. */
const sessions = new Map<string, Promise<string>>();
export function appCookie(local: string): Promise<string> {
  if (!sessions.has(local)) sessions.set(local, (async () => {
    const jar = new Map<string, string>();
    const c = createServerClient(URL, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
    const { error } = await c.auth.signInWithPassword({ email: `${local}@${DOMAIN}`, password: PASSWORD });
    if (error) throw error;
    return [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
  })());
  return sessions.get(local)!;
}

export async function urgentContact(body: object, ip = `10.0.0.${Math.floor(Math.random() * 250)}`, as: string | null = 'leitor') {
  const res = await fetch(`${APP}/api/contact/urgent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(as ? { cookie: await appCookie(as) } : {}) }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

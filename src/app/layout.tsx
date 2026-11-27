import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { setTheme } from '@/app/tema/actions';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/inter';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { AutoTheme } from '@/components/AutoTheme';
import { getIsAdmin, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { APP_NAME, PILOT_TAGLINE } from '@/config/brand';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: PILOT_TAGLINE,
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#faf7f2' }, { media: '(prefers-color-scheme: dark)', color: '#17150f' }],
};

/** No modo Automático, aplica o tema do aparelho antes de pintar (sem piscar) e acompanha a troca. */
const AUTO_THEME = `(function(){try{var m=window.matchMedia('(prefers-color-scheme: dark)');var s=function(){document.documentElement.dataset.theme=m.matches?'dark':'light'};s();m.addEventListener('change',s)}catch(e){}})()`;

async function unreadCount(userId: string | undefined) {
  if (!userId) return 0;
  const supabase = await createClient();
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
  return count ?? 0;
}

async function hasOwnProfile(userId: string | undefined) {
  if (!userId) return false;
  const supabase = await createClient();
  const { data } = await supabase.from('provider_profiles').select('id').eq('id', userId).maybeSingle();
  return !!data;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const [isAdmin, hasProfile, unread, jar] = await Promise.all([getIsAdmin(), hasOwnProfile(user?.id), unreadCount(user?.id), cookies()]);
  const tema = jar.get('tema')?.value === 'escuro' ? 'escuro' : jar.get('tema')?.value === 'claro' ? 'claro' : 'auto';
  const footer = (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-stone-600">
        <span>© {new Date().getFullYear()} {APP_NAME} · Piloto em Campo Grande–MS</span>
        <Link href="/privacidade" className="underline">Privacidade</Link>
        <Link href="/termos" className="underline">Termos de uso</Link>
        <form action={setTheme} className="flex flex-wrap items-center gap-x-3" aria-label="Aparência" data-testid="theme-picker">
          <span>Aparência:</span>
          {([['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']] as const).map(([v, label]) => (
            <button key={v} type="submit" name="tema" value={v} className="theme-opt min-h-11 underline" aria-pressed={tema === v}>{label}</button>
          ))}
        </form>
      </div>
    </footer>
  );
  return (
    <html lang="pt-BR" data-theme={tema === 'escuro' ? 'dark' : tema === 'claro' ? 'light' : undefined} suppressHydrationWarning>
      {tema === 'auto' && <head><script dangerouslySetInnerHTML={{ __html: AUTO_THEME }} /></head>}
      <body className="flex min-h-dvh flex-col">
        {tema === 'auto' && <AutoTheme />}
        <AppShell viewer={{ loggedIn: !!user, hasProfile, isAdmin, email: user?.email ?? null, unread }} footer={footer}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}

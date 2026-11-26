import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { getIsAdmin, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { APP_NAME, PILOT_TAGLINE } from '@/config/brand';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: PILOT_TAGLINE,
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f7f5f1' };

async function hasOwnProfile(userId: string | undefined) {
  if (!userId) return false;
  const supabase = await createClient();
  const { data } = await supabase.from('provider_profiles').select('id').eq('id', userId).maybeSingle();
  return !!data;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const [isAdmin, hasProfile] = await Promise.all([getIsAdmin(), hasOwnProfile(user?.id)]);
  const footer = (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-stone-600">
        <span>© {new Date().getFullYear()} {APP_NAME} · Piloto em Campo Grande–MS</span>
        <Link href="/privacidade" className="underline">Privacidade</Link>
        <Link href="/sou-prestador" className="underline">Sou prestador</Link>
      </div>
    </footer>
  );
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh flex-col">
        <AppShell viewer={{ loggedIn: !!user, hasProfile, isAdmin, email: user?.email ?? null }} footer={footer}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}

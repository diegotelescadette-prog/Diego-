import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { Header, MobileNav } from '@/components/Header';
import { APP_NAME, PILOT_TAGLINE } from '@/config/brand';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: PILOT_TAGLINE,
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f5f73' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh flex-col">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
          Pular para o conteúdo
        </a>
        <Header />
        <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-stone-600">
            <span>© {new Date().getFullYear()} {APP_NAME} · Piloto em Campo Grande–MS</span>
            <Link href="/privacidade" className="underline">Privacidade</Link>
            <Link href="/sou-prestador" className="underline">Sou prestador</Link>
          </div>
        </footer>
        <MobileNav />
      </body>
    </html>
  );
}

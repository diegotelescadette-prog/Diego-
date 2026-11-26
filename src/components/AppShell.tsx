'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Logo } from './Logo';
import { BottomNav } from './BottomNav';
import { Glyph } from './CategoryIcon';
import { activeHref, areaFor, mainItems, NAV_ICONS, navItems, type NavArea, type NavItem, type NavViewer } from '@/lib/nav';

const AREA_LABEL: Record<NavArea, string> = { busca: 'Menu principal', prestador: 'Painel do prestador', admin: 'Administração' };

/** Barra superior do computador: os mesmos 5 itens da barra inferior do celular, à direita do logo. */
function TopNav({ viewer }: { viewer: NavViewer }) {
  const path = usePathname();
  const items = mainItems(viewer);
  const on = activeHref(items, path);
  return (
    <nav aria-label="Principal" className="hidden items-center gap-1 md:flex" data-testid="top-nav">
      {items.map((it) => (
        <Link key={it.label} href={it.href} aria-current={it.href === on ? 'page' : undefined} className={`top-link${it.icon === 'plus' ? ' top-create' : ''}`}>
          <Glyph d={NAV_ICONS[it.icon]} size={18} />{it.label}
        </Link>
      ))}
    </nav>
  );
}

/** Abas da área do painel do prestador e da administração, no topo do conteúdo (rolam de lado no celular). */
function AreaTabs({ viewer, section }: { viewer: NavViewer; section: string | null }) {
  const path = usePathname();
  const area = areaFor(path);
  const items: NavItem[] = navItems(area, viewer);
  if (!items.length) return null;
  const on = activeHref(items, path, section);
  return (
    <nav aria-label={AREA_LABEL[area]} className="area-tabs" data-testid="area-tabs">
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={it.href === on ? 'page' : undefined} className="area-tab">
          <Glyph d={NAV_ICONS[it.icon]} size={16} />{it.label}
        </Link>
      ))}
    </nav>
  );
}

function AreaTabsWithSection({ viewer }: { viewer: NavViewer }) {
  const sp = useSearchParams();
  return <AreaTabs viewer={viewer} section={sp.get('aba')} />;
}

function Bell({ unread }: { unread: number }) {
  const label = unread ? `Notificações, ${unread} ${unread === 1 ? 'nova' : 'novas'}` : 'Notificações';
  return (
    <Link href="/notificacoes" className="btn-ghost relative min-h-11 px-2.5" aria-label={label} data-testid="bell">
      <Glyph d={NAV_ICONS.bell} size={22} />
      {unread > 0 && <span className="bell-count" data-testid="bell-count">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}

export function AppShell({ viewer, children, footer }: {
  viewer: NavViewer & { email?: string | null; unread?: number }; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <Link href="/" aria-label="Página inicial" className="flex-none"><Logo /></Link>
          {/* Sem conta não há navegação: tudo fica do lado de dentro, depois do login. */}
          <div className="flex min-w-0 flex-1 justify-end md:justify-center">{viewer.loggedIn && <TopNav viewer={viewer} />}</div>
          <div className="flex items-center gap-1">
            {viewer.loggedIn
              ? <Bell unread={viewer.unread ?? 0} />
              : <Link href="/entrar" className="btn-outline min-h-10 px-3 py-1.5 text-sm sm:text-base">Entrar</Link>}
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6">
        <Suspense fallback={<AreaTabs viewer={viewer} section={null} />}><AreaTabsWithSection viewer={viewer} /></Suspense>
        {children}
      </main>
      {footer}
      {viewer.loggedIn && <BottomNav viewer={viewer} />}
    </>
  );
}

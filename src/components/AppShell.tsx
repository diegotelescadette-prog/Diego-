'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from './Logo';
import { BottomNav } from './BottomNav';
import { Glyph } from './CategoryIcon';
import { activeHref, areaFor, NAV_ICONS, navItems, screenTitle, showBottomNav, type NavArea, type NavItem, type NavViewer } from '@/lib/nav';

const AREA_LABEL: Record<NavArea, string> = { busca: 'Menu principal', prestador: 'Painel do prestador', admin: 'Administração' };

function NavLink({ it, on, onNavigate }: { it: NavItem; on: boolean; onNavigate?: () => void }) {
  return (
    <li>
      <Link href={it.href} onClick={onNavigate} aria-current={on ? 'page' : undefined}
        className={`side-link${it.urgent ? ' side-urgent' : ''}`}>
        {it.tone ? <span className={`side-ic tone-${it.tone}`}><Glyph d={NAV_ICONS[it.icon]} size={18} /></span> : <Glyph d={NAV_ICONS[it.icon]} size={20} />}
        <span className="min-w-0 flex-1">
          <span className="block">{it.label}</span>
          {it.hint && <span className="side-hint">{it.hint}</span>}
        </span>
        {on && <span className="side-on">atual</span>}
      </Link>
    </li>
  );
}

/** Lista de botões laterais. Usada no menu do computador e na gaveta do celular. Com `group`, separa por assunto. */
function NavList({ items, active, onNavigate }: { items: NavItem[]; active: string | null; onNavigate?: () => void }) {
  const groups = [...new Set(items.map((it) => it.group))];
  if (groups.length === 1 && !groups[0]) {
    return <ul className="space-y-1">{items.map((it) => <NavLink key={it.href} it={it} on={it.href === active} onNavigate={onNavigate} />)}</ul>;
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g ?? ''}>
          {g && <p className="side-heading">{g}</p>}
          <ul className="space-y-1">
            {items.filter((it) => it.group === g).map((it) => <NavLink key={it.href} it={it} on={it.href === active} onNavigate={onNavigate} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function OtherAreas({ area, viewer, onNavigate }: { area: NavArea; viewer: NavViewer; onNavigate?: () => void }) {
  const links: { href: string; label: string }[] = [];
  if (area === 'admin' && viewer.hasProfile) links.push({ href: '/painel', label: 'Painel do prestador' });
  if (area !== 'admin' && viewer.isAdmin) links.push({ href: '/admin', label: 'Administração' });
  if (!links.length) return null;
  return (
    <div className="mt-4 border-t border-stone-200 pt-3">
      <p className="side-heading">Outras áreas</p>
      <ul className="space-y-1">
        {links.map((l) => <li key={l.href}><Link href={l.href} onClick={onNavigate} className="side-link">{l.label}</Link></li>)}
      </ul>
    </div>
  );
}

function Navigation({ viewer, onNavigate, section }: { viewer: NavViewer; onNavigate?: () => void; section: string | null }) {
  const path = usePathname();
  const area = areaFor(path);
  const items = navItems(area, viewer);
  return (
    <nav aria-label={AREA_LABEL[area]}>
      {area !== 'busca' && !items.some((it) => it.group) && <p className="side-heading">{AREA_LABEL[area]}</p>}
      <NavList items={items} active={activeHref(items, path, section)} onNavigate={onNavigate} />
      <OtherAreas area={area} viewer={viewer} onNavigate={onNavigate} />
    </nav>
  );
}

function NavigationWithSection(props: { viewer: NavViewer; onNavigate?: () => void }) {
  const sp = useSearchParams();
  return <Navigation {...props} section={sp.get('aba')} />;
}

/** Navegação com a seção do admin (lida da URL) e um substituto sem ela durante a renderização estática. */
function SideNav(props: { viewer: NavViewer; onNavigate?: () => void }) {
  return (
    <Suspense fallback={<Navigation {...props} section={null} />}>
      <NavigationWithSection {...props} />
    </Suspense>
  );
}

function Title() {
  const path = usePathname();
  const sp = useSearchParams();
  const t = screenTitle(path, sp.get('aba'));
  return t ? <p className="hidden truncate text-lg font-bold text-stone-800 md:block" data-testid="screen-title">{t}</p> : null;
}

function AccountActions({ viewer }: { viewer: NavViewer & { email?: string | null } }) {
  if (!viewer.loggedIn) {
    return (
      <>
        <Link href="/entrar" className="btn-outline min-h-10 px-3 py-1.5 text-sm sm:text-base">Entrar</Link>
      </>
    );
  }
  return (
    <details className="relative">
      <summary className="btn-ghost cursor-pointer list-none" aria-label="Abrir menu do perfil">Perfil ▾</summary>
      <ul className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-2 shadow-lg">
        {viewer.email && <li className="truncate px-3 py-1 text-sm text-stone-600">{viewer.email}</li>}
        <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/conta">Minha conta</Link></li>
        <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/agenda">Minha agenda</Link></li>
        <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/pedidos">Meus pedidos</Link></li>
        <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/minhas-candidaturas">Minhas candidaturas</Link></li>
        <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/minhas-vagas">Vagas que publiquei</Link></li>
        <li>
          <Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href={viewer.hasProfile ? '/painel' : '/painel/perfil'}>
            {viewer.hasProfile ? 'Painel do profissional' : 'Trabalhe com a gente'}
          </Link>
        </li>
        {viewer.isAdmin && <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/admin">Administração</Link></li>}
        <li>
          <form action="/auth/sair" method="post">
            <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-brand-50" type="submit">Sair</button>
          </form>
        </li>
      </ul>
    </details>
  );
}

/** Gaveta do celular: abre pelo botão "Menu", fecha com Escape, no fundo escuro ou ao navegar, e devolve o foco ao botão. */
function Drawer({ open, onClose, viewer, returnFocusTo }: {
  open: boolean; onClose: () => void; viewer: NavViewer; returnFocusTo: React.RefObject<HTMLButtonElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const first = panel.current?.querySelector<HTMLElement>('a, button');
      first?.focus();
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
    if (wasOpen.current) { wasOpen.current = false; returnFocusTo.current?.focus(); }
  }, [open, returnFocusTo]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('a, button') ?? [])];
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-stone-900/50" aria-hidden="true" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Menu" id="menu-gaveta"
        className="absolute inset-y-0 left-0 flex w-[min(85vw,320px)] flex-col overflow-y-auto bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <Logo />
          <button type="button" className="btn-ghost min-h-11 px-3" onClick={onClose}>Fechar <span aria-hidden="true">✕</span></button>
        </div>
        <SideNav viewer={viewer} onNavigate={onClose} />
        <div className="mt-auto border-t border-stone-200 pt-3">
          {viewer.loggedIn ? (
            <form action="/auth/sair" method="post"><button className="side-link w-full" type="submit">Sair</button></form>
          ) : (
            <Link href="/entrar" onClick={onClose} className="btn-outline w-full">Entrar</Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ viewer, children, footer }: {
  viewer: NavViewer & { email?: string | null }; children: React.ReactNode; footer: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { setOpen(false); }, [path]);
  const bottom = showBottomNav(path);

  return (
    <>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:px-4">
          <button ref={menuBtn} type="button" className="btn-ghost min-h-11 px-2.5 md:hidden" aria-expanded={open} aria-controls="menu-gaveta"
            onClick={() => setOpen(true)}>
            <Glyph d="M4 6h16M4 12h16M4 18h16" size={22} /> Menu
          </button>
          <Link href="/" aria-label="Página inicial" className="md:w-[236px] md:flex-none"><Logo /></Link>
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <Suspense fallback={null}><Title /></Suspense>
            {!path.startsWith('/buscar') && path !== '/' && <form action="/buscar" method="get" role="search" className="hidden min-w-0 flex-1 md:block md:max-w-md" data-testid="header-search">
              <label htmlFor="hq" className="sr-only">Que serviço você procura?</label>
              <input id="hq" name="q" className="input min-h-10 rounded-full border-line py-1.5" placeholder="Que serviço você procura?" enterKeyHint="search" />
            </form>}
          </div>
          <nav aria-label="Conta" className="flex items-center gap-1 text-sm sm:text-base">
            <AccountActions viewer={viewer} />
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl flex-1 md:grid md:grid-cols-[252px_minmax(0,1fr)]">
        <aside className="sidebar hidden md:block">
          <SideNav viewer={viewer} />
        </aside>
        <main id="conteudo" className="min-w-0 px-4 py-6">{children}</main>
      </div>
      {footer}
      <Drawer open={open} onClose={close} viewer={viewer} returnFocusTo={menuBtn} />
      {bottom && <BottomNav accountHref={viewer.loggedIn ? '/conta' : '/entrar'} />}
    </>
  );
}

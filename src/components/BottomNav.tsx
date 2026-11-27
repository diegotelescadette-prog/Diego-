'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph } from './CategoryIcon';
import { activeHref, mainItems, NAV_ICONS, type NavViewer } from '@/lib/nav';

/** Barra fixa no celular (some a partir de 768px): Início · Comunidade · (+) Criar · Agenda · Perfil. */
export function BottomNav({ viewer }: { viewer: NavViewer }) {
  const path = usePathname();
  const items = mainItems(viewer);
  const on = activeHref(items, path);
  return (
    <nav className="bottom" aria-label="Navegação rápida">
      {items.map((i) => (
        <Link key={i.label} href={i.href} className={`bn${i.icon === 'plus' ? ' bn-primary' : ''}`} aria-current={i.href === on ? 'page' : undefined}>
          <span className="bn-ico"><Glyph d={NAV_ICONS[i.icon]} size={22} /></span><span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph } from './CategoryIcon';

const HOME = 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z';
const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const HEART = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z';
const USER = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0';

/** Barra de navegação fixa no celular (some a partir de 768px). */
export function BottomNav({ proHref, proLabel }: { proHref: string; proLabel: string }) {
  const path = usePathname();
  const items = [
    { href: '/', label: 'Início', d: HOME, on: path === '/' || path.startsWith('/hoje') },
    { href: '/buscar', label: 'Buscar', d: SEARCH, on: path.startsWith('/buscar') || path.startsWith('/p/') },
    { href: '/favoritos', label: 'Favoritos', d: HEART, on: path.startsWith('/favoritos') },
    { href: proHref, label: proLabel, d: USER, on: path.startsWith('/painel') || path.startsWith('/sou-prestador') || path.startsWith('/conta') },
  ];
  return (
    <nav className="bottom" aria-label="Navegação rápida">
      {items.map((i) => (
        <Link key={i.label} href={i.href} className="bn" aria-current={i.on ? 'page' : undefined}>
          <Glyph d={i.d} size={22} /><span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph } from './CategoryIcon';

const HOME = 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z';
const TAG = 'M3 12V4h8l10 10-8 8zM7.5 7.5a1 1 0 1 0 .01 0';
const CLIP = 'M8 4h8v3H8zM6 5H5v16h14V5h-1M8 12h8M8 16h5';
const USERS = 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 4 6';
const USER = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0';

/** Barra fixa no celular (some a partir de 768px): Início · Serviços · Pedidos · Comunidade · Conta. */
export function BottomNav({ accountHref }: { accountHref: string }) {
  const path = usePathname();
  const items = [
    { href: '/', label: 'Início', d: HOME, on: path === '/' },
    { href: '/servicos', label: 'Serviços', d: TAG, on: path.startsWith('/servicos') || path.startsWith('/agendar') || path.startsWith('/buscar') || path.startsWith('/p/') || path.startsWith('/hoje') },
    { href: '/pedidos', label: 'Pedidos', d: CLIP, on: path.startsWith('/pedidos') },
    { href: '/comunidade', label: 'Comunidade', d: USERS, on: path.startsWith('/comunidade') || path.startsWith('/publicar') || path.startsWith('/vagas') || path.startsWith('/minhas-') },
    { href: accountHref, label: 'Conta', d: USER, on: path.startsWith('/painel') || path.startsWith('/sou-prestador') || path.startsWith('/conta') || path.startsWith('/favoritos') || path.startsWith('/entrar') },
  ];
  return (
    <nav className="bottom" aria-label="Navegação rápida">
      {items.map((i) => (
        <Link key={i.label} href={i.href} className="bn" aria-current={i.on ? 'page' : undefined}>
          <span className="bn-ico"><Glyph d={i.d} size={22} /></span><span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}

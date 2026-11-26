'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph } from './CategoryIcon';

const HOME = 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z';
const TAG = 'M3 12V4h8l10 10-8 8zM7.5 7.5a1 1 0 1 0 .01 0';
const BAG = 'M4 8h16v11H4zM9 8V5h6v3M4 13h16';
const CAL = 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3';
const USER = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0';

/** Barra fixa no celular (some a partir de 768px): Início · Serviços · Trabalho · Agenda · Perfil. */
export function BottomNav({ accountHref }: { accountHref: string }) {
  const path = usePathname();
  const starts = (...ps: string[]) => ps.some((p) => path === p || path.startsWith(p + '/') || (p.endsWith('/') && path.startsWith(p)));
  const items = [
    { href: '/', label: 'Início', d: HOME, on: path === '/' },
    { href: '/servicos', label: 'Serviços', d: TAG, on: starts('/servicos', '/agendar', '/buscar', '/p/', '/hoje') },
    { href: '/vagas', label: 'Trabalho', d: BAG, on: starts('/vagas', '/minhas-vagas', '/minhas-candidaturas', '/curriculo') },
    { href: '/agenda', label: 'Agenda', d: CAL, on: starts('/agenda', '/pedidos') },
    { href: accountHref, label: 'Perfil', d: USER, on: starts('/painel', '/sou-prestador', '/conta', '/favoritos', '/entrar', '/comunidade', '/publicar', '/minhas-publicacoes') },
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

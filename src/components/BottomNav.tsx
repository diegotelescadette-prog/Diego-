'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph } from './CategoryIcon';

const HOME = 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z';
const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const PLUS = 'M12 5v14M5 12h14';
const JOBS = 'M4 8h16v11H4zM9 8V5h6v3M4 13h16';
const USER = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0';

/** Barra fixa no celular (some a partir de 768px): Comunidade · Buscar · Publicar · Vagas · Conta. */
export function BottomNav({ accountHref }: { accountHref: string }) {
  const path = usePathname();
  const items = [
    { href: '/', label: 'Comunidade', d: HOME, on: path === '/' || path.startsWith('/comunidade/') },
    { href: '/buscar', label: 'Buscar', d: SEARCH, on: path.startsWith('/buscar') || path.startsWith('/p/') || path.startsWith('/hoje') },
    { href: '/publicar', label: 'Publicar', d: PLUS, on: path.startsWith('/publicar') || path.startsWith('/minhas-publicacoes'), primary: true },
    { href: '/vagas', label: 'Vagas', d: JOBS, on: path.startsWith('/vagas') || path.startsWith('/minhas-vagas') || path.startsWith('/minhas-candidaturas') },
    { href: accountHref, label: 'Conta', d: USER, on: path.startsWith('/painel') || path.startsWith('/sou-prestador') || path.startsWith('/conta') || path.startsWith('/favoritos') || path.startsWith('/entrar') },
  ];
  return (
    <nav className="bottom" aria-label="Navegação rápida">
      {items.map((i) => (
        <Link key={i.label} href={i.href} className={`bn${i.primary ? ' bn-primary' : ''}`} aria-current={i.on ? 'page' : undefined}>
          <span className="bn-ico"><Glyph d={i.d} size={22} /></span><span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}

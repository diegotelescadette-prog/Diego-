// Navegação lateral por área. Módulo puro (sem React) para ser testado em unidade.

export type NavArea = 'busca' | 'prestador' | 'admin';

export interface NavViewer {
  loggedIn: boolean;
  hasProfile: boolean;
  isAdmin: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof NAV_ICONS;
  /** Prefixos de caminho que deixam o item ativo (além do próprio href). */
  match?: string[];
  /** Destaque de urgência (laranja). */
  urgent?: boolean;
}

export const NAV_ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7V21h3.3l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  gauge: 'M4 19a9 9 0 1 1 16 0M12 13l4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  photo: 'M4 6h16v13H4zM4 15l4-4 5 5 3-3 4 4M15.5 9.5a1.5 1.5 0 1 0 .01 0',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 .01 0',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 .01 0',
  account: 'M4 5h16v14H4zM8 10a2 2 0 1 0 .01 0M6 16c.5-2 3.5-2 4 0M13 9h5M13 13h5',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 4 6',
  book: 'M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.5 1 2.5h6c0-1 .4-1.9 1-2.5A6 6 0 0 0 12 3z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  back: 'M15 18l-6-6 6-6',
} as const;

/** Área em uso a partir do caminho. */
export function areaFor(pathname: string): NavArea {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/painel' || pathname.startsWith('/painel/')) return 'prestador';
  return 'busca';
}

export function searchItems(v: NavViewer): NavItem[] {
  return [
    { href: '/', label: 'Início', icon: 'home', match: [] },
    { href: '/#preciso-para-hoje', label: 'Preciso para hoje', icon: 'bolt', urgent: true, match: ['/hoje'] },
    { href: '/buscar', label: 'Buscar serviços', icon: 'search', match: ['/buscar', '/p/'] },
    { href: '/#categorias', label: 'Categorias', icon: 'grid', match: [] },
    { href: '/favoritos', label: 'Favoritos', icon: 'heart', match: ['/favoritos'] },
    v.hasProfile
      ? { href: '/painel', label: 'Painel do prestador', icon: 'tool', match: [] }
      : { href: '/sou-prestador', label: 'Sou prestador', icon: 'tool', match: ['/sou-prestador'] },
  ];
}

export const PROVIDER_ITEMS: NavItem[] = [
  { href: '/painel', label: 'Visão geral', icon: 'gauge' },
  { href: '/painel/perfil', label: 'Meu perfil', icon: 'user' },
  { href: '/painel/servicos', label: 'Serviços e fotos', icon: 'photo' },
  { href: '/painel/atendimento', label: 'Onde atendo', icon: 'pin' },
  { href: '/painel/disponibilidade', label: 'Disponibilidade', icon: 'clock' },
  { href: '/painel/previa', label: 'Prévia do perfil', icon: 'eye' },
  { href: '/conta', label: 'Minha conta', icon: 'account' },
  { href: '/buscar', label: 'Buscar serviços', icon: 'back' },
];

export const ADMIN_SECTIONS = [
  { key: 'visao', label: 'Visão geral', icon: 'gauge' },
  { key: 'perfis', label: 'Prestadores', icon: 'users' },
  { key: 'catalogo', label: 'Catálogo', icon: 'book' },
  { key: 'sugestoes', label: 'Sugestões', icon: 'bulb' },
  { key: 'denuncias', label: 'Denúncias', icon: 'flag' },
  { key: 'historico', label: 'Histórico', icon: 'history' },
  { key: 'config', label: 'Configurações', icon: 'gear' },
] as const satisfies readonly { key: string; label: string; icon: keyof typeof NAV_ICONS }[];

export type AdminSection = (typeof ADMIN_SECTIONS)[number]['key'];

export function adminSection(aba: string | null | undefined): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.key === aba)?.key ?? 'visao';
}

export const ADMIN_ITEMS: NavItem[] = [
  ...ADMIN_SECTIONS.map((s) => ({ href: `/admin?aba=${s.key}`, label: s.label, icon: s.icon })),
  { href: '/buscar', label: 'Voltar à busca', icon: 'back' },
];

/** Itens do menu lateral para a área e para quem está usando. */
export function navItems(area: NavArea, v: NavViewer): NavItem[] {
  if (area === 'admin' && v.isAdmin) return ADMIN_ITEMS;
  if (area === 'prestador' && v.loggedIn) return PROVIDER_ITEMS;
  return searchItems(v);
}

/** Item ativo: caminho exato (e seção, no admin) vale mais que um prefixo de `match`. */
export function activeHref(items: NavItem[], pathname: string, section?: string | null): string | null {
  let best: { href: string; score: number } | null = null;
  for (const it of items) {
    const [pathHash, query] = it.href.split('?');
    const [path, hash] = pathHash.split('#');
    let score = -1;
    if (query) {
      if (pathname === path && adminSection(section) === new URLSearchParams(query).get('aba')) score = 3;
    } else if (hash === undefined && pathname === path) score = 2;
    if ((it.match ?? []).some((m) => pathname === m || pathname.startsWith(m))) score = Math.max(score, 1);
    if (score >= 0 && (!best || score > best.score)) best = { href: it.href, score };
  }
  return best?.href ?? null;
}

/** Nome da tela exibido no cabeçalho. */
export function screenTitle(pathname: string, section?: string | null): string {
  if (pathname.startsWith('/admin')) {
    return `Administração · ${ADMIN_SECTIONS.find((s) => s.key === adminSection(section))!.label}`;
  }
  const exact: Record<string, string> = {
    '/': 'Início', '/buscar': 'Buscar serviços', '/hoje': 'Preciso para hoje', '/favoritos': 'Favoritos',
    '/painel': 'Painel do prestador', '/painel/perfil': 'Meu perfil', '/painel/servicos': 'Serviços e fotos',
    '/painel/atendimento': 'Onde atendo', '/painel/disponibilidade': 'Disponibilidade', '/painel/previa': 'Prévia do perfil',
    '/conta': 'Minha conta', '/entrar': 'Entrar', '/cadastrar': 'Criar conta', '/privacidade': 'Privacidade',
    '/sugerir-servico': 'Sugerir um serviço', '/recuperar-senha': 'Recuperar senha', '/redefinir-senha': 'Nova senha',
  };
  if (exact[pathname]) return exact[pathname];
  if (pathname.startsWith('/p/')) return 'Perfil do prestador';
  return '';
}

/** A barra inferior do celular fica só na área de busca. */
export function showBottomNav(pathname: string): boolean {
  return areaFor(pathname) === 'busca';
}

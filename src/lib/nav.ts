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
  /** Assunto do menu de busca (título acima do grupo). */
  group?: string;
  /** Frase curta embaixo do nome, explicando a opção. */
  hint?: string;
  /** Tom pastel do fundo do ícone. */
  tone?: NavTone;
}

export type NavTone = 'sage' | 'sand' | 'sky' | 'lavender' | 'rose';

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
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  megaphone: 'M3 10v4h3l7 4V6L6 10zM16 9a3 3 0 0 1 0 6M19 7a6 6 0 0 1 0 10',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5a1 1 0 1 0 .01 0',
  clipboard: 'M8 4h8v3H8zM6 5H5v16h14V5h-1M8 12h8M8 16h5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  rocket: 'M14 4c3 0 6 1 6 1s1 3 1 6c-2 4-6 7-9 8l-4-4c1-3 4-7 6-11zM9 15l-4 1 1-4M15 9a1 1 0 1 0 .01 0M6 18c-1 1-2 3-2 3s2-1 3-2',
} as const;

/** Área em uso a partir do caminho. */
export function areaFor(pathname: string): NavArea {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/painel' || pathname.startsWith('/painel/')) return 'prestador';
  return 'busca';
}

/**
 * Navegação principal (v3, sem menu lateral): os mesmos 5 itens na barra inferior do celular
 * e na barra superior do computador. O resto fica na tela inicial, no (+) Criar e no Perfil.
 */
export function mainItems(v: NavViewer): NavItem[] {
  return [
    { href: '/', label: 'Início', icon: 'home', match: ['/servicos', '/agendar/', '/hoje', '/buscar', '/p/', '/vagas', '/sou-prestador'] },
    { href: '/comunidade', label: 'Comunidade', icon: 'users', match: ['/comunidade', '/publicacoes', '/momentos/'] },
    { href: '/criar', label: 'Criar', icon: 'plus', match: ['/criar', '/publicar', '/momentos/novo'] },
    { href: '/agenda', label: 'Agenda', icon: 'calendar', match: ['/agenda', '/pedidos'] },
    { href: v.loggedIn ? '/perfil' : '/entrar', label: 'Perfil', icon: 'user',
      match: ['/perfil', '/conta', '/favoritos', '/curriculo', '/minhas-candidaturas', '/minhas-vagas', '/minhas-publicacoes', '/notificacoes', '/entrar', '/cadastrar'] },
  ];
}

/** Atalhos reunidos no Perfil (sem repetir os itens da barra). Admin só para administradores. */
export function profileLinks(v: NavViewer): (NavItem & { testid: string })[] {
  return [
    { href: '/conta', label: 'Minha conta', icon: 'account', hint: 'E-mail, senha e excluir conta', testid: 'perfil-conta' },
    { href: '/pedidos', label: 'Meus pedidos', icon: 'clipboard', hint: 'Serviços que você contratou', testid: 'perfil-pedidos' },
    { href: '/curriculo', label: 'Meu currículo', icon: 'file', hint: 'Monte, complete e baixe em PDF', testid: 'perfil-curriculo' },
    { href: '/minhas-candidaturas', label: 'Minhas candidaturas', icon: 'briefcase', hint: 'Vagas em que você se candidatou', testid: 'perfil-candidaturas' },
    { href: '/minhas-vagas', label: 'Minhas vagas', icon: 'megaphone', hint: 'Vagas que você publicou', testid: 'perfil-vagas' },
    v.hasProfile
      ? { href: '/painel', label: 'Meu painel de prestador', icon: 'tool', hint: 'Pedidos, perfil e “Atendo hoje”', testid: 'perfil-painel' }
      : { href: '/sou-prestador', label: 'Ofereço meus serviços', icon: 'tool', hint: 'Receba pedidos sem pagar para ver', testid: 'perfil-painel' },
    { href: '/minhas-publicacoes', label: 'Minhas publicações', icon: 'photo', hint: 'O que você publicou na comunidade', testid: 'perfil-publicacoes' },
    { href: '/favoritos', label: 'Favoritos e salvos', icon: 'heart', hint: 'Profissionais e publicações', testid: 'perfil-favoritos' },
    ...(v.isAdmin ? [{ href: '/admin', label: 'Administração', icon: 'gear', hint: 'Só para a equipe', testid: 'perfil-admin' } as NavItem & { testid: string }] : []),
  ];
}

/**
 * As seis áreas do app: os botões da tela inicial e da pergunta "O que você quer fazer primeiro?".
 * Os mesmos para todas as contas; a escolha só define o destino.
 */
export const FIRST_GOALS = [
  { key: 'servico', label: 'Preciso de um serviço', hint: 'Preço fechado e profissional verificado', href: '/servicos', icon: 'search' },
  { key: 'prestar', label: 'Ofereço meus serviços', hint: 'Mostre seus trabalhos e receba pedidos', href: '/sou-prestador', icon: 'tool' },
  { key: 'emprego', label: 'Procuro emprego', hint: 'Vagas de Campo Grande, sem pagar nada', href: '/vagas', icon: 'briefcase' },
  { key: 'vaga', label: 'Ofereço uma vaga', hint: 'Anuncie grátis e receba currículos', href: '/vagas/nova', icon: 'megaphone' },
  { key: 'comercio', label: 'Comércio', hint: 'Anuncie o que vende ou ache quem vende', href: '/comercio', icon: 'tag' },
  { key: 'comunidade', label: 'Comunidade', hint: 'O dia a dia da cidade e indicações', href: '/comunidade', icon: 'users' },
] as const satisfies readonly { key: string; label: string; hint: string; href: string; icon: keyof typeof NAV_ICONS }[];

export type FirstGoal = (typeof FIRST_GOALS)[number]['key'];

export const PROVIDER_ITEMS: NavItem[] = [
  { href: '/painel', label: 'Visão geral', icon: 'gauge' },
  { href: '/painel/pedidos', label: 'Pedidos para mim', icon: 'clipboard' },
  { href: '/painel/perfil', label: 'Meu perfil', icon: 'user' },
  { href: '/painel/servicos', label: 'Serviços e fotos', icon: 'photo' },
  { href: '/painel/pacotes', label: 'Pacotes que eu faço', icon: 'clipboard' },
  { href: '/painel/atendimento', label: 'Onde atendo', icon: 'pin' },
  { href: '/painel/disponibilidade', label: 'Disponibilidade', icon: 'clock' },
  { href: '/painel/verificacao', label: 'Verificação do perfil', icon: 'shield' },
  { href: '/painel/previa', label: 'Prévia do perfil', icon: 'eye' },
];

export const ADMIN_SECTIONS = [
  { key: 'visao', label: 'Visão geral', icon: 'gauge' },
  { key: 'lancamento', label: 'Preparar lançamento', icon: 'rocket' },
  { key: 'perfis', label: 'Prestadores', icon: 'users' },
  { key: 'catalogo', label: 'Catálogo', icon: 'book' },
  { key: 'sugestoes', label: 'Sugestões', icon: 'bulb' },
  { key: 'denuncias', label: 'Denúncias', icon: 'flag' },
  { key: 'publicacoes', label: 'Publicações', icon: 'photo' },
  { key: 'vagas', label: 'Vagas', icon: 'briefcase' },
  { key: 'palavras', label: 'Palavras bloqueadas', icon: 'shield' },
  { key: 'historico', label: 'Histórico', icon: 'history' },
  { key: 'config', label: 'Configurações', icon: 'gear' },
] as const satisfies readonly { key: string; label: string; icon: keyof typeof NAV_ICONS }[];

export type AdminSection = (typeof ADMIN_SECTIONS)[number]['key'];

export function adminSection(aba: string | null | undefined): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.key === aba)?.key ?? 'visao';
}

export const ADMIN_ITEMS: NavItem[] = [
  ...ADMIN_SECTIONS.slice(0, 2).map((s) => ({ href: `/admin?aba=${s.key}`, label: s.label, icon: s.icon })),
  { href: '/admin/pedidos', label: 'Pedidos', icon: 'clipboard', match: ['/admin/pedidos/'] },
  { href: '/admin/pacotes', label: 'Pacotes e preços', icon: 'tag' },
  { href: '/admin/contratantes', label: 'Contratantes', icon: 'shield' },
  ...ADMIN_SECTIONS.slice(2).map((s) => ({ href: `/admin?aba=${s.key}`, label: s.label, icon: s.icon })),
];

/** Abas da área (painel do prestador e administração), mostradas no topo do conteúdo. Fora delas, nada. */
export function navItems(area: NavArea, v: NavViewer): NavItem[] {
  if (area === 'admin' && v.isAdmin) return ADMIN_ITEMS;
  if (area === 'prestador' && v.loggedIn) return PROVIDER_ITEMS;
  return [];
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
  if (pathname.startsWith('/admin/verificacao')) return 'Administração · Verificação do perfil';
  if (pathname.startsWith('/admin/pedidos')) return 'Administração · Pedidos';
  if (pathname.startsWith('/admin/pacotes')) return 'Administração · Pacotes e preços';
  if (pathname.startsWith('/admin/contratantes')) return 'Administração · Contratantes';
  if (pathname.startsWith('/admin')) {
    return `Administração · ${ADMIN_SECTIONS.find((s) => s.key === adminSection(section))!.label}`;
  }
  const exact: Record<string, string> = {
    '/': '', '/agenda': 'Minha agenda', '/servicos': 'Serviços com preço fechado', '/pedidos': 'Meus pedidos', '/painel/pedidos': 'Pedidos para mim', '/comunidade': 'Comunidade', '/buscar': 'Buscar profissional', '/hoje': 'Preciso para hoje', '/favoritos': 'Salvos', '/minhas-publicacoes': 'Minhas publicações',
    '/painel': 'Painel do prestador', '/painel/perfil': 'Meu perfil', '/painel/servicos': 'Serviços e fotos',
    '/painel/atendimento': 'Onde atendo', '/painel/disponibilidade': 'Disponibilidade', '/painel/previa': 'Prévia do perfil',
    '/painel/verificacao': 'Verificação do perfil',
    '/notificacoes': 'Notificações', '/completar-cadastro': 'Complete seu cadastro', '/boas-vindas': 'Boas-vindas', '/termos': 'Termos de uso', '/conta': 'Minha conta', '/perfil': 'Perfil', '/criar': 'Criar', '/entrar': 'Entrar', '/cadastrar': 'Criar conta', '/privacidade': 'Privacidade',
    '/sugerir-servico': 'Sugerir um serviço', '/recuperar-senha': 'Recuperar senha', '/redefinir-senha': 'Nova senha',
    '/publicar': 'Criar publicação', '/vagas': 'Vagas de emprego', '/vagas/nova': 'Anunciar vaga', '/vagas/meu-curriculo': 'Banco de currículos', '/curriculo': 'Meu currículo', '/vagas/verificacao': 'Verificação de quem contrata', '/painel/pacotes': 'Pacotes que eu faço', '/vagas/banco': 'Banco de currículos', '/minhas-vagas': 'Vagas que publiquei', '/minhas-candidaturas': 'Minhas candidaturas',
  };
  if (pathname in exact) return exact[pathname];
  if (pathname.startsWith('/servicos/')) return 'Serviços com preço fechado';
  if (pathname.startsWith('/agendar/')) return 'Agendar';
  if (pathname.startsWith('/pedidos/')) return 'Pedido';
  if (pathname.startsWith('/p/')) return 'Perfil';
  if (pathname.startsWith('/comunidade/')) return pathname.endsWith('/editar') ? 'Editar publicação' : 'Publicação';
  if (pathname.startsWith('/minhas-vagas/')) return 'Candidatos da vaga';
  if (pathname.startsWith('/vagas/')) return pathname.endsWith('/editar') ? 'Editar vaga' : 'Vaga de emprego';
  return '';
}

/** A barra inferior do celular aparece em todas as telas (a navegação não depende mais do menu lateral). */
export function showBottomNav(_pathname: string): boolean {
  return true;
}

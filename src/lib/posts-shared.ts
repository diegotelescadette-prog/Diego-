import type { Badges } from './verification';
// Tipos e regras das publicações da comunidade, usados no servidor e no navegador.
export type PostKind = 'trabalho' | 'divulgacao' | 'pedido';
export type MediaLabel = 'antes' | 'depois' | null;

export interface PostMedia { kind: 'foto' | 'video'; url: string; path: string; label: MediaLabel }
export interface PostView {
  id: string; kind: PostKind; body: string; createdAt: string; editedAt: string | null;
  author: { id: string; isProvider: boolean; slug: string | null; name: string; avatar: string | null; area: string | null; availableToday: boolean; badges?: Badges | null };
  service: string | null; serviceSlug: string | null; category: string | null; categorySlug: string | null;
  neighborhood: string | null; price: string | null; found: boolean;
  media: PostMedia[]; reactions: number; comments: number; reacted: boolean; saved: boolean;
  lastComment: { name: string; body: string } | null;
}
export interface CommentView {
  id: number; parentId: number | null; authorId: string; name: string; body: string; createdAt: string; editedAt: string | null;
  status: 'visivel' | 'oculto' | 'removido';
  provider: { slug: string; name: string; service: string | null } | null;
}

export const POST_KINDS: { key: PostKind; label: string; plural: string; cta: string; hint: string }[] = [
  { key: 'trabalho', label: 'Trabalho', plural: 'Trabalhos', cta: 'Mostrar um trabalho', hint: 'Fotos de um serviço que você fez, com antes e depois' },
  { key: 'divulgacao', label: 'Divulgação', plural: 'Divulgação', cta: 'Divulgar meu serviço', hint: 'Conte o que você faz, onde atende e o preço, se quiser' },
  { key: 'pedido', label: 'Pedido de indicação', plural: 'Pedidos de indicação', cta: 'Pedir uma indicação', hint: 'Peça à comunidade um bom profissional' },
];
export const KIND_LABEL: Record<PostKind, string> = { trabalho: 'Trabalho', divulgacao: 'Divulgação', pedido: 'Pedido de indicação' };
export const isKind = (k: unknown): k is PostKind => k === 'trabalho' || k === 'divulgacao' || k === 'pedido';
/** Tipos que só prestadores com perfil publicado e cobertura confirmada podem usar. */
export const PROVIDER_KINDS: PostKind[] = ['trabalho', 'divulgacao'];

export const POST_LIMITS = { body: 2000, photos: 6, photoMB: 8, videoMB: 50, videoSeconds: 60, comment: 1000, price: 60 } as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const POST_REPORT_REASON: Record<string, string> = {
  golpe_ou_cobranca: 'Golpe ou cobrança', conteudo_improprio: 'Conteúdo impróprio', ofensa_ou_assedio: 'Ofensa ou assédio', spam: 'Propaganda repetida (spam)', outro: 'Outro',
};

/** Filtros do feed lidos da URL (?tipo=&categoria=&bairro=). Valores inválidos são ignorados. */
export interface FeedFilters { kind: PostKind | null; category: string | null; neighborhood: number | null }
export function readFilters(sp: Record<string, string | string[] | undefined>): FeedFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const tipo = one(sp.tipo);
  const cat = one(sp.categoria);
  const bairro = Number(one(sp.bairro));
  return {
    kind: isKind(tipo) ? tipo : null,
    category: /^[a-z0-9-]{1,60}$/.test(cat) ? cat : null,
    neighborhood: Number.isInteger(bairro) && bairro > 0 ? bairro : null,
  };
}
/** Monta a URL do feed mantendo os filtros (e trocando os que forem passados). `pages` = quantas páginas mostrar ("Carregar mais"). */
export function feedHref(f: FeedFilters, change: Partial<FeedFilters> & { pages?: number } = {}): string {
  const n = { ...f, ...change };
  const q = new URLSearchParams();
  if (n.kind) q.set('tipo', n.kind);
  if (n.category) q.set('categoria', n.category);
  if (n.neighborhood) q.set('bairro', String(n.neighborhood));
  if (change.pages && change.pages > 1) q.set('pagina', String(change.pages));
  const s = q.toString();
  return s ? `/?${s}` : '/';
}
export const hasFilters = (f: FeedFilters) => !!(f.kind || f.category || f.neighborhood);
/** Cursor estável de paginação: data + id da última publicação. */
export function encodeCursor(p: { createdAt: string; id: string }): string { return `${p.createdAt}_${p.id}`; }
export function decodeCursor(c: string | undefined): { before: string; beforeId: string } | null {
  const m = /^(.+)_([0-9a-f-]{36})$/.exec(c ?? '');
  if (!m || Number.isNaN(Date.parse(m[1]))) return null;
  return { before: m[1], beforeId: m[2] }; // texto do banco (microssegundos preservados)
}

/** "há 5 min", "há 2 h", "ontem", "12 de nov." — horário de Campo Grande. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Campo_Grande' });
}

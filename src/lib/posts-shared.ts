// Tipos e regras das publicações usados no servidor e no navegador.
export interface PostMedia { kind: 'foto' | 'video'; url: string }
export interface PostView {
  id: string; body: string; createdAt: string;
  author: { id: string; slug: string; name: string; avatar: string | null; service: string | null; area: string | null; availableToday: boolean };
  media: PostMedia[]; reactions: number; comments: number; reacted: boolean;
  lastComment: { name: string; body: string } | null;
}
export interface CommentView { id: number; authorId: string; name: string; body: string; createdAt: string; status: 'visivel' | 'oculto' | 'removido' }

export const POST_LIMITS = { body: 2000, photos: 6, videoMB: 50, videoSeconds: 60, comment: 1000 } as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const POST_REPORT_REASON: Record<string, string> = {
  golpe_ou_cobranca: 'Golpe ou cobrança', conteudo_improprio: 'Conteúdo impróprio', ofensa_ou_assedio: 'Ofensa ou assédio', spam: 'Propaganda repetida (spam)', outro: 'Outro',
};

/** "há 5 min", "há 2 h", "ontem", "12 de nov." — horário de Campo Grande. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Campo_Grande' });
}

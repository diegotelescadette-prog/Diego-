import 'server-only';
import type { Badges } from '@/lib/verification';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { photoUrl } from '@/lib/data';
import { isReaction, type CommentView, type MediaLabel, type PostKind, type PostView, type ReactionKind } from '@/lib/posts-shared';

/** Validade dos links das fotos e vídeos. O bucket é privado: só publicações visíveis recebem link. */
const SIGNED_SECONDS = 6 * 3600;

type Row = {
  id: string; kind: PostKind; body: string; created_at: string; edited_at: string | null;
  author_id: string; is_provider: boolean; slug: string | null; display_name: string | null; photo_path: string | null;
  service_name: string | null; service_slug: string | null; category_name: string | null; category_slug: string | null; neighborhood_name: string | null;
  area_label: string | null; price_label: string | null; found: boolean; available_today: boolean;
  media: { kind: 'foto' | 'video'; path: string; label: MediaLabel }[];
  reactions: number; comments: number; reacted: boolean; saved: boolean; last_comment: { name: string; body: string } | null;
  my_reaction: string | null; reaction_counts: Record<string, number> | null;
  proof: { done_at: string | null; rating: number | null } | null;
};

/** Links assinados para os arquivos de publicações que a consulta (com RLS) já liberou. */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  try {
    const { data } = await createAdminClient().storage.from('post-media').createSignedUrls(paths, SIGNED_SECONDS);
    for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  } catch { /* sem chave de servidor: publicações aparecem sem mídia */ }
  return out;
}

/** Selos públicos (só checagens feitas) de vários perfis de uma vez. */
export async function getBadges(ids: string[]): Promise<Map<string, Badges>> {
  const out = new Map<string, Badges>();
  if (!ids.length) return out;
  const supabase = await createClient();
  const { data } = await supabase.rpc('provider_badges', { p_ids: ids });
  for (const b of (data ?? []) as { provider_id: string; identity_checked: boolean; refs_confirmed: number; experience_years: number | null }[]) {
    out.set(b.provider_id, { identity: b.identity_checked, refs: Number(b.refs_confirmed), experience: b.experience_years });
  }
  return out;
}

export interface PostQuery {
  citySlug?: string; author?: string; post?: string; limit?: number;
  kind?: PostKind | null; category?: string | null; neighborhood?: number | null; saved?: boolean; following?: boolean;
  before?: string; beforeId?: string;
}

/** Publicações visíveis para quem está vendo (RLS + regras do feed). */
export async function getPosts(q: PostQuery = {}): Promise<PostView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('feed_posts', {
    p_city_slug: q.citySlug ?? null, p_author: q.author ?? null, p_post: q.post ?? null,
    p_before: q.before ?? null, p_before_id: q.beforeId ?? null, p_limit: q.limit ?? 20,
    p_kind: q.kind ?? null, p_category: q.category ?? null, p_neighborhood: q.neighborhood ?? null, p_saved: q.saved ?? false,
    p_following: q.following ?? false,
  });
  if (error) return [];
  const rows = (data ?? []) as Row[];
  const urls = await signPaths(rows.flatMap((r) => (r.media ?? []).map((m) => m.path)));
  const badges = await getBadges([...new Set(rows.filter((r) => r.is_provider).map((r) => r.author_id))]);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, body: r.body, createdAt: r.created_at, editedAt: r.edited_at,
    author: {
      id: r.author_id, isProvider: r.is_provider, slug: r.slug, name: r.display_name ?? 'Membro da comunidade',
      avatar: r.is_provider ? photoUrl(r.photo_path) : null, area: r.area_label, availableToday: r.available_today,
      badges: r.is_provider ? badges.get(r.author_id) ?? null : null,
    },
    service: r.service_name, serviceSlug: r.service_slug, category: r.category_name, categorySlug: r.category_slug,
    neighborhood: r.neighborhood_name, price: r.price_label, found: r.found,
    media: (r.media ?? []).filter((m) => urls.has(m.path)).map((m) => ({ kind: m.kind, path: m.path, label: m.label ?? null, url: urls.get(m.path)! })),
    reactions: Number(r.reactions), comments: Number(r.comments), reacted: r.reacted, saved: r.saved, lastComment: r.last_comment,
    myReaction: isReaction(r.my_reaction) ? r.my_reaction : null,
    reactionCounts: Object.fromEntries(Object.entries(r.reaction_counts ?? {}).filter(([k]) => isReaction(k)).map(([k, n]) => [k, Number(n)])) as Partial<Record<ReactionKind, number>>,
    proof: r.proof ? { doneAt: r.proof.done_at, rating: r.proof.rating === null ? null : Number(r.proof.rating) } : null,
  }));
}

/** Dados crus da publicação para o formulário de edição (só o autor). */
export async function getOwnPost(id: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('posts')
    .select('id, kind, body, service_id, category_id, neighborhood_id, price_label, status, author_id')
    .eq('id', id).eq('author_id', userId).maybeSingle();
  return data;
}

/** Comentários: visíveis para todos; ocultos aparecem só para o autor do comentário e o da publicação. */
export async function getComments(postId: string): Promise<CommentView[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('post_comments')
    .select('id, parent_id, author_id, author_name, body, created_at, edited_at, status, provider_id')
    .eq('post_id', postId).neq('status', 'removido').order('created_at').limit(500);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((c) => c.provider_id).filter(Boolean))] as string[];
  const providers = new Map<string, { slug: string; name: string; service: string | null }>();
  if (ids.length) {
    const { data: profs } = await supabase.from('provider_profiles').select('id, slug, display_name, services:main_service_id(name)').in('id', ids).eq('status', 'published');
    for (const p of (profs ?? []) as unknown as { id: string; slug: string; display_name: string; services: { name: string } | null }[]) {
      providers.set(p.id, { slug: p.slug, name: p.display_name, service: p.services?.name ?? null });
    }
  }
  return rows.map((c) => ({
    id: c.id, parentId: c.parent_id, authorId: c.author_id, name: c.author_name, body: c.body, createdAt: c.created_at, editedAt: c.edited_at,
    status: c.status as CommentView['status'], provider: c.provider_id ? providers.get(c.provider_id) ?? null : null,
  }));
}

/** Quem está vendo: perfil profissional (e se pode publicar trabalhos) e nome público. */
export async function getPoster(userId: string) {
  const supabase = await createClient();
  const [{ data: prof }, { data: nm }, { data: canPro }] = await Promise.all([
    supabase.from('provider_profiles').select('display_name, status, main_service_id').eq('id', userId).maybeSingle(),
    supabase.from('member_names').select('name').eq('user_id', userId).maybeSingle(),
    supabase.rpc('provider_in_community', { p_provider: userId }),
  ]);
  const providerName = prof?.status === 'published' && prof.display_name ? prof.display_name : null;
  let services: { id: number; name: string }[] = [];
  if (canPro) {
    const { data } = await supabase.from('provider_services').select('services(id, name)').eq('provider_id', userId);
    services = ((data ?? []) as unknown as { services: { id: number; name: string } | null }[]).flatMap((r) => (r.services ? [r.services] : []));
  }
  return {
    hasProfile: !!prof, profileStatus: prof?.status ?? null, canPostAsProvider: !!canPro, services,
    mainServiceId: prof?.main_service_id ?? null, publicName: providerName ?? nm?.name ?? null, memberName: nm?.name ?? null, providerName,
  };
}

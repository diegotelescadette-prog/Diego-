import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { photoUrl } from '@/lib/data';
import type { CommentView, PostView } from '@/lib/posts-shared';

export function mediaUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/post-media/${path}`;
}

type Row = {
  id: string; body: string; created_at: string; author_id: string; slug: string; display_name: string; photo_path: string | null;
  main_service: string | null; area_label: string | null; available_today: boolean; media: { kind: 'foto' | 'video'; path: string }[];
  reactions: number; comments: number; reacted: boolean; last_comment: { name: string; body: string } | null;
};

/** Publicações (RLS: só publicadas de perfis publicados). */
export async function getPosts(opts: { citySlug?: string; author?: string; post?: string; before?: string; limit?: number } = {}): Promise<PostView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('feed_posts', {
    p_city_slug: opts.citySlug ?? null, p_author: opts.author ?? null, p_post: opts.post ?? null,
    p_before: opts.before ?? null, p_limit: opts.limit ?? 20,
  });
  if (error) return [];
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, body: r.body, createdAt: r.created_at,
    author: { id: r.author_id, slug: r.slug, name: r.display_name, avatar: photoUrl(r.photo_path), service: r.main_service, area: r.area_label, availableToday: r.available_today },
    media: (r.media ?? []).map((m) => ({ kind: m.kind, url: mediaUrl(m.path) })),
    reactions: Number(r.reactions), comments: Number(r.comments), reacted: r.reacted, lastComment: r.last_comment,
  }));
}

/** Comentários: visíveis para todos; ocultos aparecem só para o autor do comentário e o da publicação. */
export async function getComments(postId: string): Promise<CommentView[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('post_comments').select('id, author_id, author_name, body, created_at, status')
    .eq('post_id', postId).neq('status', 'removido').order('created_at').limit(500);
  return (data ?? []).map((c) => ({ id: c.id, authorId: c.author_id, name: c.author_name, body: c.body, createdAt: c.created_at, status: c.status as CommentView['status'] }));
}

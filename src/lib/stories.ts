import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { photoUrl } from '@/lib/data';
import { signPaths } from '@/lib/posts';

/** Um momento no ar (foto ou vídeo que some em 24 horas). */
export interface StoryItem { id: string; kind: 'foto' | 'video'; url: string; caption: string; createdAt: string; seen: boolean }
/** Autor com momentos no ar, na ordem da faixa: os seus, os não vistos, os mais novos. */
export interface StoryGroup {
  authorId: string; name: string; slug: string | null; avatar: string | null;
  mine: boolean; allSeen: boolean; latest: string; items: StoryItem[];
}

type Row = {
  author_id: string; name: string | null; slug: string | null; photo_path: string | null; is_mine: boolean; all_seen: boolean; latest: string;
  items: { id: string; kind: 'foto' | 'video'; path: string; caption: string; created_at: string; seen: boolean }[];
};

/** Momentos visíveis agora (RLS: no ar e não removidos). Os arquivos recebem links assinados pelo servidor. */
export async function getStories(): Promise<StoryGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('stories_feed');
  if (error) return [];
  const rows = (data ?? []) as Row[];
  const urls = await signPaths(rows.flatMap((r) => r.items.map((i) => i.path)));
  return rows
    .map((r) => ({
      authorId: r.author_id, name: r.name ?? 'Membro da comunidade', slug: r.slug, avatar: photoUrl(r.photo_path),
      mine: r.is_mine, allSeen: r.all_seen, latest: r.latest,
      items: r.items.filter((i) => urls.has(i.path)).map((i) => ({
        id: i.id, kind: i.kind, url: urls.get(i.path)!, caption: i.caption, createdAt: i.created_at, seen: i.seen,
      })),
    }))
    .filter((g) => g.items.length > 0);
}

/** Quantas pessoas viram cada momento do autor (só o próprio autor consegue ler). */
export async function getViewCounts(storyIds: string[]): Promise<Record<string, number>> {
  if (!storyIds.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.from('story_views').select('story_id').in('story_id', storyIds);
  const out: Record<string, number> = {};
  for (const v of data ?? []) out[v.story_id] = (out[v.story_id] ?? 0) + 1;
  return out;
}

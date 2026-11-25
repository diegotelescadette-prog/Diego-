import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { photoUrl } from '@/lib/data';
import { JOB_LIST_FIELDS } from '@/lib/jobs-data';

export interface FeedPost {
  id: string; slug: string; name: string; avatar: string | null; service: string | null; area: string | null;
  availableToday: boolean; bio: string | null; photos: string[]; photoCount: number; publishedAt: string | null;
}

/**
 * Feed da tela inicial (fase 1): uma publicação por prestador publicado na cidade, com as fotos de trabalho
 * que ele já cadastrou. Ordem: quem atende hoje, depois quem tem fotos, depois os mais recentes.
 * Usa a busca geral (RLS: só perfis publicados), então não expõe nada além do que a busca já mostra.
 */
export async function getFeed(citySlug: string, limit = 20): Promise<FeedPost[]> {
  const supabase = await createClient();
  const { data: rows } = await supabase.rpc('search_providers', { p_city_slug: citySlug, p_limit: 50 });
  const list = (rows ?? []) as { id: string; slug: string; display_name: string; photo_path: string | null; main_service: string | null; area_label: string | null; available_today: boolean }[];
  if (!list.length) return [];
  const ids = list.map((r) => r.id);
  const [{ data: profiles }, { data: photos }] = await Promise.all([
    supabase.from('provider_profiles').select('id, bio, published_at').in('id', ids),
    supabase.from('provider_work_photos').select('provider_id, path, sort, id').in('provider_id', ids).order('sort').order('id'),
  ]);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const photosBy = new Map<string, string[]>();
  for (const ph of photos ?? []) photosBy.set(ph.provider_id, [...(photosBy.get(ph.provider_id) ?? []), photoUrl(ph.path)!]);
  const posts: FeedPost[] = list.map((r) => {
    const all = photosBy.get(r.id) ?? [];
    return {
      id: r.id, slug: r.slug, name: r.display_name, avatar: photoUrl(r.photo_path), service: r.main_service, area: r.area_label,
      availableToday: r.available_today, bio: byId.get(r.id)?.bio ?? null, photos: all.slice(0, 4), photoCount: all.length,
      publishedAt: byId.get(r.id)?.published_at ?? null,
    };
  });
  const rank = (p: FeedPost) => (p.availableToday ? 2 : 0) + (p.photoCount ? 1 : 0);
  return posts
    .sort((a, b) => rank(b) - rank(a) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, limit);
}

export interface FeedJob { id: string; title: string; company: string; place: string | null }

/** Vagas abertas mais recentes, para a coluna lateral do computador. */
export async function getLatestJobs(limit = 3): Promise<FeedJob[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('jobs').select(JOB_LIST_FIELDS).eq('status', 'aberta')
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as { id: string; title: string; company_name: string; neighborhoods: { name: string } | null }[])
    .map((j) => ({ id: j.id, title: j.title, company: j.company_name, place: j.neighborhoods?.name ?? null }));
}

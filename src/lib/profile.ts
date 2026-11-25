import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { photoUrl } from '@/lib/data';
import type { ProviderStatus } from '@/lib/types';

export interface ProfileView {
  id: string; slug: string; display_name: string; photo: string | null; photo_path: string | null; bio: string | null; status: ProviderStatus;
  main_service: ProfileView['services'][number] | null;
  services: { id: number; name: string; slug: string; mode: string; urgent_pilot: boolean; active: boolean }[];
  area_label: string | null; city: { id: number; name: string; slug: string; uf: string } | null;
  serves_whole_city: boolean; serves_online: boolean;
  work_photos: string[];
  available_today: boolean;
}

export async function loadProfile(by: { slug?: string; id?: string }): Promise<ProfileView | null> {
  const supabase = await createClient();
  let q = supabase.from('provider_profiles')
    .select('id, slug, display_name, photo_path, bio, status, main_service_id, serves_whole_city, serves_online, cities(id, name, slug, uf)');
  q = by.slug ? q.eq('slug', by.slug) : q.eq('id', by.id!);
  const { data: p } = await q.maybeSingle();
  if (!p) return null;
  const [{ data: svcs }, { data: label }, { data: photos }, { data: avail }] = await Promise.all([
    supabase.from('provider_services').select('services(id, name, slug, mode, urgent_pilot, active)').eq('provider_id', p.id),
    supabase.rpc('provider_area_label', { p_provider: p.id }),
    supabase.from('provider_work_photos').select('path').eq('provider_id', p.id).order('sort').order('id'),
    supabase.from('availability_today').select('expires_at').eq('provider_id', p.id).gt('expires_at', new Date().toISOString()).maybeSingle(),
  ]);
  const services = (svcs ?? []).map((r) => r.services as unknown as ProfileView['services'][number]).filter(Boolean);
  return {
    id: p.id, slug: p.slug, display_name: p.display_name, photo: photoUrl(p.photo_path), photo_path: p.photo_path, bio: p.bio, status: p.status,
    main_service: services.find((s) => s.id === p.main_service_id) ?? null,
    services, area_label: label as string | null,
    city: p.cities as unknown as ProfileView['city'],
    serves_whole_city: p.serves_whole_city, serves_online: p.serves_online,
    work_photos: (photos ?? []).map((ph) => photoUrl(ph.path)!),
    available_today: !!avail && p.status === 'published',
  };
}

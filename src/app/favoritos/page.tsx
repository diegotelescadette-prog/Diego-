import Link from 'next/link';
import type { Metadata } from 'next';
import { ProviderCard } from '@/components/ProviderCard';
import { getPilotCity, getUser, photoUrl } from '@/lib/data';
import { generalMessage } from '@/lib/whatsapp';
import { createClient } from '@/lib/supabase/server';
import type { ProviderCardData } from '@/lib/types';

export const metadata: Metadata = { title: 'Meus favoritos' };
export const dynamic = 'force-dynamic';

export default async function Favoritos() {
  const user = (await getUser())!;
  const city = await getPilotCity();
  const supabase = await createClient();
  const { data: favs } = await supabase.from('favorites').select('provider_id').eq('user_id', user.id).order('created_at', { ascending: false });
  const ids = (favs ?? []).map((f) => f.provider_id);
  let cards: ProviderCardData[] = [];
  if (ids.length) {
    // Perfis pausados/suspensos somem automaticamente (RLS só mostra publicados).
    const { data } = await supabase.from('provider_profiles')
      .select('id, slug, display_name, photo_path, serves_online, services:main_service_id(name)').in('id', ids).eq('status', 'published');
    const now = new Date().toISOString();
    const [{ data: avail }, labels] = await Promise.all([
      supabase.from('availability_today').select('provider_id').in('provider_id', ids).gt('expires_at', now),
      Promise.all(ids.map((id) => supabase.rpc('provider_area_label', { p_provider: id }).then((r) => [id, r.data] as const))),
    ]);
    const lab = new Map(labels);
    cards = (data ?? []).map((p) => ({
      id: p.id, slug: p.slug, display_name: p.display_name, photo_path: p.photo_path, serves_online: p.serves_online,
      main_service: (p.services as unknown as { name: string } | null)?.name ?? null, area_label: (lab.get(p.id) as string) ?? null,
      available_today: (avail ?? []).some((a) => a.provider_id === p.id),
    }));
  }
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold">Meus favoritos</h1>
      {cards.length === 0 ? (
        <div className="card mt-4 p-6 text-center">
          <p>Você ainda não salvou nenhum prestador.</p>
          <Link href="/buscar" className="btn-primary mt-3">Buscar prestadores</Link>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3">{cards.map((c) => (
          <ProviderCard key={c.id} p={c} photo={photoUrl(c.photo_path)}
            contact={{ loggedIn: true, returnTo: '/favoritos', message: generalMessage(c.main_service ?? 'um serviço', city.name, c.area_label === 'Atendimento online') }} />
        ))}</ul>
      )}
    </div>
  );
}

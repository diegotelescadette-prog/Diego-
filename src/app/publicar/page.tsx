import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Composer } from '@/components/Composer';
import { getCatalog, getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { getPoster } from '@/lib/posts';
import { isKind } from '@/lib/posts-shared';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Criar publicação' };
export const dynamic = 'force-dynamic';

/** Criar publicação: Mostrar um trabalho, Divulgar meu serviço ou Pedir uma indicação (?tipo= e ?categoria= vêm do feed). */
export default async function Publicar({ searchParams }: { searchParams: Promise<{ tipo?: string; categoria?: string; pedido?: string }> }) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][]).toString();
    redirect(`/entrar?motivo=publicar&next=${encodeURIComponent(`/publicar${q ? `?${q}` : ''}`)}`);
  }
  const city = await getPilotCity();
  const sb = await createClient();
  const [poster, catalog, hoods, { count }] = await Promise.all([
    getPoster(user.id), getCatalog(), getNeighborhoods(city.id),
    sb.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id),
  ]);
  const kind = isKind(sp.tipo) ? sp.tipo : null;
  const { data: done } = poster.canPostAsProvider ? await sb.rpc('my_bookings_to_show') : { data: null };
  const bookings = ((done ?? []) as { id: string; service_id: number; service_name: string; neighborhood_name: string; completed_at: string | null }[])
    .map((b) => ({
      id: b.id, serviceId: b.service_id,
      label: `${b.service_name} · ${b.neighborhood_name}${b.completed_at ? ` · ${new Date(b.completed_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Campo_Grande' })}` : ''}`,
    }));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">Criar publicação</h1>
        <Link href="/minhas-publicacoes" className="text-sm font-semibold text-brand-700 underline">Minhas publicações</Link>
      </div>
      <Composer userId={user.id} canPostAsProvider={poster.canPostAsProvider} hasProfile={poster.hasProfile}
        services={poster.services} mainServiceId={poster.mainServiceId} publicName={poster.publicName} firstPost={!count}
        catalog={catalog.map((c) => ({ id: c.id, name: c.name, slug: c.slug, services: c.services.map((s) => ({ id: s.id, name: s.name })) }))}
        neighborhoods={hoods.map((n) => ({ id: n.id, name: n.name }))}
        initialKind={kind} initialCategory={sp.categoria ?? null}
        bookings={bookings} initialBooking={sp.pedido ?? null} />
    </div>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Composer } from '@/components/Composer';
import { getCatalog, getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { getOwnPost, getPoster, getPosts } from '@/lib/posts';
import type { PostKind } from '@/lib/posts-shared';

export const metadata: Metadata = { title: 'Editar publicação', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Só o autor edita. Outra conta vê o aviso de acesso restrito. */
export default async function Editar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/comunidade/${id}/editar`)}`);
  const own = z.string().uuid().safeParse(id).success ? await getOwnPost(id, user.id) : null;
  if (!own || own.status !== 'publicado') {
    return (
      <div className="mx-auto max-w-xl post p-6" data-testid="edit-denied">
        <h1 className="text-2xl font-extrabold">Acesso restrito</h1>
        <p className="mt-2 text-stone-700">{own ? 'Esta publicação foi ocultada pela moderação e não pode ser editada.' : 'Só quem publicou pode editar esta publicação.'}</p>
        <Link href={`/comunidade/${id}`} className="btn-primary mt-4">Ver a publicação</Link>
      </div>
    );
  }
  const city = await getPilotCity();
  const [poster, catalog, hoods, view] = await Promise.all([getPoster(user.id), getCatalog(), getNeighborhoods(city.id), getPosts({ post: id, limit: 1 })]);
  const media = view[0]?.media ?? [];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-extrabold">Editar publicação</h1>
      <Composer userId={user.id} canPostAsProvider={poster.canPostAsProvider} hasProfile={poster.hasProfile}
        services={poster.services.length ? poster.services : []} mainServiceId={own.service_id}
        publicName={poster.publicName} firstPost={false}
        catalog={catalog.map((c) => ({ id: c.id, name: c.name, slug: c.slug, services: c.services.map((s) => ({ id: s.id, name: s.name })) }))}
        neighborhoods={hoods.map((n) => ({ id: n.id, name: n.name }))}
        edit={{ id, kind: own.kind as PostKind, body: own.body, serviceId: own.service_id, categoryId: own.category_id, neighborhoodId: own.neighborhood_id, price: own.price_label,
          media: media.map((m) => ({ kind: m.kind, path: m.path, url: m.url, label: m.label })) }} />
    </div>
  );
}

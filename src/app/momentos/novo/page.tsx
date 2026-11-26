import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StoryComposer } from './StoryComposer';
import { getUser } from '@/lib/data';
import { getPoster } from '@/lib/posts';

export const metadata: Metadata = { title: 'Novo momento' };
export const dynamic = 'force-dynamic';

/** Publicar um momento: uma foto ou um vídeo curto que some do app em 24 horas. */
export default async function NovoMomento() {
  const user = await getUser();
  if (!user) redirect(`/entrar?motivo=momento&next=${encodeURIComponent('/momentos/novo')}`);
  const poster = await getPoster(user.id);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">Novo momento</h1>
        <p className="text-stone-600">Uma foto ou um vídeo curto do seu dia. Fica no ar por 24 horas e depois some sozinho.</p>
      </header>
      <StoryComposer userId={user.id} publicName={poster.publicName} />
    </div>
  );
}

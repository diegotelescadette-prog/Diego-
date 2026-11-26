import Link from 'next/link';
import type { Metadata } from 'next';
import { z } from 'zod';
import { StoryViewer } from './StoryViewer';
import { getUser } from '@/lib/data';
import { getStories, getViewCounts } from '@/lib/stories';

export const metadata: Metadata = { title: 'Momentos', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Momentos de uma pessoa (no ar por 24 horas). Ao terminar, segue para o próximo autor da faixa. */
export default async function Momentos({ params }: { params: Promise<{ autor: string }> }) {
  const { autor } = await params;
  const [groups, user] = await Promise.all([getStories(), getUser()]);
  const idx = z.string().uuid().safeParse(autor).success ? groups.findIndex((g) => g.authorId === autor) : -1;
  if (idx < 0) {
    return (
      <div className="mx-auto max-w-xl post p-6 text-center" data-testid="story-unavailable">
        <h1 className="text-2xl font-extrabold">Momento indisponível</h1>
        <p className="mt-2 text-stone-700">Ele passou das 24 horas, foi apagado ou saiu do ar.</p>
        <Link href="/comunidade" className="btn-primary mt-4">Voltar à comunidade</Link>
      </div>
    );
  }
  const g = groups[idx];
  const next = groups.slice(idx + 1).find((x) => !x.mine)?.authorId ?? null;
  const views = g.mine ? await getViewCounts(g.items.map((i) => i.id)) : {};
  const start = g.mine ? 0 : Math.max(0, g.items.findIndex((i) => !i.seen));
  return (
    <StoryViewer group={g} views={views} start={start} nextHref={next ? `/momentos/${next}` : '/comunidade'} loggedIn={!!user} />
  );
}

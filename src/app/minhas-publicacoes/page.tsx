import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CopyLink } from '@/components/CopyLink';
import { PostCard } from '@/components/PostCard';
import { getPilotCity, getUser } from '@/lib/data';
import { getPosts } from '@/lib/posts';
import { isKind, KIND_LABEL, POST_KINDS } from '@/lib/posts-shared';
import { siteUrl } from '@/lib/site';
import { generalMessage } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Minhas publicações' };
export const dynamic = 'force-dynamic';

/** Publicações da própria conta (trabalhos, divulgações e pedidos de indicação): editar, apagar e copiar o link. */
export default async function MinhasPublicacoes({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { tipo } = await searchParams;
  const user = await getUser();
  if (!user) redirect('/entrar?next=%2Fminhas-publicacoes');
  const kind = isKind(tipo) ? tipo : null;
  const [mine, city, base] = await Promise.all([getPosts({ author: user.id, kind, limit: 50 }), getPilotCity(), siteUrl()]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">Minhas publicações</h1>
        <Link href="/publicar" className="btn-hoje min-h-11 px-4">Criar publicação</Link>
      </div>
      <nav aria-label="Tipo de publicação" className="chips-row">
        <Link href="/minhas-publicacoes" className="qchip" aria-current={!kind ? 'page' : undefined}>Todas</Link>
        {POST_KINDS.map((k) => <Link key={k.key} href={`/minhas-publicacoes?tipo=${k.key}`} className="qchip" aria-current={kind === k.key ? 'page' : undefined}>{k.plural}</Link>)}
      </nav>
      {mine.length === 0 && (
        <div className="post p-5 text-stone-700">
          {kind ? `Você ainda não tem ${KIND_LABEL[kind].toLowerCase()} publicada.` : 'Você ainda não publicou.'} Fotos de antes e depois chamam atenção!
        </div>
      )}
      {mine.map((p) => (
        <div key={p.id} className="space-y-2">
          <PostCard post={p} viewerId={user.id} message={generalMessage(p.service ?? 'um serviço', city.name, false)} />
          <div className="flex flex-wrap items-start gap-2 px-1">
            <Link href={`/comunidade/${p.id}/editar`} className="btn-outline min-h-10 px-3 text-sm">Editar</Link>
            <CopyLink url={`${base}/comunidade/${p.id}`} className="btn-outline min-h-10 px-3 text-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

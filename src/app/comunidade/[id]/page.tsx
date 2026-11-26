import Link from 'next/link';
import type { Metadata } from 'next';
import { z } from 'zod';
import { PostCard } from '@/components/PostCard';
import { PostComments, ReportBox } from '@/components/PostComments';
import { BackToFeed } from '@/components/BackToFeed';
import { getPilotCity, getUser } from '@/lib/data';
import { getComments, getPoster, getPosts } from '@/lib/posts';
import { KIND_LABEL } from '@/lib/posts-shared';
import { generalMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return (await getPosts({ post: id, limit: 1 }))[0] ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await load((await params).id);
  if (!p) return { title: 'Publicação indisponível', robots: { index: false } };
  const title = p.kind === 'pedido' ? `Pedido de indicação: ${p.service ?? p.category ?? 'serviço'}` : `${KIND_LABEL[p.kind]} de ${p.author.name}`;
  return { title, description: p.body.slice(0, 160) || undefined };
}

/** Página pública da publicação. Removida, oculta ou de perfil fora do ar: aviso com volta à comunidade. */
export default async function Publicacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nova?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const post = await load(id);
  if (!post) {
    return (
      <div className="mx-auto max-w-xl post p-6 text-center" data-testid="post-unavailable">
        <h1 className="text-2xl font-extrabold">Publicação indisponível</h1>
        <p className="mt-2 text-stone-700">Ela foi apagada pelo autor, ocultada pela moderação ou o perfil saiu do ar.</p>
        <Link href="/comunidade" className="btn-primary mt-4">Voltar à comunidade</Link>
      </div>
    );
  }
  const [user, comments, city] = await Promise.all([getUser(), getComments(id), getPilotCity()]);
  const poster = user ? await getPoster(user.id) : null;
  const here = `/comunidade/${id}`;
  const subject = post.service ?? post.category ?? 'um serviço';
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackToFeed />
      {sp.nova && user?.id === post.author.id && (
        <p role="status" className="rounded-xl bg-sage p-3 text-stone-900">Publicado! Sua publicação já aparece na comunidade. Use “Copiar ou compartilhar link” no menu ⋯ para divulgar.</p>
      )}
      <PostCard post={post} viewerId={user?.id ?? null} message={generalMessage(subject, city.name, false)} detail />
      <PostComments postId={id} comments={comments} viewerId={user?.id ?? null} isPostAuthor={user?.id === post.author.id}
        needsName={!!user && !poster?.publicName} defaultName={poster?.memberName ?? ''} here={here} recommend={post.kind === 'pedido'} />
      {user && user.id !== post.author.id && (
        <details className="post p-4" id="denunciar">
          <summary className="cursor-pointer font-semibold">Denunciar esta publicação</summary>
          <div className="mt-3"><ReportBox postId={id} /></div>
        </details>
      )}
      {!user && <p id="denunciar" className="text-sm text-stone-600">Viu algo errado? <Link className="underline" href={`/entrar?motivo=denuncia&next=${encodeURIComponent(here)}`}>Entre para denunciar</Link>.</p>}
    </div>
  );
}

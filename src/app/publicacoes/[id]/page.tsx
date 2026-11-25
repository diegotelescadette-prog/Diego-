import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PostCard } from '@/components/PostCard';
import { PostComments, ReportBox } from '@/components/PostComments';
import { getPilotCity, getUser } from '@/lib/data';
import { getComments, getPosts } from '@/lib/posts';
import { createClient } from '@/lib/supabase/server';
import { generalMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return (await getPosts({ post: id, limit: 1 }))[0] ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await load((await params).id);
  return { title: p ? `Publicação de ${p.author.name}` : 'Publicação' };
}

export default async function Publicacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await load(id);
  if (!post) notFound();
  const [user, comments, city] = await Promise.all([getUser(), getComments(id), getPilotCity()]);
  let needsName = false, defaultName = '';
  if (user) {
    const sb = await createClient();
    const [{ data: prof }, { data: nm }] = await Promise.all([
      sb.from('provider_profiles').select('display_name, status').eq('id', user.id).maybeSingle(),
      sb.from('member_names').select('name').eq('user_id', user.id).maybeSingle(),
    ]);
    needsName = !(prof?.status === 'published' && prof.display_name);
    defaultName = nm?.name ?? '';
  }
  const here = `/publicacoes/${id}`;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/" className="text-sm text-brand-700 underline">← Voltar ao início</Link>
      <PostCard post={post} viewerId={user?.id ?? null} message={generalMessage(post.author.service ?? 'um serviço', city.name, false)} detail />
      <PostComments postId={id} comments={comments} viewerId={user?.id ?? null} isPostAuthor={user?.id === post.author.id}
        needsName={needsName} defaultName={defaultName} here={here} />
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

import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Composer } from '@/components/Composer';
import { PostCard } from '@/components/PostCard';
import { getPilotCity, getUser } from '@/lib/data';
import { getPosts } from '@/lib/posts';
import { createClient } from '@/lib/supabase/server';
import { generalMessage } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Publicar um trabalho' };
export const dynamic = 'force-dynamic';

export default async function Publicar() {
  const user = await getUser();
  if (!user) redirect('/entrar?motivo=publicar&next=%2Fpublicar');
  const sb = await createClient();
  const { data: prof } = await sb.from('provider_profiles').select('display_name, status').eq('id', user.id).maybeSingle();
  if (!prof) {
    return (
      <div className="mx-auto max-w-xl post p-6">
        <h1 className="text-2xl font-extrabold">Publicar um trabalho</h1>
        <p className="mt-2 text-stone-700">Só prestadores publicam trabalhos. Crie seu perfil grátis em duas etapas e depois mostre fotos e vídeos do que você faz.</p>
        <Link href="/sou-prestador" className="btn-hoje mt-4">Criar meu perfil de prestador</Link>
      </div>
    );
  }
  if (prof.status !== 'published') {
    return (
      <div className="mx-auto max-w-xl post p-6">
        <h1 className="text-2xl font-extrabold">Publicar um trabalho</h1>
        <p className="mt-2 text-stone-700">Seu perfil precisa estar publicado e ativo para aparecer no início. Termine ou reative o perfil no painel.</p>
        <Link href="/painel" className="btn-primary mt-4">Ir para o painel</Link>
      </div>
    );
  }
  const [mine, city] = await Promise.all([getPosts({ author: user.id, limit: 30 }), getPilotCity()]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-extrabold">Publicar um trabalho</h1>
      <Composer userId={user.id} name={prof.display_name} />
      <h2 className="pt-2 text-lg font-bold">Minhas publicações</h2>
      {mine.length ? mine.map((p) => <PostCard key={p.id} post={p} viewerId={user.id} message={generalMessage(p.author.service ?? 'um serviço', city.name, false)} />)
        : <p className="text-stone-600">Você ainda não publicou. Fotos de antes e depois chamam atenção!</p>}
    </div>
  );
}

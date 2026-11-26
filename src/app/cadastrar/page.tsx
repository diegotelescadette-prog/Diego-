import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignUpForm } from '@/components/AuthForms';
import { getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { safeNext } from '@/lib/validation';

export const metadata: Metadata = { title: 'Criar conta' };

export default async function Cadastrar({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, '/');
  if (await getUser()) redirect(next);
  const provider = next.startsWith('/painel');
  const bairros = (await getNeighborhoods((await getPilotCity()).id)).map((b) => ({ id: b.id, name: b.name }));
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">{provider ? 'Crie sua conta de prestador' : 'Criar conta'}</h1>
      <p className="mt-2 text-stone-700">
        {provider
          ? 'Depois de confirmar o e-mail, você vai direto para o formulário do seu perfil.'
          : 'Uma tela só. A mesma conta serve para contratar, oferecer serviços, procurar emprego, anunciar vagas e vender.'}
      </p>
      <div className="card mt-4 p-5"><SignUpForm next={next} bairros={bairros} /></div>
    </div>
  );
}

import Link from 'next/link';
import { SuggestForm } from './SuggestForm';
import { getUser } from '@/lib/data';
export const metadata = { title: 'Sugerir um serviço' };
export default async function Sugerir() {
  const user = await getUser();
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">Sugerir um serviço</h1>
      <p className="mt-2 text-stone-700">Não encontrou o que você faz? Sugira e a equipe avalia a inclusão no catálogo.</p>
      <div className="card mt-4 p-5">
        {user ? <SuggestForm /> : <Link className="btn-primary" href="/entrar?next=/sugerir-servico">Entre para sugerir</Link>}
      </div>
    </div>
  );
}

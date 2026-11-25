import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md card p-6 text-center">
      <h1 className="text-2xl font-extrabold">Página não encontrada</h1>
      <p className="mt-2 text-stone-700">O perfil pode ter sido pausado ou removido.</p>
      <Link href="/buscar" className="btn-primary mt-4">Buscar prestadores</Link>
    </div>
  );
}

import Link from 'next/link';

export function Restricted({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-xl card p-6" role="alert" data-testid="acesso-restrito">
      <h1 className="text-2xl font-bold">Acesso restrito</h1>
      <p className="mt-2 text-stone-700">{what} ficam restritos à equipe. Sua conta não tem essa permissão.</p>
      <Link className="btn-primary mt-4" href="/">Voltar ao início</Link>
    </div>
  );
}

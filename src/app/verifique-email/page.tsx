import Link from 'next/link';
export const metadata = { title: 'Confirme seu e-mail' };
export default function Verifique() {
  return (
    <div className="mx-auto max-w-md card p-6 text-center">
      <h1 className="text-2xl font-extrabold">Confirme seu e-mail</h1>
      <p className="mt-2 text-stone-700">Enviamos um link de confirmação. Abra o e-mail neste aparelho e toque no link para continuar de onde parou.</p>
      <p className="mt-2 text-sm text-stone-600">Não chegou? Verifique o spam ou tente entrar para reenviar.</p>
      <Link href="/entrar" className="btn-outline mt-4">Ir para Entrar</Link>
    </div>
  );
}

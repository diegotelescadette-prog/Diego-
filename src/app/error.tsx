'use client';
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-md card p-6 text-center" role="alert">
      <h1 className="text-xl font-bold">Algo deu errado</h1>
      <p className="mt-2 text-stone-700">Não conseguimos carregar esta página.</p>
      <button className="btn-primary mt-4" onClick={reset}>Tentar novamente</button>
    </div>
  );
}

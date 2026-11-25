export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <p className="sr-only">Carregando profissionais disponíveis…</p>
      {[0, 1, 2].map((i) => <div key={i} className="card h-36 animate-pulse bg-stone-100" />)}
    </div>
  );
}

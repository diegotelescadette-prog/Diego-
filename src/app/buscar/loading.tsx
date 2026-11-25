export default function Loading() {
  return (
    <div aria-busy="true" className="space-y-3">
      <p className="sr-only">Carregando resultados…</p>
      {[0, 1, 2, 3].map((i) => <div key={i} className="card h-28 animate-pulse bg-stone-100" />)}
    </div>
  );
}

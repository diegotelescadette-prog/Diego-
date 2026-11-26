import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Guarantee, PackageCard } from '@/components/PackageCard';
import { getPackages } from '@/lib/booking';
import { getCatalog } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const { categoria } = await params;
  const c = (await getCatalog()).find((x) => x.slug === categoria);
  return { title: c ? `${c.name} com preço fixo` : 'Serviços' };
}

/** Pacotes da categoria em cards, com preço e "Agendar". Fora do catálogo: pedir orçamento. */
export default async function Categoria({ params }: { params: Promise<{ categoria: string }> }) {
  const { categoria } = await params;
  const cat = (await getCatalog()).find((c) => c.slug === categoria);
  if (!cat) notFound();
  const pkgs = (await getPackages()).filter((p) => p.category.slug === categoria);
  const services = [...new Map(pkgs.map((p) => [p.service.slug, p.service])).values()];
  const quote = `/publicar?tipo=pedido&categoria=${cat.slug}`;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/servicos" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><span aria-hidden="true">←</span> Todos os serviços</Link>
      <header className="flex items-center gap-3">
        <CategoryIcon slug={cat.slug} size="lg" />
        <div>
          <h1 className="text-2xl font-bold text-stone-800">{cat.name}</h1>
          <p className="text-stone-600">Preço fixo, profissional verificado e pagamento só depois de pronto.</p>
        </div>
      </header>
      {services.map((s) => (
        <section key={s.slug} aria-labelledby={`s-${s.slug}`} className="space-y-3">
          <h2 id={`s-${s.slug}`} className="text-lg font-bold text-stone-800">{s.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {pkgs.filter((p) => p.service.slug === s.slug).map((p) => <PackageCard key={p.id} p={p} />)}
          </div>
        </section>
      ))}
      <section className="card p-5" aria-labelledby="orc-t" data-testid="quote">
        <h2 id="orc-t" className="font-bold text-stone-800">{pkgs.length ? 'Precisa de outro serviço?' : 'Ainda sem preço fixo nesta categoria'}</h2>
        <p className="mt-1 text-stone-600">Descreva o que precisa e mande fotos. Profissionais da cidade respondem com orçamento.</p>
        <Link href={quote} className="btn-outline mt-3 min-h-11 px-4">Pedir orçamento</Link>
      </section>
      {pkgs.length > 0 && <Guarantee />}
    </div>
  );
}

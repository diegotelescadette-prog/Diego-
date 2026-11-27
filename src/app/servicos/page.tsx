import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Guarantee, HowItWorks, PackageCard } from '@/components/PackageCard';
import { getPackageCategories, getPackages } from '@/lib/booking';

export const metadata: Metadata = { title: 'Serviços' };
export const dynamic = 'force-dynamic';

/** Todos os serviços, por categoria. O valor é de cada profissional. */
export default async function Servicos() {
  const [cats, pkgs] = await Promise.all([getPackageCategories(), getPackages()]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-800 sm:text-3xl">Serviços</h1>
        <p className="mt-1 text-stone-600">Veja o que está incluso e agende. Cada profissional informa o próprio valor, e você paga só depois do serviço pronto.</p>
      </header>
      {cats.length > 0 && (
        <nav aria-label="Categorias" className="cat-grid">
          {cats.map((c) => (
            <Link key={c.slug} href={`/servicos/${c.slug}`} className="cat-tile">
              <CategoryIcon slug={c.slug} />{c.name}<small>{c.count} {c.count === 1 ? 'serviço' : 'serviços'}</small>
            </Link>
          ))}
        </nav>
      )}
      {cats.map((c) => (
        <section key={c.slug} aria-labelledby={`c-${c.slug}`} className="space-y-3">
          <h2 id={`c-${c.slug}`} className="text-lg font-bold text-stone-800"><Link href={`/servicos/${c.slug}`} className="hover:underline">{c.name}</Link></h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pkgs.filter((p) => p.category.slug === c.slug).map((p) => <PackageCard key={p.id} p={p} compact />)}
          </div>
        </section>
      ))}
      {!cats.length && <p className="card p-5 text-stone-700">Os serviços estão sendo preparados. Enquanto isso, <Link className="font-semibold text-brand-700 underline" href="/buscar">busque um profissional</Link>.</p>}
      <HowItWorks />
      <Guarantee />
      <p className="text-stone-700">Não achou o que precisa? <Link href="/publicar?tipo=pedido" className="font-semibold text-brand-700 underline">Peça um orçamento</Link> com a descrição e fotos.</p>
    </div>
  );
}

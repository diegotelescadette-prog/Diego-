import Link from 'next/link';
import type { Metadata } from 'next';
import { UrgentForm } from '@/components/UrgentForm';
import { UrgentResults } from '@/components/UrgentResults';
import { getAllServices, getNeighborhoods, getPilotCity, getUrgentServices, photoUrl } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { PILOT_CITY_LABEL } from '@/config/brand';

export const metadata: Metadata = { title: 'Preciso para hoje' };
export const dynamic = 'force-dynamic';

export default async function HojePage({ searchParams }: { searchParams: Promise<{ servico?: string; bairro?: string; mudou?: string }> }) {
  const { servico, bairro, mudou } = await searchParams;
  const city = await getPilotCity();
  const [urgent, all, neighborhoods] = await Promise.all([getUrgentServices(), getAllServices(), getNeighborhoods(city.id)]);
  const service = urgent.find((s) => s.slug === servico);
  const neighborhood = neighborhoods.find((n) => n.slug === bairro);

  const header = (
    <div className="mb-4">
      <p className="chip mb-2 border-hoje-500 bg-white text-hoje-700">📍 {PILOT_CITY_LABEL}</p>
      <h1 className="text-2xl font-extrabold sm:text-3xl">Preciso para hoje</h1>
    </div>
  );

  // Especialidade fora do piloto
  if (servico && !service) {
    const other = all.find((s) => s.slug === servico);
    return (
      <div className="space-y-4">
        {header}
        <div className="card p-5" role="status">
          <p className="text-lg font-semibold">
            {other ? `${other.name} ainda não faz parte do “Preciso para hoje”.` : 'Serviço não encontrado.'}
          </p>
          <p className="mt-1 text-stone-700">No piloto, o atendimento para hoje vale para encanador, eletricista, chaveiro e técnico de ar-condicionado.</p>
          {other && (
            <Link className="btn-primary mt-4" href={`/buscar?servico=${other.slug}&cidade=${city.slug}${neighborhood ? `&bairro=${neighborhood.slug}` : ''}`}>
              Buscar {other.name.toLowerCase()} e combinar atendimento
            </Link>
          )}
        </div>
        <div className="card p-5"><UrgentForm services={urgent} neighborhoods={neighborhoods} neighborhood={bairro} compact /></div>
      </div>
    );
  }

  if (!service || !neighborhood) {
    return (
      <div>
        {header}
        <div className="card p-5"><UrgentForm services={urgent} neighborhoods={neighborhoods} service={servico} neighborhood={bairro} /></div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('urgent_search', { p_service_slug: service.slug, p_neighborhood_id: neighborhood.id });

  return (
    <div className="space-y-5">
      {header}
      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">
          {service.name} · {neighborhood.name} <span className="font-normal text-brand-700 underline">(alterar)</span>
        </summary>
        <div className="mt-4"><UrgentForm services={urgent} neighborhoods={neighborhoods} service={service.slug} neighborhood={neighborhood.slug} compact /></div>
      </details>
      {error ? (
        <div className="card p-5" role="alert">
          <p className="font-semibold">Não conseguimos carregar os resultados.</p>
          <Link className="btn-outline mt-3" href={`/hoje?servico=${service.slug}&bairro=${neighborhood.slug}`}>Tentar novamente</Link>
        </div>
      ) : (
        <>
          <p className="text-stone-700" aria-live="polite">
            {data!.length === 1 ? '1 profissional confirmou' : `${data!.length} profissionais confirmaram`} disponibilidade hoje para {neighborhood.name}.
          </p>
          <UrgentResults
            key={mudou ?? 'lista'}
            changedName={mudou?.slice(0, 80)}
            serviceId={service.id}
            serviceSlug={service.slug}
            neighborhoodId={neighborhood.id}
            neighborhoodSlug={neighborhood.slug}
            items={data!.map((r: { id: string; slug: string; display_name: string; photo_path: string | null; service_name: string; area_label: string }) => ({
              id: r.id, slug: r.slug, display_name: r.display_name, photo: photoUrl(r.photo_path), service_name: r.service_name, area_label: r.area_label,
            }))}
          />
        </>
      )}
    </div>
  );
}

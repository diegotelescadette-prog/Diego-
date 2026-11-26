import Link from 'next/link';
import type { Metadata } from 'next';
import { UrgentForm, toUrgentList } from '@/components/UrgentForm';
import { UrgentResults } from '@/components/UrgentResults';
import { Glyph, PIN_PATH } from '@/components/CategoryIcon';
import { getAllServices, getCatalog, getNeighborhoods, getPilotCity, getSynonymsByService, getUrgentCatalog, photoUrl } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { track } from '@/lib/usage';

export const metadata: Metadata = { title: 'Preciso para hoje' };
export const dynamic = 'force-dynamic';

export default async function HojePage({ searchParams }: { searchParams: Promise<{ servico?: string; bairro?: string; mudou?: string }> }) {
  const { servico, bairro, mudou } = await searchParams;
  const city = await getPilotCity();
  const [urgentCatalog, catalog, all, synonyms, neighborhoods] = await Promise.all([
    getUrgentCatalog(), getCatalog(), getAllServices(), getSynonymsByService(), getNeighborhoods(city.id),
  ]);
  const urgentList = toUrgentList(urgentCatalog, synonyms);
  const service = urgentCatalog.flatMap((c) => c.services).find((s) => s.slug === servico);
  const category = catalog.find((c) => c.id === service?.category_id);
  // Bairro é opcional: vazio ou desconhecido = Todos os bairros (cidade inteira).
  const neighborhood = neighborhoods.find((n) => n.slug === bairro) ?? null;

  const header = (title: string) => (
    <div className="mb-4">
      <p className="chip mb-2 border-hoje-500 bg-white text-hoje-700"><Glyph d={PIN_PATH} size={14} /> {neighborhood ? `${neighborhood.name} · ` : ''}{city.name}–{city.uf}</p>
      <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
    </div>
  );

  // Serviço que não entra no "Preciso para hoje" (ex.: só online)
  if (servico && !service) {
    const other = all.find((s) => s.slug === servico);
    return (
      <div className="space-y-4">
        {header('Preciso para hoje')}
        <div className="card p-5" role="status">
          <p className="text-lg font-semibold">
            {other ? `${other.name} ainda não faz parte do “Preciso para hoje”.` : 'Serviço não encontrado.'}
          </p>
          <p className="mt-1 text-stone-700">
            {other?.mode === 'online' ? 'É um serviço feito a distância, então não depende de bairro.' : 'O “Preciso para hoje” vale para os serviços em destaque no piloto.'} Você pode buscar profissionais e combinar o atendimento.
          </p>
          {other && (
            <Link className="btn-primary mt-4" href={`/buscar?servico=${other.slug}&cidade=${city.slug}${neighborhood ? `&bairro=${neighborhood.slug}` : ''}`}>
              Buscar {other.name.toLowerCase()} e combinar atendimento
            </Link>
          )}
        </div>
        <div className="card p-5"><UrgentForm categories={urgentList} neighborhoods={neighborhoods} neighborhood={neighborhood?.slug} compact /></div>
      </div>
    );
  }

  if (!service) {
    return (
      <div>
        {header('Preciso para hoje')}
        <div className="card p-5"><UrgentForm categories={urgentList} neighborhoods={neighborhoods} neighborhood={neighborhood?.slug} home /></div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('urgent_search', {
    p_service_slug: service.slug, p_neighborhood_id: neighborhood?.id ?? null, p_city_slug: city.slug,
  });
  if (!error) await track('busca_hoje', { serviceId: service.id, cityId: city.id, results: (data ?? []).length });
  const where = neighborhood ? neighborhood.name : `toda ${city.name}`;

  return (
    <div className="space-y-5">
      {header(`${service.name} para hoje`)}
      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">
          {service.name} · {neighborhood ? neighborhood.name : 'Todos os bairros'} <span className="font-normal text-brand-700 underline">(alterar)</span>
        </summary>
        <div className="mt-4"><UrgentForm categories={urgentList} neighborhoods={neighborhoods} service={service.slug} neighborhood={neighborhood?.slug} compact /></div>
      </details>
      {error ? (
        <div className="card p-5" role="alert">
          <p className="font-semibold">Não conseguimos carregar os resultados.</p>
          <Link className="btn-outline mt-3" href={`/hoje?servico=${service.slug}${neighborhood ? `&bairro=${neighborhood.slug}` : ''}`}>Tentar novamente</Link>
        </div>
      ) : (
        <>
          <p className="text-stone-700" aria-live="polite">
            {data!.length === 1 ? '1 profissional confirmou' : `${data!.length} profissionais confirmaram`} disponibilidade hoje em {where}. Toque no card para chamar no WhatsApp.
          </p>
          <UrgentResults
            key={mudou ?? 'lista'}
            changedName={mudou?.slice(0, 80)}
            serviceId={service.id}
            serviceSlug={service.slug}
            categorySlug={category?.slug}
            neighborhoodId={neighborhood?.id ?? null}
            neighborhoodSlug={neighborhood?.slug ?? null}
            cityId={city.id}
            citySlug={city.slug}
            cityName={city.name}
            items={data!.map((r: { id: string; slug: string; display_name: string; photo_path: string | null; service_name: string; area_label: string }) => ({
              id: r.id, slug: r.slug, display_name: r.display_name, photo: photoUrl(r.photo_path), service_name: r.service_name, area_label: r.area_label,
            }))}
          />
        </>
      )}
    </div>
  );
}

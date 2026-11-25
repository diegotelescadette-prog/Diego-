import type { Metadata } from 'next';
import { JobForm } from '@/components/jobs/JobForm';
import { createJob } from '../actions';
import { getNeighborhoods, getPilotCity } from '@/lib/data';

export const metadata: Metadata = { title: 'Anunciar vaga' };
export const dynamic = 'force-dynamic';

export default async function NovaVaga() {
  const city = await getPilotCity();
  const neighborhoods = await getNeighborhoods(city.id);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold">Anunciar uma vaga</h1>
      <p className="mt-1 text-stone-700">A vaga fica no ar por 30 dias em {city.name}. Os candidatos enviam o currículo por aqui e só você vê.</p>
      <div className="card mt-4 p-5">
        <JobForm action={createJob} neighborhoods={neighborhoods} cityName={city.name} />
      </div>
    </div>
  );
}

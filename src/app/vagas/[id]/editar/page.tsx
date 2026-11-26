import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { z } from 'zod';
import { JobForm } from '@/components/jobs/JobForm';
import { updateJob } from '../../actions';
import { getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Editar vaga' };
export const dynamic = 'force-dynamic';

export default async function EditarVaga({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getUser())!;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: job } = await supabase.from('jobs').select('*').eq('id', id).eq('poster_id', user.id).neq('status', 'removida').maybeSingle();
  if (!job) notFound();
  const city = await getPilotCity();
  const neighborhoods = await getNeighborhoods(job.city_id);
  const initial = Object.fromEntries(['title', 'company_name', 'description', 'requirements', 'employment_type', 'work_mode', 'neighborhood_id', 'salary_text', 'openings', 'area', 'salary_min', 'salary_max', 'schedule_text']
    .map((k) => [k, job[k] == null ? '' : String(job[k])]));
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold">Editar vaga</h1>
      <div className="card mt-4 p-5">
        <JobForm action={updateJob} initial={initial} neighborhoods={neighborhoods} cityName={city.name} jobId={job.id} />
      </div>
    </div>
  );
}

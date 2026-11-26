import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { getUser } from '@/lib/data';
import { APPLICATION_STATUS_LABEL, type ApplicationStatus } from '@/lib/jobs';
import { resumeProgress, type ResumeSnapshot } from '@/lib/resume';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Comparar currículos' };
export const dynamic = 'force-dynamic';

/** Até 3 currículos lado a lado. */
export default async function Comparar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string | string[] }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = await getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/minhas-vagas/${id}`)}`);
  const ids = [sp.c ?? []].flat().filter((x) => z.string().uuid().safeParse(x).success).slice(0, 3);
  const supabase = await createClient();
  const { data: job } = await supabase.from('jobs').select('id, title').eq('id', id).eq('poster_id', user.id).maybeSingle();
  if (!job) notFound();
  const { data } = ids.length >= 2
    ? await supabase.from('job_applications').select('id, full_name, status, resume_snapshot').eq('job_id', id).in('id', ids)
    : { data: [] };
  const list = (data ?? []) as { id: string; full_name: string; status: ApplicationStatus; resume_snapshot: ResumeSnapshot | null }[];
  const rows: [string, (s: ResumeSnapshot | null, a: (typeof list)[number]) => React.ReactNode][] = [
    ['Procura', (s) => s?.headline ?? '—'],
    ['Situação', (_, a) => APPLICATION_STATUS_LABEL[a.status]],
    ['Bairro', (s) => s?.neighborhood ?? '—'],
    ['Experiências', (s) => (s?.experiences.length ? s.experiences.slice(0, 3).map((e) => `${e.role} (${e.company})`).join('; ') : 'Nenhuma')],
    ['Formação', (s) => (s?.education.length ? s.education.map((e) => e.course).join('; ') : 'Nenhuma')],
    ['Habilidades', (s) => (s?.skills.length ? s.skills.join(', ') : '—')],
    ['Referências', (s) => String(s?.references.length ?? 0)],
    ['Currículo completo', (s) => (s ? `${resumeProgress({ ...s, email: '', phone: 'x', neighborhood_id: s.neighborhood ? 1 : null, summary: s.summary ?? '', headline: s.headline ?? '', references_list: s.references }).percent}%` : 'PDF')],
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href={`/minhas-vagas/${id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">← Candidatos de {job.title}</Link>
      <h1 className="text-3xl text-stone-900">Comparar currículos</h1>
      {list.length < 2 ? <p className="card p-4">Marque de 2 a 3 candidatos na lista para comparar.</p> : (
        <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
          <table className="w-full min-w-[560px] text-left text-sm" data-testid="compare-table">
            <thead><tr><th className="p-3" scope="col"><span className="sr-only">Item</span></th>
              {list.map((a) => <th key={a.id} scope="col" className="p-3 align-bottom"><Link href={`/minhas-vagas/${id}/c/${a.id}`} className="serif text-base text-stone-900 underline">{a.full_name}</Link></th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map(([label, fn]) => (
                <tr key={label}><th scope="row" className="p-3 font-semibold text-stone-600">{label}</th>{list.map((a) => <td key={a.id} className="p-3 align-top text-stone-800">{fn(a.resume_snapshot, a)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

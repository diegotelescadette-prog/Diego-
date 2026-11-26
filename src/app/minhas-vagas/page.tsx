import Link from 'next/link';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { JOB_STATUS_LABEL, jobState, postedAgo } from '@/lib/jobs';

export const metadata: Metadata = { title: 'Vagas que publiquei' };
export const dynamic = 'force-dynamic';

const STATE_STYLE: Record<string, string> = {
  aberta: 'bg-sage text-stone-900', encerrada: 'bg-stone-200 text-stone-800', vencida: 'bg-hoje-100 text-stone-900', removida: 'bg-red-100 text-red-900',
};

export default async function MinhasVagas({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: jobs }, { data: counts }] = await Promise.all([
    supabase.from('jobs').select('id, title, company_name, status, expires_at, created_at').eq('poster_id', user.id).order('created_at', { ascending: false }),
    supabase.rpc('my_jobs_overview'),
  ]);
  const count = new Map(((counts ?? []) as { job_id: string; total: number; novas: number }[]).map((c) => [c.job_id, c]));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Vagas que publiquei</h1>
        <Link href="/vagas/nova" className="btn-primary">Anunciar uma vaga</Link>
      </div>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{msg}</p>}
      {(jobs ?? []).length === 0 ? (
        <div className="card p-6 text-center">
          <p>Você ainda não publicou nenhuma vaga.</p>
          <p className="mt-1 text-stone-600">Está contratando? Publique grátis e receba currículos de pessoas de Campo Grande.</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {(jobs ?? []).map((j) => {
            const st = jobState(j);
            const c = count.get(j.id);
            return (
              <li key={j.id}>
                <Link href={`/minhas-vagas/${j.id}`} className="card flex flex-wrap items-center gap-3 p-4 hover:border-brand-600" data-testid="minha-vaga">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{j.title}</p>
                    <p className="text-sm text-stone-600">{j.company_name} · publicada {postedAgo(j.created_at)}</p>
                  </div>
                  <span className={`tag ${STATE_STYLE[st]}`}>{JOB_STATUS_LABEL[st]}</span>
                  <span className="text-sm font-semibold text-stone-800">
                    {Number(c?.total ?? 0) === 1 ? '1 candidato' : `${c?.total ?? 0} candidatos`}
                    {Number(c?.novas ?? 0) > 0 && <span className="tag ml-2 bg-hoje-100 text-stone-900">{c!.novas} {Number(c!.novas) === 1 ? 'novo' : 'novos'}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

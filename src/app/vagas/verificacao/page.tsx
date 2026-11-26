import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { formatCnpj } from '@/lib/validation';
import { EmployerForm } from './EmployerForm';

export const metadata: Metadata = { title: 'Verificação de quem contrata' };
export const dynamic = 'force-dynamic';

/** Primeira vaga: a pessoa informa CNPJ ou CPF e o endereço; a vaga fica guardada até a equipe conferir. */
export default async function Verificacao({ searchParams }: { searchParams: Promise<{ vaga?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/entrar?next=%2Fvagas%2Fverificacao');
  const sp = await searchParams;
  const supabase = await createClient();
  const city = await getPilotCity();
  const [{ data: v }, { count: held }, nbs] = await Promise.all([
    supabase.from('employer_verifications').select('kind, cnpj, cpf_last2, legal_name, address_line, neighborhood_id, status, note').eq('user_id', user.id).maybeSingle(),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('poster_id', user.id).eq('held', true),
    getNeighborhoods(city.id),
  ]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl text-stone-900">Verificação de quem contrata</h1>
      {sp.vaga && <p role="status" className="rounded-xl bg-hoje-100 p-3 text-stone-900" data-testid="job-held">Sua vaga foi salva. Ela vai ao ar assim que a equipe conferir seus dados.</p>}
      <p className="safety text-sm">Aqui todo mundo que contrata é conferido: CNPJ ativo (ou CPF) e endereço real. Isso protege quem procura trabalho de golpes e de vagas falsas. Só precisa fazer uma vez.</p>
      {v?.status === 'verificado' ? (
        <section className="card p-5" data-testid="employer-status">
          <p className="verified">Verificado</p>
          <p className="mt-2 text-stone-800"><strong>{v.legal_name}</strong> · {v.kind === 'cnpj' ? `CNPJ ${formatCnpj(v.cnpj ?? '')}` : `CPF terminado em ${v.cpf_last2}`}</p>
          <p className="text-stone-600">{v.address_line}</p>
          <p className="mt-3">Suas vagas entram no ar na hora. <Link href="/minhas-vagas" className="font-semibold text-brand-700 underline">Ver minhas vagas</Link></p>
        </section>
      ) : v?.status === 'pendente' ? (
        <section className="card p-5" data-testid="employer-status">
          <p className="soft-tag mod-servicos">Em conferência</p>
          <p className="mt-2 text-stone-800">Recebemos os dados de <strong>{v.legal_name}</strong>. A equipe responde em até 1 dia útil.{(held ?? 0) > 0 ? ` ${held === 1 ? 'Sua vaga vai' : `Suas ${held} vagas vão`} ao ar logo depois.` : ''}</p>
          <details className="mt-3"><summary className="cursor-pointer font-semibold text-brand-700">Corrigir os dados enviados</summary>
            <div className="mt-3"><EmployerForm neighborhoods={nbs} initial={{ kind: v.kind, legal_name: v.legal_name, address: v.address_line, neighborhood_id: v.neighborhood_id ? String(v.neighborhood_id) : '' }} /></div>
          </details>
        </section>
      ) : (
        <section className="card p-5">
          {v?.status === 'recusado' && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-red-900">Não conseguimos confirmar os dados enviados.{v.note ? ` Motivo: ${v.note}` : ''} Confira e envie de novo.</p>}
          <EmployerForm neighborhoods={nbs} />
        </section>
      )}
    </div>
  );
}

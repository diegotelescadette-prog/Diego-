import Link from 'next/link';
import type { Metadata } from 'next';
import { TalentForm, type TalentDefaults } from '@/components/jobs/TalentForm';
import { manageTalent } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';
import { createClient } from '@/lib/supabase/server';
import { getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { formatPhone } from '@/lib/validation';

export const metadata: Metadata = { title: 'Meu currículo' };
export const dynamic = 'force-dynamic';

export default async function MeuCurriculo({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = (await getUser())!;
  const supabase = await createClient();
  const city = await getPilotCity();
  const [neighborhoods, { data: t }, { data: lastApp }] = await Promise.all([
    getNeighborhoods(city.id),
    supabase.from('talent_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('job_applications').select('full_name, email, phone').eq('applicant_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const active = t && t.visible && new Date(t.expires_at) > new Date();
  const defaults: TalentDefaults = t
    ? { full_name: t.full_name, desired_role: t.desired_role, summary: t.summary ?? '', email: t.email, phone: t.phone ? formatPhone(t.phone) : '', neighborhood_id: t.neighborhood_id ? String(t.neighborhood_id) : '', resume_filename: t.resume_filename }
    : { full_name: lastApp?.full_name ?? '', desired_role: '', summary: '', email: lastApp?.email ?? user.email ?? '', phone: lastApp?.phone ? formatPhone(lastApp.phone) : '', neighborhood_id: '', resume_filename: null };
  const fmt = (d: string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Campo_Grande' });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/vagas" className="text-sm text-brand-700 underline">← Vagas de emprego</Link>
      <h1 className="text-2xl font-extrabold">Meu currículo no banco</h1>
      <p className="text-stone-700">Deixe seu currículo mesmo sem uma vaga específica. Empresas e pessoas com vaga aberta em {city.name} podem encontrar você e chamar para conversar.</p>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{msg}</p>}
      {t && (
        <section className="card p-5" data-testid="meu-banco">
          <p className="font-bold">{active ? 'Visível para quem está contratando' : !t.visible ? 'Oculto: ninguém vê seu currículo' : 'Vencido: salve de novo para reativar'}</p>
          <p className="text-sm text-stone-600">{active ? `Até ${fmt(t.expires_at)}. Salvar de novo renova por 6 meses.` : `Atualizado em ${fmt(t.updated_at)}.`}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="btn-ghost" href={`/api/vagas/banco/${user.id}`}>Baixar meu PDF</a>
            <form action={manageTalent}><SubmitButton name="op" value={t.visible ? 'ocultar' : 'mostrar'} className="btn-outline">{t.visible ? 'Ocultar do banco' : 'Mostrar de novo'}</SubmitButton></form>
            <form action={manageTalent}><SubmitButton name="op" value="apagar" className="btn-ghost text-red-800" pendingText="Apagando…">Apagar currículo</SubmitButton></form>
          </div>
        </section>
      )}
      <div className="card p-5">
        <TalentForm defaults={defaults} neighborhoods={neighborhoods} cityName={city.name} />
      </div>
    </div>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AvailabilityPanel } from './AvailabilityPanel';
import { setProfileStatus } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { getNeighborhoods, getUser } from '@/lib/data';
import { loadProfile } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import { MISSING_LABEL, STATUS_HELP, STATUS_LABEL } from '@/lib/types';

export const metadata: Metadata = { title: 'Painel do prestador' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE = { draft: 'bg-stone-200 text-stone-900', published: 'bg-green-100 text-green-900', paused: 'bg-amber-100 text-amber-900', suspended: 'bg-red-100 text-red-900' };

export default async function Painel({ searchParams }: { searchParams: Promise<{ publicado?: string; erro?: string }> }) {
  const sp = await searchParams;
  const user = (await getUser())!;
  const p = await loadProfile({ id: user.id });
  if (!p) redirect('/painel/perfil');
  const supabase = await createClient();
  const [{ data: missing }, { data: avail }, { data: areas }, { data: city }] = await Promise.all([
    supabase.rpc('profile_missing_fields', { p_provider: user.id }),
    supabase.from('availability_today').select('*').eq('provider_id', user.id).gt('expires_at', new Date().toISOString()).maybeSingle(),
    supabase.from('provider_areas').select('neighborhood_id').eq('provider_id', user.id),
    p.city ? supabase.from('cities').select('timezone, name').eq('id', p.city.id).single() : Promise.resolve({ data: null }),
  ]);
  const miss = (missing ?? []) as string[];
  const inPerson = p.services.filter((s) => s.active && (s.mode === 'presencial' || s.mode === 'ambos'));
  const cityNbs = p.city ? await getNeighborhoods(p.city.id) : [];
  const areaIds = new Set((areas ?? []).map((a) => a.neighborhood_id));
  const areaNbs = p.serves_whole_city ? cityNbs : cityNbs.filter((n) => areaIds.has(n.id));
  const tz = city?.timezone ?? 'America/Campo_Grande';
  const fmt = (iso: string) => {
    const end = new Date(new Date(iso).getTime() - 60_000);
    return `${new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(end)} de hoje (horário de ${city?.name ?? 'Campo Grande'})`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-extrabold">Painel do prestador</h1>
      {sp.publicado && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900">Perfil publicado! Agora você aparece na busca.</p>}
      {sp.erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{sp.erro}</p>}

      <section className="card p-5" aria-labelledby="estado">
        <h2 id="estado" className="sr-only">Estado do perfil</h2>
        <p className="flex flex-wrap items-center gap-2 text-lg">
          Estado do perfil: <span className={`rounded-full px-3 py-0.5 font-bold ${STATUS_STYLE[p.status]}`} data-testid="status">{STATUS_LABEL[p.status]}</span>
        </p>
        <p className="mt-1 text-stone-700">{STATUS_HELP[p.status]}</p>
        {p.status === 'draft' && miss.length > 0 && (
          <p className="mt-2 text-stone-700">Falta: {miss.map((m) => MISSING_LABEL[m] ?? m).join(', ')}.</p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {p.status === 'draft' && <Link className="btn-primary" href={miss.some((m) => ['address', 'city', 'area'].includes(m)) && !miss.some((m) => !['address', 'city', 'area'].includes(m)) ? '/painel/atendimento' : miss.length ? '/painel/perfil' : '/painel/previa'}>Continuar cadastro</Link>}
          <Link className="btn-outline" href="/painel/perfil">Editar perfil</Link>
          <Link className="btn-outline" href="/painel/atendimento">Editar área de atendimento</Link>
          <Link className="btn-ghost" href="/painel/previa">Ver como aparece na busca</Link>
          {p.status === 'published' && (
            <form action={setProfileStatus}><input type="hidden" name="status" value="paused" />
              <SubmitButton className="btn-ghost w-full">Pausar publicação</SubmitButton></form>
          )}
          {p.status === 'paused' && (
            <form action={setProfileStatus}><input type="hidden" name="status" value="published" />
              <SubmitButton className="btn-primary w-full">Reativar publicação</SubmitButton></form>
          )}
        </div>
      </section>

      <section className="card border-hoje-500/40 p-5" aria-labelledby="hoje">
        <h2 id="hoje" className="mb-3 text-xl font-bold">Atendo hoje</h2>
        {p.status !== 'published' ? (
          <p className="text-stone-700">Disponível depois que seu perfil estiver <strong>Publicado</strong>.</p>
        ) : inPerson.length === 0 ? (
          <p className="text-stone-700">O “Atendo hoje” vale para serviços presenciais. Adicione um serviço presencial ao seu perfil.</p>
        ) : !p.serves_whole_city && areaNbs.length === 0 ? (
          <p className="text-stone-700">Cadastre bairros atendidos para usar o “Atendo hoje”.</p>
        ) : (
          <AvailabilityPanel
            cityName={city?.name ?? 'Campo Grande'}
            services={inPerson.map((s) => ({ id: s.id, name: s.name, urgent_pilot: s.urgent_pilot }))}
            areaNeighborhoods={areaNbs}
            servesWholeCity={p.serves_whole_city}
            active={avail ? {
              until: fmt(avail.expires_at), whole_city: avail.whole_city,
              services: inPerson.filter((s) => avail.service_ids.includes(s.id)).map((s) => ({ id: s.id, name: s.name, urgent_pilot: s.urgent_pilot })),
              neighborhoods: cityNbs.filter((n) => avail.neighborhood_ids.includes(n.id)).map((n) => n.name),
            } : null}
          />
        )}
      </section>

      {p.status === 'published' && (
        <p className="text-sm"><Link className="text-brand-700 underline" href={`/p/${p.slug}`}>Abrir meu perfil público</Link></p>
      )}
    </div>
  );
}

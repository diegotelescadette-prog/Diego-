import Link from 'next/link';
import type { Metadata } from 'next';
import { saveMyPackages } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { createClient } from '@/lib/supabase/server';
import { getSetting, getUser } from '@/lib/data';
import { durationLabel } from '@/lib/booking-shared';

export const metadata: Metadata = { title: 'Pacotes que eu faço' };
export const dynamic = 'force-dynamic';

export default async function PacotesQueEuFaco({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: mine }, { data: off }, pct] = await Promise.all([
    supabase.from('provider_services').select('service_id, services(name)').eq('provider_id', user.id),
    supabase.from('provider_packages_off').select('package_id').eq('provider_id', user.id),
    getSetting<{ percent: number }>('comissao'),
  ]);
  const serviceIds = (mine ?? []).map((s) => s.service_id);
  const { data: pkgs } = serviceIds.length
    ? await supabase.from('service_packages').select('id, service_id, name, duration_min')
      .in('service_id', serviceIds).eq('active', true).order('sort').order('name')
    : { data: [] };
  const offSet = new Set((off ?? []).map((o) => o.package_id));
  const percent = Number(pct?.percent ?? 12);
  const groups = (mine ?? []).map((s) => ({
    id: s.service_id, name: (s.services as unknown as { name: string } | null)?.name ?? 'Serviço',
    items: (pkgs ?? []).filter((p) => p.service_id === s.service_id),
  })).filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Pacotes que eu faço</h1>
        <p className="text-stone-700">Marque os serviços que você executa. Você só recebe pedidos dos marcados e informa o seu valor em cada pedido.</p>
      </div>
      {msg && <p role="status" className="rounded-xl bg-sage p-3 text-stone-900" data-testid="pkg-msg">{msg}</p>}
      <p className="rounded-2xl bg-sand p-3 text-sm text-stone-800" data-testid="pkg-commission">
        A comissão de {percent.toLocaleString('pt-BR')}% só é cobrada quando o serviço é concluído. Pedido cancelado ou não feito não paga nada.
      </p>
      {groups.length === 0 ? (
        <div className="card p-5" data-testid="pkg-empty">
          <p>Ainda não há pacotes para os serviços que você oferece.</p>
          <Link href="/painel/servicos" className="btn-outline mt-3 min-h-11 px-4">Ver meus serviços</Link>
        </div>
      ) : (
        <form action={saveMyPackages} className="space-y-4" data-testid="pkg-form">
          {groups.map((g) => (
            <fieldset key={g.id} className="card space-y-2 p-4">
              <legend className="px-1 text-lg font-bold">{g.name}</legend>
              {g.items.map((p) => (
                <label key={p.id} className="flex min-h-11 items-start gap-3 rounded-xl p-2 hover:bg-stone-50" data-testid="pkg-row">
                  <input type="hidden" name="all" value={p.id} />
                  <input type="checkbox" name="on" value={p.id} defaultChecked={!offSet.has(p.id)} className="mt-1 h-5 w-5" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-stone-900">{p.name}</span>
                    <span className="block text-sm text-stone-600">
                      {durationLabel(p.duration_min)} · valor definido por você no pedido
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <SubmitButton className="btn-primary">Salvar pacotes</SubmitButton>
        </form>
      )}
    </div>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Stepper } from '@/components/Stepper';
import { AreaForm } from './AreaForm';
import { getCities, getNeighborhoods, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Onde atendo' };
export const dynamic = 'force-dynamic';

export default async function AtendimentoStep() {
  const user = (await getUser())!;
  const supabase = await createClient();
  const { data: p } = await supabase.from('provider_profiles').select('city_id, serves_whole_city, serves_online, status').eq('id', user.id).maybeSingle();
  if (!p) redirect('/painel/perfil');
  const [{ data: priv }, { data: areas }, { data: svc }, cities, neighborhoods] = await Promise.all([
    supabase.from('provider_private').select('ref_cep, ref_street, ref_number, ref_complement, ref_neighborhood, ref_city, ref_uf').eq('provider_id', user.id).maybeSingle(),
    supabase.from('provider_areas').select('neighborhood_id').eq('provider_id', user.id),
    supabase.from('provider_services').select('services(mode)').eq('provider_id', user.id),
    getCities(),
    getNeighborhoods(),
  ]);
  const canOnline = (svc ?? []).some((r) => ['online', 'ambos'].includes((r.services as unknown as { mode: string })?.mode));
  return (
    <div className="mx-auto max-w-2xl">
      {p.status === 'draft' && <Stepper current={2} />}
      <h1 className="text-2xl font-extrabold">{p.status === 'draft' ? 'Onde você atende' : 'Onde atendo'}</h1>
      <p className="text-stone-700">A área escolhida define em quais buscas você aparece. O endereço de referência é privado.</p>
      <div className="card mt-4 p-5">
        <AreaForm
          cities={cities} neighborhoods={neighborhoods} canOnline={canOnline}
          initial={{
            cep: priv?.ref_cep ?? '', street: priv?.ref_street ?? '', number: priv?.ref_number ?? '', complement: priv?.ref_complement ?? '',
            ref_neighborhood: priv?.ref_neighborhood ?? '', ref_city: priv?.ref_city ?? '', uf: priv?.ref_uf ?? '',
            city_id: p.city_id, whole_city: p.serves_whole_city, online: p.serves_online,
            neighborhoods: (areas ?? []).map((a) => a.neighborhood_id), status: p.status,
          }}
        />
      </div>
    </div>
  );
}

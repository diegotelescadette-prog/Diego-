import type { Metadata } from 'next';
import { Stepper } from '@/components/Stepper';
import { WorkPhotosUploader } from '@/components/PhotoUploader';
import { ProfileForm } from './ProfileForm';
import { ensureProfile } from '../actions';
import { getCatalog, getSetting, getUser, photoUrl, type CpfSetting } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { formatPhone } from '@/lib/validation';

export const metadata: Metadata = { title: 'Seu perfil' };
export const dynamic = 'force-dynamic';

export default async function PerfilStep() {
  await ensureProfile();
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: p }, { data: priv }, { data: svcs }, { data: photos }, catalog, cpf] = await Promise.all([
    supabase.from('provider_profiles').select('display_name, bio, photo_path, main_service_id, status').eq('id', user.id).single(),
    supabase.from('provider_private').select('phone, whatsapp, cpf_last2').eq('provider_id', user.id).maybeSingle(),
    supabase.from('provider_services').select('service_id').eq('provider_id', user.id),
    supabase.from('provider_work_photos').select('id, path').eq('provider_id', user.id).order('id'),
    getCatalog(),
    getSetting<CpfSetting>('cpf_collection'),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <Stepper current={1} />
      <h1 className="text-2xl font-extrabold">Seu perfil</h1>
      <p className="mb-4 text-stone-700">Seu rascunho fica salvo e você pode continuar depois.</p>
      <div className="card p-5">
        <ProfileForm
          catalog={catalog}
          cpf={{ enabled: !!cpf?.enabled, purpose: cpf?.purpose ?? null }}
          initial={{
            display_name: p?.display_name ?? '', bio: p?.bio ?? '', photoUrl: photoUrl(p?.photo_path),
            phone: priv?.phone ? formatPhone(priv.phone) : '', whatsapp: priv?.whatsapp ? formatPhone(priv.whatsapp) : '',
            services: (svcs ?? []).map((s) => s.service_id), main: p?.main_service_id ?? null, cpfLast2: priv?.cpf_last2 ?? null,
            status: p?.status ?? 'draft',
          }}
        />
      </div>
      <div className="card mt-4 p-5">
        <WorkPhotosUploader initial={(photos ?? []).map((ph) => ({ id: ph.id, url: photoUrl(ph.path)! }))} />
      </div>
    </div>
  );
}

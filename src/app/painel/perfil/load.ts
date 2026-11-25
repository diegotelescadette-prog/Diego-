import 'server-only';
import { getCatalog, getSetting, photoUrl, type CpfSetting } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { formatPhone } from '@/lib/validation';
import type { ProfileInitial } from './ProfileForm';

/** Dados do formulário de perfil (usado no pré-cadastro, em Meu perfil e em Serviços e fotos). */
export async function loadProfileForm(userId: string) {
  const supabase = await createClient();
  const [{ data: p }, { data: priv }, { data: svcs }, { data: photos }, catalog, cpf] = await Promise.all([
    supabase.from('provider_profiles').select('display_name, bio, photo_path, main_service_id, status').eq('id', userId).single(),
    supabase.from('provider_private').select('phone, whatsapp, cpf_last2').eq('provider_id', userId).maybeSingle(),
    supabase.from('provider_services').select('service_id').eq('provider_id', userId),
    supabase.from('provider_work_photos').select('id, path').eq('provider_id', userId).order('id'),
    getCatalog(),
    getSetting<CpfSetting>('cpf_collection'),
  ]);
  const initial: ProfileInitial = {
    display_name: p?.display_name ?? '', bio: p?.bio ?? '', photoUrl: photoUrl(p?.photo_path),
    phone: priv?.phone ? formatPhone(priv.phone) : '', whatsapp: priv?.whatsapp ? formatPhone(priv.whatsapp) : '',
    services: (svcs ?? []).map((s) => s.service_id), main: p?.main_service_id ?? null, cpfLast2: priv?.cpf_last2 ?? null,
    status: p?.status ?? 'draft',
  };
  return {
    initial, catalog,
    cpf: { enabled: !!cpf?.enabled, purpose: cpf?.purpose ?? null },
    workPhotos: (photos ?? []).map((ph) => ({ id: ph.id, url: photoUrl(ph.path)! })),
  };
}

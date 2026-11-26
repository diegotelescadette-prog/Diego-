import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type UsageKind = 'busca' | 'busca_hoje' | 'contato_geral' | 'contato_hoje' | 'canal_oficial';

/** Medição do piloto: só o tipo, o serviço/categoria e a quantidade de resultados. Sem conta, IP ou texto digitado. */
export async function track(kind: UsageKind, e: { serviceId?: number | null; categoryId?: number | null; cityId?: number | null; results?: number | null; providerId?: string } = {}) {
  try {
    let categoryId = e.categoryId ?? null;
    const sb = createAdminClient();
    if (!e.serviceId && e.providerId) {
      const { data } = await sb.from('provider_profiles').select('main_service_id, city_id').eq('id', e.providerId).maybeSingle();
      e = { ...e, serviceId: data?.main_service_id ?? null, cityId: e.cityId ?? data?.city_id ?? null };
    }
    if (!categoryId && e.serviceId) {
      const { data } = await sb.from('services').select('category_id').eq('id', e.serviceId).maybeSingle();
      categoryId = data?.category_id ?? null;
    }
    await sb.from('usage_events').insert({ kind, service_id: e.serviceId ?? null, category_id: categoryId, city_id: e.cityId ?? null, results: e.results ?? null });
  } catch { /* medição nunca bloqueia a navegação */ }
}

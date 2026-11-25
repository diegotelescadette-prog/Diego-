import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientKey, hitLimit } from '@/lib/rate-limit';
import { urgentMessage, waLink } from '@/lib/whatsapp';

const Body = z.object({
  providerId: z.string().uuid(),
  serviceId: z.number().int().positive(),
  neighborhoodId: z.number().int().positive().nullish(), // opcional: sem bairro = cidade inteira
  cityId: z.number().int().positive().nullish(),
});

/** Contato urgente (visitante, sem login): só para perfil publicado com "Atendo hoje" válido
 *  para o serviço e a cidade pesquisados (e o bairro, quando escolhido). Revalida tudo no servidor. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const { providerId, serviceId, neighborhoodId, cityId } = parsed.data;

  const key = await clientKey();
  if (!(await hitLimit('contact_urgent', key, 20, 600))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { data, error } = await createAdminClient().rpc('contact_target_urgent', {
    p_provider: providerId, p_service_id: serviceId, p_neighborhood_id: neighborhoodId ?? null, p_city_id: cityId ?? null,
  });
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  const target = data?.[0];
  if (!target) return NextResponse.json({ error: 'availability_changed' }, { status: 409 });

  const message = urgentMessage(target.service_name, target.neighborhood_name, target.city_name);
  return NextResponse.json({ url: waLink(target.whatsapp, message) }, { headers: { 'cache-control': 'no-store' } });
}

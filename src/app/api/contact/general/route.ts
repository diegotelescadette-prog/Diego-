import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hitLimit } from '@/lib/rate-limit';
import { waLink } from '@/lib/whatsapp';

const Body = z.object({ providerId: z.string().uuid(), message: z.string().trim().min(5).max(600) });

/** Contato pela busca geral: exige conta (rota autenticada) e perfil publicado. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (!(await hitLimit('contact_general', user.id, 30, 3600))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const { data, error } = await createAdminClient().rpc('contact_target_general', { p_provider: parsed.data.providerId });
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  const target = data?.[0];
  if (!target) return NextResponse.json({ error: 'not_available' }, { status: 404 });
  return NextResponse.json({ url: waLink(target.whatsapp, parsed.data.message) }, { headers: { 'cache-control': 'no-store' } });
}

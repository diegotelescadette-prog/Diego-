import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { track } from '@/lib/usage';

/** "Acessar canal oficial": só abre o endereço conferido pela equipe, para perfis visíveis. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.redirect(new URL('/', req.url));
  const supabase = await createClient();
  const { data } = await supabase.rpc('provider_public_channel', { p_provider: id });
  const url = ((data ?? []) as { official_url: string }[])[0]?.official_url;
  if (!url || !/^https:\/\/\S+$/.test(url)) return NextResponse.redirect(new URL('/', req.url));
  const { data: svc } = await supabase.from('service_categories').select('id').eq('slug', 'credito-imobiliario').maybeSingle();
  await track('canal_oficial', { categoryId: svc?.id ?? null });
  return NextResponse.redirect(url, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Cliente privilegiado (service_role). Usar SOMENTE em código de servidor e
 * apenas para: gerar link do WhatsApp, limites de frequência, slug do perfil
 * exclusão de conta e links assinados de mídias de publicações já liberadas pela RLS.
 * A chave nunca vai para o navegador.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

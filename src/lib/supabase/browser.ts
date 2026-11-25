'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Cliente do navegador com a sessão do usuário (respeita RLS e as regras de pasta do storage).
 *  Usado só para enviar vídeos direto ao storage (a Vercel limita o corpo das rotas a ~4,5 MB). */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

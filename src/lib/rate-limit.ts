import 'server-only';
import crypto from 'node:crypto';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

/** Identificador do cliente: hash do IP com sal (o IP em claro não é gravado). */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'local';
  return crypto.createHash('sha256').update(`${process.env.RATE_LIMIT_SALT ?? ''}:${ip}`).digest('hex').slice(0, 32);
}

/** true = permitido. */
export async function hitLimit(kind: string, subject: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('rate_limit_hit', {
    p_kind: kind, p_subject: subject, p_max: max, p_window_seconds: windowSeconds,
  });
  if (error) throw new Error('rate_limit_failed');
  return data === true;
}

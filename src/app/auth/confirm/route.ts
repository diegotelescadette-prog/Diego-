import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/validation';

/** Retorno dos links de e-mail (confirmação de conta e recuperação de senha).
 *  Aceita o fluxo PKCE (?code=) e o de token_hash (template recomendado). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get('next'), '/');
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const supabase = await createClient();

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;

  const dest = request.nextUrl.clone();
  dest.search = '';
  if (ok) {
    dest.pathname = next;
    const [path, qs] = next.split('?');
    dest.pathname = path;
    if (qs) dest.search = `?${qs}`;
  } else {
    dest.pathname = '/entrar';
    dest.search = `?erro=link&next=${encodeURIComponent(next)}`;
  }
  return NextResponse.redirect(dest);
}

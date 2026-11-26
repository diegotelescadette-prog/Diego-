import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath, skipsSignupCheck } from '@/lib/access';

/** Marca, por conta, que o cadastro (nome, celular, bairro e aceites) já foi conferido. Só evita refazer a consulta. */
const SIGNUP_COOKIE = 'cadastro';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname, search } = request.nextUrl;
  const back = encodeURIComponent(pathname + search);

  // Sem conta, só a página de entrada, entrar/cadastrar e as páginas legais abrem.
  if (!user) {
    if (isPublicPath(pathname)) return response;
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = '/entrar';
    url.search = `?next=${back}`;
    return NextResponse.redirect(url);
  }

  // Com conta, mas sem o cadastro completo (contas antigas): completa antes de seguir.
  if (!skipsSignupCheck(pathname) && request.cookies.get(SIGNUP_COOKIE)?.value !== user.id) {
    const { data } = await supabase.from('member_accounts').select('user_id').eq('user_id', user.id).maybeSingle();
    if (!data) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Complete o seu cadastro.' }, { status: 403 });
      const url = request.nextUrl.clone();
      url.pathname = '/completar-cadastro';
      url.search = `?next=${back}`;
      return NextResponse.redirect(url);
    }
    response.cookies.set(SIGNUP_COOKIE, user.id, { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 30 });
  }
  return response;
}

export const config = {
  // Arquivos estáticos (fotos do céu, ícones) abrem sem conta: a página de entrada também usa.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|api/cep|.*\\.(?:webp|png|jpg|jpeg|svg|ico|txt|xml)$).*)'],
};

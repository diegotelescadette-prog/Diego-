/** Quem pode abrir o quê sem conta (v3: cadastro obrigatório). */

/** Páginas abertas sem login: a página de entrada, entrar, cadastrar, senha, e-mail e as páginas legais.
 *  "/sou-prestador" só encaminha para o cadastro de prestador (ou para o painel, com conta). */
const PUBLIC_EXACT = ['/', '/entrar', '/cadastrar', '/sou-prestador', '/recuperar-senha', '/redefinir-senha', '/verifique-email', '/privacidade', '/termos'];
const PUBLIC_PREFIX = ['/auth/'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

/** Telas que abrem mesmo com o cadastro incompleto (inclui sair e excluir a conta). */
export function skipsSignupCheck(pathname: string): boolean {
  return (pathname !== '/' && isPublicPath(pathname)) || pathname === '/completar-cadastro' || pathname === '/conta';
}

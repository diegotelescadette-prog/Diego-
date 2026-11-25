import Link from 'next/link';
import { Logo } from './Logo';
import { getIsAdmin, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { BottomNav } from './BottomNav';

async function hasOwnProfile(userId: string | undefined) {
  if (!userId) return false;
  const supabase = await createClient();
  const { data } = await supabase.from('provider_profiles').select('id').eq('id', userId).maybeSingle();
  return !!data;
}

export async function MobileNav() {
  const user = await getUser();
  const hasProfile = await hasOwnProfile(user?.id);
  return <BottomNav proHref={hasProfile ? '/painel' : '/sou-prestador'} proLabel={hasProfile ? 'Meu perfil' : 'Sou prestador'} />;
}

export async function Header() {
  const user = await getUser();
  const isAdmin = await getIsAdmin();
  const hasProfile = await hasOwnProfile(user?.id);
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
        <Link href="/" aria-label="Página inicial"><Logo /></Link>
        <nav aria-label="Principal" className="flex items-center gap-1 text-sm sm:text-base">
          <Link href="/buscar" className="btn-ghost hidden sm:inline-flex">Buscar</Link>
          {user ? (
            <details className="relative">
              <summary className="btn-ghost cursor-pointer list-none" aria-label="Abrir menu da conta">Menu ▾</summary>
              <ul className="absolute right-0 mt-2 w-60 rounded-xl border border-stone-200 bg-white p-2 shadow-lg">
                <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/buscar">Buscar prestadores</Link></li>
                <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/favoritos">Meus favoritos</Link></li>
                <li>
                  <Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href={hasProfile ? '/painel' : '/painel/perfil'}>
                    {hasProfile ? 'Painel do prestador' : 'Ativar perfil profissional'}
                  </Link>
                </li>
                <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/conta">Minha conta</Link></li>
                {isAdmin && <li><Link className="block rounded-lg px-3 py-2 hover:bg-brand-50" href="/admin">Administração</Link></li>}
                <li>
                  <form action="/auth/sair" method="post">
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-brand-50" type="submit">Sair</button>
                  </form>
                </li>
              </ul>
            </details>
          ) : (
            <>
              <Link href="/sou-prestador" className="btn-ghost hidden whitespace-nowrap sm:inline-flex">Sou prestador</Link>
              <Link href="/entrar" className="btn-outline min-h-10 px-3 py-1.5 text-sm sm:text-base">Entrar</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

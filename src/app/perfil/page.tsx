import Link from 'next/link';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Glyph } from '@/components/CategoryIcon';
import { getIsAdmin, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { NAV_ICONS, profileLinks } from '@/lib/nav';
import { setTheme } from '@/app/tema/actions';

export const metadata: Metadata = { title: 'Perfil' };
export const dynamic = 'force-dynamic';

/** Perfil: reúne o que antes ficava no menu lateral (conta, pedidos, currículo, vagas, painel, salvos), a aparência e o sair. */
export default async function Perfil() {
  const user = await getUser();
  if (!user) redirect('/entrar?next=/perfil');
  const sb = await createClient();
  const [isAdmin, { data: prof }, { data: nm }, jar] = await Promise.all([
    getIsAdmin(),
    sb.from('provider_profiles').select('id, display_name').eq('id', user.id).maybeSingle(),
    sb.from('member_names').select('name').eq('user_id', user.id).maybeSingle(),
    cookies(),
  ]);
  const name = (prof?.display_name ?? nm?.name ?? '').trim();
  const tema = jar.get('tema')?.value === 'escuro' ? 'escuro' : jar.get('tema')?.value === 'claro' ? 'claro' : 'auto';
  const links = profileLinks({ loggedIn: true, hasProfile: !!prof, isAdmin });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-3xl text-stone-900">{name || 'Seu perfil'}</h1>
        <p className="text-stone-600">{user.email}</p>
      </header>
      <nav aria-label="Seu espaço" className="card p-2" data-testid="perfil-links">
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="hub-link" data-testid={l.testid}>
                <span className="ic ic-md"><Glyph d={NAV_ICONS[l.icon]} size={20} /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-stone-900">{l.label}</span>{l.hint && <span className="text-sm text-stone-600">{l.hint}</span>}</span>
                <span aria-hidden="true" className="text-stone-400">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="card p-5" aria-labelledby="ap-t">
        <h2 id="ap-t" className="text-lg font-bold">Aparência</h2>
        <form action={setTheme} className="mt-3 flex flex-wrap gap-2" data-testid="perfil-tema">
          {([['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']] as const).map(([v, l]) => (
            <button key={v} type="submit" name="tema" value={v} aria-pressed={tema === v}
              className={tema === v ? 'btn min-h-11 border border-ink bg-ink px-4 text-white' : 'btn-outline min-h-11 px-4'}>{l}</button>
          ))}
        </form>
        <p className="hint">Automático segue o modo do seu celular ou computador.</p>
      </section>
      <form action="/auth/sair" method="post">
        <button className="btn-outline w-full" type="submit">Sair</button>
      </form>
    </div>
  );
}

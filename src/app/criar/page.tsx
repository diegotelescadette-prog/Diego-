import Link from 'next/link';
import type { Metadata } from 'next';
import { Glyph } from '@/components/CategoryIcon';
import { getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { NAV_ICONS } from '@/lib/nav';

export const metadata: Metadata = { title: 'Criar' };
export const dynamic = 'force-dynamic';

type Option = { href: string; title: string; text: string; icon: keyof typeof NAV_ICONS; mod: string; testid: string };

/** O (+) Criar: tudo o que dá para publicar, num lugar só. */
export default async function Criar() {
  const user = await getUser();
  let isProvider = false;
  if (user) {
    const { data } = await (await createClient()).from('provider_profiles').select('id').eq('id', user.id).maybeSingle();
    isProvider = !!data;
  }
  const options: Option[] = [
    { href: '/publicar?tipo=dia_a_dia', title: 'Post do dia a dia', text: 'Conte uma novidade, com fotos ou vídeo', icon: 'photo', mod: 'mod-comunidade', testid: 'criar-post' },
    { href: '/momentos/novo', title: 'Momento', text: 'Foto ou vídeo curto que some em 24 horas', icon: 'clock', mod: 'mod-comunidade', testid: 'criar-momento' },
    isProvider
      ? { href: '/publicar?tipo=trabalho', title: 'Mostrar um trabalho', text: 'Fotos de um serviço que você fez', icon: 'tool', mod: 'mod-servicos', testid: 'criar-trabalho' }
      : { href: '/sou-prestador', title: 'Mostrar um trabalho', text: 'Ative seu perfil de prestador para mostrar o que você faz', icon: 'tool', mod: 'mod-servicos', testid: 'criar-trabalho' },
    { href: '/publicar?tipo=pedido', title: 'Pedir indicação', text: 'Peça alguém de confiança para um serviço', icon: 'users', mod: 'mod-servicos', testid: 'criar-indicacao' },
    { href: '/vagas/nova', title: 'Publicar vaga', text: 'Anuncie grátis e receba currículos', icon: 'briefcase', mod: 'mod-trabalho', testid: 'criar-vaga' },
  ];
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl text-stone-900">O que você quer criar?</h1>
      <ul className="card divide-y divide-line p-2" data-testid="criar-opcoes">
        {options.map((o) => (
          <li key={o.testid}>
            <Link href={user ? o.href : `/entrar?next=${encodeURIComponent(o.href)}`} className="hub-link" data-testid={o.testid}>
              <span className={`ic ic-md ${o.mod}`}><Glyph d={NAV_ICONS[o.icon]} size={20} /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-stone-900">{o.title}</span><span className="text-sm text-stone-600">{o.text}</span></span>
              <span aria-hidden="true" className="text-stone-400">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

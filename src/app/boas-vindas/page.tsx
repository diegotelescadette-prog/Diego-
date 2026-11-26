import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { chooseFirstGoal } from '@/app/auth-actions';
import { Glyph } from '@/components/CategoryIcon';
import { getUser } from '@/lib/data';
import { FIRST_GOALS, NAV_ICONS } from '@/lib/nav';

export const metadata: Metadata = { title: 'Boas-vindas' };
export const dynamic = 'force-dynamic';

/** Depois do cadastro: "O que você quer fazer primeiro?" (opcional; só define o primeiro destino, não limita a conta). */
export default async function BoasVindas() {
  if (!(await getUser())) redirect('/entrar?next=/boas-vindas');
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold">Que bom ter você aqui!</h1>
      <p className="mt-2 text-stone-700">O que você quer fazer primeiro? Você pode usar todas as áreas depois, com a mesma conta.</p>
      <form action={chooseFirstGoal} className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="primeiro-destino">
        {FIRST_GOALS.map((g) => (
          <button key={g.key} type="submit" name="goal" value={g.key} className="card hub-link w-full text-left" data-testid={`goal-${g.key}`}>
            <span className="ic ic-md" aria-hidden="true"><Glyph d={NAV_ICONS[g.icon]} size={20} /></span>
            <span>
              <span className="block font-bold">{g.label}</span>
              <span className="block text-sm text-stone-600">{g.hint}</span>
            </span>
          </button>
        ))}
      </form>
      <p className="mt-5 text-center"><Link href="/" className="text-brand-700 underline">Agora não, ir para o início</Link></p>
    </div>
  );
}

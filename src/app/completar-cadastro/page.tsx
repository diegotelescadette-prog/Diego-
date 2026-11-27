import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CompleteSignupForm } from '@/components/AuthForms';
import { getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/validation';

export const metadata: Metadata = { title: 'Complete seu cadastro' };
export const dynamic = 'force-dynamic';

/** Contas criadas antes do cadastro obrigatório completam nome, celular, bairro e aceites uma vez. */
export default async function CompletarCadastro({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, '/');
  const user = await getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  const supabase = await createClient();
  const [{ data: done }, { data: nm }, { data: prof }] = await Promise.all([
    supabase.from('member_accounts').select('user_id').eq('user_id', user.id).maybeSingle(),
    supabase.from('member_names').select('name').eq('user_id', user.id).maybeSingle(),
    supabase.from('provider_profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ]);
  if (done) redirect(next);
  const bairros = (await getNeighborhoods((await getPilotCity()).id)).map((b) => ({ id: b.id, name: b.name }));
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">Complete seu cadastro</h1>
      <p className="mt-2 text-stone-700">
        Agora todo mundo no Próximo é identificado. Leva um minuto, é feito uma vez só, e depois você segue para onde ia.
      </p>
      <div className="card mt-4 p-5">
        <CompleteSignupForm next={next} bairros={bairros} defaults={{ nome_publico: nm?.name ?? prof?.display_name ?? '' }} />
      </div>
    </div>
  );
}

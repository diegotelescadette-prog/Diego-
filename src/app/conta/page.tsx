import Link from 'next/link';
import type { Metadata } from 'next';
import { DeleteAccount } from './DeleteAccount';
import { getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LABEL, type ProviderStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Minha conta' };
export const dynamic = 'force-dynamic';

export default async function Conta({ searchParams }: { searchParams: Promise<{ senha?: string }> }) {
  const sp = await searchParams;
  const user = (await getUser())!;
  const supabase = await createClient();
  const { data: p } = await supabase.from('provider_profiles').select('status').eq('id', user.id).maybeSingle();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-extrabold">Minha conta</h1>
      {sp.senha && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900">Senha alterada.</p>}
      <section className="card p-5">
        <p><span className="font-semibold">E-mail de acesso:</span> {user.email}</p>
        <p className="hint">Visível só para você.</p>
        <Link href="/recuperar-senha" className="mt-2 inline-block text-brand-700 underline">Trocar senha</Link>
      </section>
      <section className="card p-5">
        <h2 className="text-lg font-bold">Perfil profissional</h2>
        {p ? (
          <p className="mt-1">Estado: <strong>{STATUS_LABEL[p.status as ProviderStatus]}</strong>. <Link className="text-brand-700 underline" href="/painel">Abrir painel</Link></p>
        ) : (
          <>
            <p className="mt-1 text-stone-700">Use esta mesma conta para oferecer seus serviços.</p>
            <Link href="/painel/perfil" className="btn-primary mt-3">Ativar perfil profissional</Link>
          </>
        )}
      </section>
      <section className="card border-red-200 p-5">
        <h2 className="text-lg font-bold text-red-800">Excluir conta e dados</h2>
        <DeleteAccount />
      </section>
    </div>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Stepper } from '@/components/Stepper';
import { ProfileDetails } from '@/components/ProfileDetails';
import { ProviderCard } from '@/components/ProviderCard';
import { PublishForm } from './PublishForm';
import { loadProfile } from '@/lib/profile';
import { getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { MISSING_LABEL, STATUS_LABEL } from '@/lib/types';

export const metadata: Metadata = { title: 'Prévia do perfil' };
export const dynamic = 'force-dynamic';

const FIX_LINK: Record<string, string> = { address: '/painel/atendimento', city: '/painel/atendimento', area: '/painel/atendimento' };

export default async function Previa() {
  const user = (await getUser())!;
  const p = await loadProfile({ id: user.id });
  if (!p) redirect('/painel/perfil');
  const supabase = await createClient();
  const { data: missing } = await supabase.rpc('profile_missing_fields', { p_provider: user.id });
  const miss = (missing ?? []) as string[];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Stepper current={3} />
      <h1 className="text-2xl font-extrabold">Prévia do seu perfil</h1>
      <p className="text-stone-700">Estado atual: <strong>{STATUS_LABEL[p.status]}</strong></p>

      <section aria-labelledby="busca-prev">
        <h2 id="busca-prev" className="mb-2 font-bold">Como aparece na busca</h2>
        <ul><ProviderCard p={{ id: p.id, slug: p.slug, display_name: p.display_name || 'Seu nome', photo_path: p.photo_path, main_service: p.main_service?.name ?? null, area_label: p.area_label, serves_online: p.serves_online, available_today: p.available_today }} /></ul>
      </section>
      <section aria-labelledby="perfil-prev">
        <h2 id="perfil-prev" className="mb-2 font-bold">Página do perfil</h2>
        <ProfileDetails p={p} />
      </section>

      {miss.length > 0 ? (
        <div className="card border-amber-300 p-5" role="status">
          <p className="font-semibold">Falta pouco! Complete para publicar:</p>
          <ul className="mt-2 list-inside list-disc">
            {miss.map((m) => <li key={m}><Link className="underline" href={FIX_LINK[m] ?? '/painel/perfil'}>{MISSING_LABEL[m] ?? m}</Link></li>)}
          </ul>
        </div>
      ) : p.status === 'draft' || p.status === 'paused' ? (
        <div className="card p-5">
          <p className="mb-3 text-stone-700">Tudo certo. Ao publicar, seu perfil passa a aparecer na busca.</p>
          <PublishForm label={p.status === 'draft' ? 'Publicar meu perfil' : 'Reativar publicação'} />
        </div>
      ) : (
        <Link href="/painel" className="btn-primary">Voltar ao painel</Link>
      )}
    </div>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Stepper } from '@/components/Stepper';
import { ProfileDetails } from '@/components/ProfileDetails';
import { photoUrl } from '@/lib/data';
import { ProviderCard } from '@/components/ProviderCard';
import { PublishForm } from './PublishForm';
import { loadProfile } from '@/lib/profile';
import { getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { MISSING_LABEL, STATUS_LABEL } from '@/lib/types';

export const metadata: Metadata = { title: 'Prévia do perfil' };
export const dynamic = 'force-dynamic';

const FIX_LINK: Record<string, string> = {
  address: '/painel/atendimento#cep', city: '/painel/atendimento#city_id', area: '/painel/atendimento#area-title',
  photo: '/painel/servicos#photo-label', services: '/painel/servicos#svc-filter', main_service: '/painel/servicos#main_service',
  display_name: '/painel/perfil#display_name', phone: '/painel/perfil#phone', whatsapp: '/painel/perfil#phone', cpf: '/painel/perfil#cpf',
};

export default async function Previa({ searchParams }: { searchParams: Promise<{ hoje?: string }> }) {
  const sp = await searchParams;
  const user = (await getUser())!;
  const p = await loadProfile({ id: user.id });
  if (!p) redirect('/painel/perfil');
  const supabase = await createClient();
  const { data: missing } = await supabase.rpc('profile_missing_fields', { p_provider: user.id });
  const miss = (missing ?? []) as string[];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {p.status === 'draft' && <Stepper current={3} />}
      <h1 className="text-2xl font-extrabold">Prévia do seu perfil</h1>
      {sp.hoje === 'ajustada' && <p role="status" className="rounded-xl bg-hoje-100 p-3 text-stone-900">Área salva. O “Atendo hoje” foi ajustado para os bairros que continuam na sua área.</p>}
      {sp.hoje === 'removida' && <p role="status" className="rounded-xl bg-hoje-100 p-3 text-stone-900">Área salva. O “Atendo hoje” foi desativado porque a área de hoje saiu da sua cobertura. Ative de novo no painel.</p>}
      <p className="text-stone-700">Estado atual: <strong>{STATUS_LABEL[p.status]}</strong></p>

      <section aria-labelledby="busca-prev">
        <h2 id="busca-prev" className="mb-2 font-bold">Como aparece na busca</h2>
        <ul><ProviderCard p={{ id: p.id, slug: p.slug, display_name: p.display_name || 'Seu nome', photo_path: p.photo_path, main_service: p.main_service?.name ?? null, area_label: p.area_label, serves_online: p.serves_online, available_today: p.available_today }} photo={photoUrl(p.photo_path)} /></ul>
      </section>
      <section aria-labelledby="perfil-prev">
        <h2 id="perfil-prev" className="mb-2 font-bold">Página do perfil</h2>
        <ProfileDetails p={p} />
      </section>

      {miss.length > 0 ? (
        <div className="card border-gold p-5" role="status">
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

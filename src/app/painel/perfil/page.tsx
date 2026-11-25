import Link from 'next/link';
import type { Metadata } from 'next';
import { Stepper } from '@/components/Stepper';
import { WorkPhotosUploader } from '@/components/PhotoUploader';
import { ProfileForm } from './ProfileForm';
import { loadProfileForm } from './load';
import { ensureProfile } from '../actions';
import { getUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Meu perfil' };
export const dynamic = 'force-dynamic';

export default async function PerfilStep() {
  await ensureProfile();
  const user = (await getUser())!;
  const { initial, catalog, cpf, workPhotos } = await loadProfileForm(user.id);

  // Rascunho: pré-cadastro em duas etapas (tudo da etapa 1 nesta tela).
  if (initial.status === 'draft') {
    return (
      <div className="mx-auto max-w-2xl">
        <Stepper current={1} />
        <h1 className="text-2xl font-extrabold">Seu perfil</h1>
        <p className="mb-4 text-stone-700">Seu rascunho fica salvo e você pode continuar depois.</p>
        <div className="card p-5">
          <ProfileForm catalog={catalog} cpf={cpf} initial={initial} />
        </div>
        <div className="card mt-4 p-5">
          <WorkPhotosUploader initial={workPhotos} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold">Meu perfil</h1>
      <p className="mb-4 text-stone-700">
        Nome profissional, apresentação e contato. Para especialidades e fotos, use <Link className="font-semibold text-brand-700 underline" href="/painel/servicos">Serviços e fotos</Link>.
      </p>
      <div className="card p-5">
        <ProfileForm catalog={catalog} cpf={cpf} initial={initial} section="perfil" />
      </div>
    </div>
  );
}

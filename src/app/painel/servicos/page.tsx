import type { Metadata } from 'next';
import { WorkPhotosUploader } from '@/components/PhotoUploader';
import { ProfileForm } from '../perfil/ProfileForm';
import { loadProfileForm } from '../perfil/load';
import { ensureProfile } from '../actions';
import { getUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Serviços e fotos' };
export const dynamic = 'force-dynamic';

export default async function ServicosEFotos() {
  await ensureProfile();
  const user = (await getUser())!;
  const { initial, catalog, cpf, workPhotos } = await loadProfileForm(user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Serviços e fotos</h1>
        <p className="text-stone-700">Especialidades, serviço principal, foto do perfil e fotos de trabalhos.</p>
      </div>
      <div className="card p-5">
        <ProfileForm catalog={catalog} cpf={cpf} initial={initial} section="servicos" />
      </div>
      <div className="card p-5" id="fotos-trabalhos">
        <WorkPhotosUploader initial={workPhotos} />
      </div>
    </div>
  );
}

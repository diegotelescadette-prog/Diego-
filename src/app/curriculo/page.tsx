import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { getMyResume, signedPhoto } from '@/lib/resume-data';
import { PhotoForm } from './PhotoForm';
import { ResumeEditor } from './ResumeEditor';

export const metadata: Metadata = { title: 'Meu currículo' };
export const dynamic = 'force-dynamic';

/** Currículo dentro do app: é o que vai para as empresas quando você toca em "Enviar meu currículo". */
export default async function Curriculo() {
  const user = await getUser();
  if (!user) redirect('/entrar?next=%2Fcurriculo');
  const city = await getPilotCity();
  const [{ data, exists }, nbs] = await Promise.all([getMyResume(user.id, user.email), getNeighborhoods(city.id)]);
  const photo = await signedPhoto(data.photo_path);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl text-stone-900">Meu currículo</h1>
        {exists && <a href="/curriculo/pdf" className="btn-outline min-h-11 px-4" data-testid="resume-pdf">Baixar em PDF</a>}
      </div>
      <p className="safety text-sm">Seu currículo só é visto por quem recebe a sua candidatura. O telefone só aparece se você autorizar na hora de se candidatar.</p>
      {exists && <section className="card p-5" aria-label="Foto"><PhotoForm url={photo} name={data.full_name} /></section>}
      <ResumeEditor initial={data} neighborhoods={nbs.map((n) => ({ id: n.id, name: n.name }))} />
      <p className="text-sm text-stone-600">Quer que empresas encontrem você sem uma vaga aberta? <Link href="/vagas/meu-curriculo" className="font-semibold text-brand-700 underline">Deixe seu currículo no banco de currículos</Link>.</p>
    </div>
  );
}

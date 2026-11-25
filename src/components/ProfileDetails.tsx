import { Avatar } from './Avatar';
import type { ProfileView } from '@/lib/profile';

export function ProfileDetails({ p, actions }: { p: ProfileView; actions?: React.ReactNode }) {
  const others = p.services.filter((s) => s.id !== p.main_service?.id);
  return (
    <article className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <Avatar src={p.photo} name={p.display_name} size={112} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold">{p.display_name || 'Seu nome profissional'}</h1>
          {p.main_service && <p className="text-lg text-stone-800">{p.main_service.name}</p>}
          {p.area_label && <p className="mt-1 text-stone-700"><span className="font-semibold">Atende:</span> {p.area_label}</p>}
          {p.available_today && <p className="mt-2"><span className="badge-hoje">● Atende hoje</span> <span className="text-sm text-stone-700">Horário a combinar pelo WhatsApp</span></p>}
          {actions && <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">{actions}</div>}
        </div>
      </div>
      {others.length > 0 && (
        <section className="border-t border-stone-200 p-5">
          <h2 className="font-bold">Outros serviços</h2>
          <ul className="mt-2 flex flex-wrap gap-2">{others.map((s) => <li key={s.id} className="chip">{s.name}</li>)}</ul>
        </section>
      )}
      {p.bio && (
        <section className="border-t border-stone-200 p-5">
          <h2 className="font-bold">Sobre</h2>
          <p className="mt-1 whitespace-pre-line text-stone-800">{p.bio}</p>
        </section>
      )}
      {p.work_photos.length > 0 && (
        <section className="border-t border-stone-200 p-5">
          <h2 className="font-bold">Fotos de trabalhos</h2>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {p.work_photos.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <li key={u}><img src={u} alt={`Trabalho de ${p.display_name}`} className="aspect-square w-full rounded-xl object-cover" loading="lazy" /></li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

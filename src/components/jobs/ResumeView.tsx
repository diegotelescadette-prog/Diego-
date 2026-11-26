import { EDUCATION_STATUS, periodLabel, type ResumeSnapshot } from '@/lib/resume';
import { formatPhone } from '@/lib/validation';

/** Currículo como a empresa vê (cópia guardada na candidatura). */
export function ResumeView({ r, photo }: { r: ResumeSnapshot; photo: string | null }) {
  return (
    <div className="space-y-5" data-testid="resume-view">
      <div className="flex items-center gap-4">
        {photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photo} alt={`Foto de ${r.full_name}`} className="h-20 w-20 rounded-2xl object-cover" />
          : <span className="grid h-20 w-20 flex-none place-items-center rounded-2xl bg-hoje-100 text-2xl font-bold text-hoje-700" aria-hidden="true">{r.full_name.charAt(0).toUpperCase()}</span>}
        <div>
          <h2 className="text-2xl text-stone-900">{r.full_name}</h2>
          {r.headline && <p className="text-stone-700">{r.headline}</p>}
          {r.neighborhood && <p className="text-sm text-stone-600">Mora em {r.neighborhood}</p>}
        </div>
      </div>
      {r.summary && <section><h3 className="text-lg">Sobre</h3><p className="mt-1 whitespace-pre-line text-stone-800">{r.summary}</p></section>}
      <section>
        <h3 className="text-lg">Experiências</h3>
        {r.experiences.length === 0 ? <p className="text-stone-600">Nenhuma informada.</p> : (
          <ul className="mt-1 space-y-2">
            {r.experiences.map((e, i) => (
              <li key={i}><p className="font-semibold text-stone-900">{e.role} · {e.company}</p><p className="text-sm text-stone-600">{periodLabel(e)}</p>{e.description && <p className="text-stone-800">{e.description}</p>}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-lg">Formação</h3>
        {r.education.length === 0 ? <p className="text-stone-600">Nenhuma informada.</p> : (
          <ul className="mt-1 space-y-1">{r.education.map((e, i) => <li key={i}><span className="font-semibold">{e.course}</span> · {[e.school, EDUCATION_STATUS[e.status], e.end].filter(Boolean).join(' · ')}</li>)}</ul>
        )}
      </section>
      {r.skills.length > 0 && (
        <section><h3 className="text-lg">Habilidades</h3><ul className="mt-1 flex flex-wrap gap-2">{r.skills.map((s) => <li key={s} className="soft-tag mod-trabalho">{s}</li>)}</ul></section>
      )}
      {r.references.length > 0 && (
        <section><h3 className="text-lg">Referências</h3>
          <ul className="mt-1 space-y-1">{r.references.map((x, i) => <li key={i}>{x.name}{x.relation ? ` (${x.relation})` : ''} · {formatPhone(x.phone)}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

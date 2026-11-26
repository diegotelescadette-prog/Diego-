'use client';
import { useActionState, useState } from 'react';
import { Field } from '@/components/Field';
import { EDUCATION_STATUS, RESUME_LIMITS, resumeProgress, type Education, type Experience, type Reference, type ResumeData } from '@/lib/resume';
import { saveResume, type ResumeState } from './actions';

const NEW_EXP: Experience = { role: '', company: '', start: '', end: '', current: false, description: '' };
const NEW_EDU: Education = { course: '', school: '', end: '', status: 'completo' };
const NEW_REF: Reference = { name: '', relation: '', phone: '' };

export function ProgressBar({ r }: { r: ResumeData }) {
  const p = resumeProgress(r);
  return (
    <div data-testid="resume-progress">
      <p className="mb-1 text-sm font-semibold text-stone-800">{p.label}</p>
      <div className="h-3 overflow-hidden rounded-full bg-hoje-100" role="progressbar" aria-label="Currículo completo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}>
        <div className="h-full rounded-full bg-hoje-500" style={{ width: `${p.percent}%` }} />
      </div>
    </div>
  );
}

/** Editor do currículo: listas que crescem (experiências, formação, habilidades e referências) e barra de progresso ao vivo. */
export function ResumeEditor({ initial, neighborhoods }: { initial: ResumeData; neighborhoods: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState<ResumeState, FormData>(saveResume, {});
  const [r, setR] = useState<ResumeData>(initial);
  const [skill, setSkill] = useState('');
  const set = <K extends keyof ResumeData>(k: K, v: ResumeData[K]) => setR((x) => ({ ...x, [k]: v }));
  const upd = <T,>(k: 'experiences' | 'education' | 'references_list', i: number, patch: Partial<T>) =>
    setR((x) => ({ ...x, [k]: (x[k] as T[]).map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const del = (k: 'experiences' | 'education' | 'references_list', i: number) => setR((x) => ({ ...x, [k]: (x[k] as unknown[]).filter((_, j) => j !== i) }));
  const addSkill = () => {
    const s = skill.trim();
    if (s && !r.skills.includes(s) && r.skills.length < RESUME_LIMITS.skills) set('skills', [...r.skills, s]);
    setSkill('');
  };
  const err = state.errors ?? {};
  const inv = (k: string) => (err[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-error` } : {});

  return (
    <form action={action} className="space-y-5" noValidate data-testid="resume-form">
      <div className="card sticky top-[64px] z-10 p-4"><ProgressBar r={r} /></div>
      {state.message && <p role={state.ok ? 'status' : 'alert'} className={`rounded-xl p-3 ${state.ok ? 'bg-sage text-stone-900' : 'bg-red-50 text-red-900'}`} data-testid="resume-msg">{state.message}</p>}
      <input type="hidden" name="experiences" value={JSON.stringify(r.experiences)} />
      <input type="hidden" name="education" value={JSON.stringify(r.education)} />
      <input type="hidden" name="skills" value={JSON.stringify(r.skills)} />
      <input type="hidden" name="references_list" value={JSON.stringify(r.references_list)} />

      <section className="card space-y-4 p-5" aria-labelledby="dados-t">
        <h2 id="dados-t" className="text-xl">Seus dados</h2>
        <Field id="full_name" label="Nome completo" error={err.full_name}>
          <input id="full_name" name="full_name" className="input" maxLength={100} autoComplete="name" value={r.full_name} onChange={(e) => set('full_name', e.target.value)} {...inv('full_name')} />
        </Field>
        <Field id="headline" label="Trabalho que você procura" error={err.headline} hint="Ex.: Auxiliar administrativo, Vendedora, Motorista">
          <input id="headline" name="headline" className="input" maxLength={100} value={r.headline} onChange={(e) => set('headline', e.target.value)} {...inv('headline')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="email" label="E-mail" error={err.email}>
            <input id="email" name="email" type="email" className="input" autoComplete="email" value={r.email} onChange={(e) => set('email', e.target.value)} {...inv('email')} />
          </Field>
          <Field id="phone" label="WhatsApp" error={err.phone} hint="Só aparece para quem você autorizar">
            <input id="phone" name="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" placeholder="(67) 99999-1234" value={r.phone} onChange={(e) => set('phone', e.target.value)} {...inv('phone')} />
          </Field>
        </div>
        <Field id="neighborhood_id" label="Bairro onde mora" error={err.neighborhood_id}>
          <select id="neighborhood_id" name="neighborhood_id" className="input" value={r.neighborhood_id ?? ''} onChange={(e) => set('neighborhood_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Prefiro não informar</option>
            {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </Field>
        <Field id="summary" label="Sobre você" hint="Em poucas linhas: o que você faz bem e como gosta de trabalhar">
          <textarea id="summary" name="summary" className="input" rows={4} maxLength={1500} value={r.summary} onChange={(e) => set('summary', e.target.value)} />
        </Field>
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="exp-t">
        <h2 id="exp-t" className="text-xl">Experiências</h2>
        {err.experiences && <p className="field-error" role="alert">{err.experiences}</p>}
        {r.experiences.map((e, i) => (
          <fieldset key={i} className="space-y-3 rounded-2xl border border-line p-4" data-testid="exp-row">
            <legend className="px-1 text-sm font-semibold text-stone-600">Experiência {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor={`exp-role-${i}`}>Cargo</label><input id={`exp-role-${i}`} className="input" maxLength={80} value={e.role} onChange={(ev) => upd<Experience>('experiences', i, { role: ev.target.value })} /></div>
              <div><label className="label" htmlFor={`exp-co-${i}`}>Empresa ou lugar</label><input id={`exp-co-${i}`} className="input" maxLength={80} value={e.company} onChange={(ev) => upd<Experience>('experiences', i, { company: ev.target.value })} /></div>
              <div><label className="label" htmlFor={`exp-start-${i}`}>Início</label><input id={`exp-start-${i}`} type="month" className="input" value={e.start} onChange={(ev) => upd<Experience>('experiences', i, { start: ev.target.value })} /></div>
              {!e.current && <div><label className="label" htmlFor={`exp-end-${i}`}>Fim</label><input id={`exp-end-${i}`} type="month" className="input" value={e.end} onChange={(ev) => upd<Experience>('experiences', i, { end: ev.target.value })} /></div>}
            </div>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={e.current} onChange={(ev) => upd<Experience>('experiences', i, { current: ev.target.checked })} /> Trabalho aqui atualmente</label>
            <div><label className="label" htmlFor={`exp-desc-${i}`}>O que você fazia (opcional)</label><textarea id={`exp-desc-${i}`} className="input" rows={2} maxLength={500} value={e.description} onChange={(ev) => upd<Experience>('experiences', i, { description: ev.target.value })} /></div>
            <button type="button" className="btn-ghost min-h-11 px-3 text-sm" onClick={() => del('experiences', i)}>Remover experiência</button>
          </fieldset>
        ))}
        {r.experiences.length < RESUME_LIMITS.experiences && <button type="button" className="btn-outline" onClick={() => set('experiences', [...r.experiences, { ...NEW_EXP }])}>Adicionar experiência</button>}
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="edu-t">
        <h2 id="edu-t" className="text-xl">Formação</h2>
        {err.education && <p className="field-error" role="alert">{err.education}</p>}
        {r.education.map((e, i) => (
          <fieldset key={i} className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-2" data-testid="edu-row">
            <legend className="px-1 text-sm font-semibold text-stone-600">Formação {i + 1}</legend>
            <div><label className="label" htmlFor={`edu-c-${i}`}>Curso</label><input id={`edu-c-${i}`} className="input" maxLength={80} placeholder="Ex.: Ensino médio, Técnico em enfermagem" value={e.course} onChange={(ev) => upd<Education>('education', i, { course: ev.target.value })} /></div>
            <div><label className="label" htmlFor={`edu-s-${i}`}>Escola ou instituição</label><input id={`edu-s-${i}`} className="input" maxLength={80} value={e.school} onChange={(ev) => upd<Education>('education', i, { school: ev.target.value })} /></div>
            <div><label className="label" htmlFor={`edu-st-${i}`}>Situação</label>
              <select id={`edu-st-${i}`} className="input" value={e.status} onChange={(ev) => upd<Education>('education', i, { status: ev.target.value as Education['status'] })}>
                {Object.entries(EDUCATION_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div><label className="label" htmlFor={`edu-e-${i}`}>Ano de conclusão</label><input id={`edu-e-${i}`} className="input" inputMode="numeric" maxLength={4} placeholder="2021" value={e.end} onChange={(ev) => upd<Education>('education', i, { end: ev.target.value.replace(/\D/g, '') })} /></div>
            <button type="button" className="btn-ghost min-h-11 px-3 text-sm sm:col-span-2 sm:justify-self-start" onClick={() => del('education', i)}>Remover formação</button>
          </fieldset>
        ))}
        {r.education.length < RESUME_LIMITS.education && <button type="button" className="btn-outline" onClick={() => set('education', [...r.education, { ...NEW_EDU }])}>Adicionar formação</button>}
      </section>

      <section className="card space-y-3 p-5" aria-labelledby="hab-t">
        <h2 id="hab-t" className="text-xl">Habilidades</h2>
        {err.skills && <p className="field-error" role="alert">{err.skills}</p>}
        {r.skills.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Suas habilidades">
            {r.skills.map((s) => (
              <li key={s} className="soft-tag mod-trabalho gap-1">{s}
                <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-full hover:bg-surface/60" aria-label={`Remover ${s}`} onClick={() => set('skills', r.skills.filter((x) => x !== s))}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <label htmlFor="skill" className="sr-only">Nova habilidade</label>
          <input id="skill" className="input" maxLength={40} placeholder="Ex.: Atendimento ao público" value={skill} onChange={(e) => setSkill(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} />
          <button type="button" className="btn-outline flex-none" onClick={addSkill}>Adicionar</button>
        </div>
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="ref-t">
        <h2 id="ref-t" className="text-xl">Referências</h2>
        <p className="text-sm text-stone-600">Pessoas que podem falar do seu trabalho. Avise antes de colocar o contato delas. Elas só aparecem para quem recebe o seu currículo.</p>
        {err.references_list && <p className="field-error" role="alert">{err.references_list}</p>}
        {r.references_list.map((ref, i) => (
          <fieldset key={i} className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-3" data-testid="ref-row">
            <legend className="px-1 text-sm font-semibold text-stone-600">Referência {i + 1}</legend>
            <div><label className="label" htmlFor={`ref-n-${i}`}>Nome</label><input id={`ref-n-${i}`} className="input" maxLength={80} value={ref.name} onChange={(ev) => upd<Reference>('references_list', i, { name: ev.target.value })} /></div>
            <div><label className="label" htmlFor={`ref-r-${i}`}>De onde conhece</label><input id={`ref-r-${i}`} className="input" maxLength={80} placeholder="Ex.: ex-chefe na padaria" value={ref.relation} onChange={(ev) => upd<Reference>('references_list', i, { relation: ev.target.value })} /></div>
            <div><label className="label" htmlFor={`ref-p-${i}`}>Telefone</label><input id={`ref-p-${i}`} className="input" type="tel" inputMode="tel" value={ref.phone} onChange={(ev) => upd<Reference>('references_list', i, { phone: ev.target.value })} /></div>
            <button type="button" className="btn-ghost min-h-11 px-3 text-sm sm:col-span-3 sm:justify-self-start" onClick={() => del('references_list', i)}>Remover referência</button>
          </fieldset>
        ))}
        {r.references_list.length < RESUME_LIMITS.references && <button type="button" className="btn-outline" onClick={() => set('references_list', [...r.references_list, { ...NEW_REF }])}>Adicionar referência</button>}
      </section>

      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>{pending ? 'Salvando…' : 'Salvar currículo'}</button>
    </form>
  );
}

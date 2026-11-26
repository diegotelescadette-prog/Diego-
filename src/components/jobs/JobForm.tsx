'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { AREA_LABEL, EMPLOYMENT_LABEL, WORK_MODE_LABEL } from '@/lib/jobs';
import type { JobFormState } from '@/app/vagas/actions';

type Action = (s: JobFormState, f: FormData) => Promise<JobFormState>;

export function JobForm({ action, initial, neighborhoods, cityName, jobId }: {
  action: Action;
  initial?: Record<string, string>;
  neighborhoods: { id: number; name: string }[];
  cityName: string;
  jobId?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const v = state?.values ?? initial ?? {};
  const e = state?.errors ?? {};
  const inv = (k: string) => (e[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-error` } : {});
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {jobId && <input type="hidden" name="id" value={jobId} />}
      {state?.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
      <Field id="title" label="Cargo" error={e.title} hint="Ex.: Auxiliar de cozinha, Vendedor(a), Eletricista">
        <input id="title" name="title" className="input" maxLength={100} defaultValue={v.title} required {...inv('title')} />
      </Field>
      <Field id="company_name" label="Empresa ou contratante" error={e.company_name} hint="Pode ser o nome da empresa ou o seu, se for pessoa física">
        <input id="company_name" name="company_name" className="input" maxLength={100} defaultValue={v.company_name} required {...inv('company_name')} />
      </Field>
      <Field id="area" label="Área" error={e.area}>
        <select id="area" name="area" className="input" defaultValue={v.area ?? ''} required {...inv('area')}>
          <option value="" disabled>Escolha a área</option>
          {Object.entries(AREA_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="employment_type" label="Tipo de contratação" error={e.employment_type}>
          <select id="employment_type" name="employment_type" className="input" defaultValue={v.employment_type ?? ''} required {...inv('employment_type')}>
            <option value="" disabled>Escolha</option>
            {Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field id="work_mode" label="Formato" error={e.work_mode}>
          <select id="work_mode" name="work_mode" className="input" defaultValue={v.work_mode ?? 'presencial'} required {...inv('work_mode')}>
            {Object.entries(WORK_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="neighborhood_id" label={<>Bairro <span className="font-normal text-stone-500">(opcional)</span></>} error={e.neighborhood_id} hint={`Sem bairro, aparece como “${cityName}”`}>
          <select id="neighborhood_id" name="neighborhood_id" className="input" defaultValue={v.neighborhood_id ?? ''}>
            <option value="">Toda {cityName}</option>
            {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </Field>
        <Field id="openings" label="Número de vagas" error={e.openings}>
          <input id="openings" name="openings" type="number" min={1} max={99} inputMode="numeric" className="input" defaultValue={v.openings || '1'} {...inv('openings')} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Salário por mês <span className="font-normal text-stone-500">(opcional, ajuda a aparecer no filtro)</span></legend>
        <div className="grid grid-cols-2 gap-3">
          <Field id="salary_min" label={<span className="font-normal">De (R$)</span>} error={e.salary_min}>
            <input id="salary_min" name="salary_min" inputMode="numeric" className="input" placeholder="1800" defaultValue={v.salary_min} {...inv('salary_min')} />
          </Field>
          <Field id="salary_max" label={<span className="font-normal">Até (R$)</span>} error={e.salary_max}>
            <input id="salary_max" name="salary_max" inputMode="numeric" className="input" placeholder="2500" defaultValue={v.salary_max} {...inv('salary_max')} />
          </Field>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="salary_text" label={<>Benefícios e observações <span className="font-normal text-stone-500">(opcional)</span></>} error={e.salary_text} hint="Ex.: + vale-transporte, ou A combinar">
          <input id="salary_text" name="salary_text" className="input" maxLength={80} defaultValue={v.salary_text} {...inv('salary_text')} />
        </Field>
        <Field id="schedule_text" label={<>Horário <span className="font-normal text-stone-500">(opcional)</span></>} error={e.schedule_text} hint="Ex.: Seg. a sex., 8h às 17h">
          <input id="schedule_text" name="schedule_text" className="input" maxLength={80} defaultValue={v.schedule_text} {...inv('schedule_text')} />
        </Field>
      </div>
      <Field id="description" label="Descrição da vaga" error={e.description} hint="Atividades, horário, benefícios e como será a seleção">
        <textarea id="description" name="description" className="input" rows={7} maxLength={4000} defaultValue={v.description} required {...inv('description')} />
      </Field>
      <Field id="requirements" label={<>Requisitos <span className="font-normal text-stone-500">(opcional)</span></>} error={e.requirements}>
        <textarea id="requirements" name="requirements" className="input" rows={4} maxLength={2000} defaultValue={v.requirements} {...inv('requirements')} />
      </Field>
      {!jobId && (
        <div>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="aceite" className="mt-1 h-5 w-5 flex-none" {...inv('aceite')} />
            <span>Confirmo que a vaga é real, que <strong>não vou cobrar nada dos candidatos</strong> e que vou usar os currículos recebidos só para esta seleção, sem repassá-los a terceiros.</span>
          </label>
          {e.aceite && <p id="aceite-error" className="field-error" role="alert">{e.aceite}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="Salvando…">{jobId ? 'Salvar alterações' : 'Publicar vaga'}</SubmitButton>
        <Link href={jobId ? `/minhas-vagas/${jobId}` : '/vagas'} className="btn-ghost">Cancelar</Link>
      </div>
    </form>
  );
}

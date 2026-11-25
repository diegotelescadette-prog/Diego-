'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Field } from '@/components/Field';
import { APP_NAME } from '@/config/brand';

export interface TalentDefaults {
  full_name: string; desired_role: string; summary: string; email: string; phone: string; neighborhood_id: string; resume_filename: string | null;
}

/** Cadastro/atualização do currículo no banco (multipart para /api/vagas/meu-curriculo). */
export function TalentForm({ defaults, neighborhoods, cityName }: {
  defaults: TalentDefaults; neighborhoods: { id: number; name: string }[]; cityName: string;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const editing = !!defaults.resume_filename;

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setPending(true); setMessage(null); setErrors({});
    try {
      const res = await fetch('/api/vagas/meu-curriculo', { method: 'POST', body: new FormData(ev.currentTarget) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { router.replace(`/vagas/meu-curriculo?msg=${encodeURIComponent('Currículo salvo no banco. Ele fica visível por 6 meses para quem está contratando.')}`); router.refresh(); return; }
      if (body.errors) setErrors(body.errors);
      setMessage(body.error ?? (body.errors ? 'Confira os campos destacados.' : 'Não foi possível salvar. Tente de novo.'));
    } catch {
      setMessage('Sem conexão. Tente de novo.');
    } finally {
      setPending(false);
    }
  }
  const inv = (k: string) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-error` } : {});
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{message}</p>}
      <Field id="full_name" label="Nome completo" error={errors.full_name}>
        <input id="full_name" name="full_name" className="input" maxLength={100} autoComplete="name" defaultValue={defaults.full_name} {...inv('full_name')} />
      </Field>
      <Field id="desired_role" label="Que trabalho você procura?" error={errors.desired_role} hint="Ex.: Vendedor(a), Auxiliar de cozinha, Motorista">
        <input id="desired_role" name="desired_role" className="input" maxLength={100} defaultValue={defaults.desired_role} {...inv('desired_role')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="email" label="E-mail para contato" error={errors.email}>
          <input id="email" name="email" type="email" className="input" autoComplete="email" defaultValue={defaults.email} {...inv('email')} />
        </Field>
        <Field id="phone" label={<>WhatsApp <span className="font-normal text-stone-500">(opcional)</span></>} error={errors.phone}>
          <input id="phone" name="phone" type="tel" inputMode="tel" className="input" placeholder="(67) 99999-1234" defaultValue={defaults.phone} {...inv('phone')} />
        </Field>
      </div>
      <Field id="neighborhood_id" label={<>Bairro onde mora <span className="font-normal text-stone-500">(opcional)</span></>} error={errors.neighborhood_id} hint="Ajuda quem contrata perto de você. Nunca mostramos endereço.">
        <select id="neighborhood_id" name="neighborhood_id" className="input" defaultValue={defaults.neighborhood_id}>
          <option value="">Não informar ({cityName})</option>
          {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </Field>
      <Field id="summary" label={<>Resumo <span className="font-normal text-stone-500">(opcional)</span></>} error={errors.summary} hint="Experiência, cursos e disponibilidade de horário, em poucas linhas">
        <textarea id="summary" name="summary" className="input" rows={4} maxLength={1500} defaultValue={defaults.summary} {...inv('summary')} />
      </Field>
      <Field id="resume" label={editing ? 'Trocar currículo (PDF, até 4 MB)' : 'Currículo (PDF, até 4 MB)'} error={errors.resume}
        hint={editing ? `Atual: ${defaults.resume_filename}. Deixe vazio para manter.` : undefined}>
        <input id="resume" name="resume" type="file" accept="application/pdf,.pdf" className="input py-2" {...inv('resume')} />
      </Field>
      <div>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent" className="mt-1 h-5 w-5 flex-none" {...inv('consent')} />
          <span>Autorizo que <strong>empresas e pessoas com vaga aberta</strong> no {APP_NAME} vejam meu currículo e estes dados de contato, para me oferecer trabalho.
            Posso ocultar ou apagar quando quiser. <Link href="/privacidade#curriculos" className="underline">Como cuidamos dos seus dados</Link></span>
        </label>
        {errors.consent && <p id="consent-error" className="field-error" role="alert">{errors.consent}</p>}
      </div>
      <button type="submit" className="btn-primary" disabled={pending} aria-disabled={pending}>{pending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Enviar meu currículo'}</button>
    </form>
  );
}

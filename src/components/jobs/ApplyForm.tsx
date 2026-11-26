'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Field } from '@/components/Field';

/** Envio da candidatura (multipart para /api/vagas/candidatar). */
export function ApplyForm({ jobId, defaults, posterLabel }: {
  jobId: string; defaults: { full_name: string; email: string; phone: string }; posterLabel: string;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setPending(true); setMessage(null); setErrors({});
    try {
      const res = await fetch('/api/vagas/candidatar', { method: 'POST', body: new FormData(ev.currentTarget) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setDone(true); return; }
      if (body.errors) setErrors(body.errors);
      setMessage(body.error ?? (body.errors ? 'Confira os campos destacados.' : 'Não foi possível enviar. Tente de novo.'));
    } catch {
      setMessage('Sem conexão. Tente de novo.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-xl bg-sage p-4 text-stone-900" data-testid="candidatura-ok">
        <p className="font-bold">Candidatura enviada!</p>
        <p className="mt-1">{posterLabel} recebeu seu currículo. Acompanhe a situação em <Link className="underline" href="/minhas-candidaturas">Minhas candidaturas</Link>.</p>
      </div>
    );
  }
  const inv = (k: string) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-error` } : {});
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <input type="hidden" name="job_id" value={jobId} />
      {message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{message}</p>}
      <Field id="full_name" label="Nome completo" error={errors.full_name}>
        <input id="full_name" name="full_name" className="input" maxLength={100} autoComplete="name" defaultValue={defaults.full_name} required {...inv('full_name')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="email" label="E-mail para contato" error={errors.email}>
          <input id="email" name="email" type="email" className="input" autoComplete="email" defaultValue={defaults.email} required {...inv('email')} />
        </Field>
        <Field id="phone" label={<>WhatsApp <span className="font-normal text-stone-500">(opcional)</span></>} error={errors.phone}>
          <input id="phone" name="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" placeholder="(67) 99999-1234" defaultValue={defaults.phone} {...inv('phone')} />
        </Field>
      </div>
      <Field id="resume" label="Currículo (PDF, até 4 MB)" error={errors.resume}>
        <input id="resume" name="resume" type="file" accept="application/pdf,.pdf" className="input py-2" required {...inv('resume')} />
      </Field>
      <Field id="message" label={<>Mensagem <span className="font-normal text-stone-500">(opcional)</span></>} error={errors.message} hint="Conte em poucas linhas por que a vaga combina com você">
        <textarea id="message" name="message" className="input" rows={4} maxLength={1500} {...inv('message')} />
      </Field>
      <div>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent" className="mt-1 h-5 w-5 flex-none" {...inv('consent')} />
          <span>Autorizo o envio do meu currículo e dos dados acima para <strong>{posterLabel}</strong>, somente para esta seleção.
            Posso retirar a candidatura e apagar o currículo quando quiser. <Link href="/privacidade#curriculos" className="underline">Como cuidamos dos seus dados</Link></span>
        </label>
        {errors.consent && <p id="consent-error" className="field-error" role="alert">{errors.consent}</p>}
      </div>
      <button type="submit" className="btn-primary" disabled={pending} aria-disabled={pending}>{pending ? 'Enviando…' : 'Enviar candidatura'}</button>
    </form>
  );
}

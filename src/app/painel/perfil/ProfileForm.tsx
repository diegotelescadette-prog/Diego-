'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Field } from '@/components/Field';
import { ServicePicker } from '@/components/ServicePicker';
import { ProfilePhotoUploader } from '@/components/PhotoUploader';
import { SubmitButton } from '@/components/SubmitButton';
import { saveProfileStep } from '../actions';
import type { Category } from '@/lib/types';

export interface ProfileInitial {
  display_name: string; bio: string; phone: string; whatsapp: string; photoUrl: string | null;
  services: number[]; main: number | null; cpfLast2: string | null; status: string;
}

/** section: 'tudo' = etapa 1 do pré-cadastro; 'perfil' = nome, apresentação e contato; 'servicos' = especialidades e fotos. */
export function ProfileForm({ initial, catalog, cpf, section = 'tudo' }: {
  initial: ProfileInitial; catalog: Category[]; cpf: { enabled: boolean; purpose: string | null }; section?: 'tudo' | 'perfil' | 'servicos';
}) {
  const showContact = section !== 'servicos';
  const showServices = section !== 'perfil';
  const [state, action] = useActionState(saveProfileStep, undefined);
  const [same, setSame] = useState(!initial.whatsapp || initial.whatsapp === initial.phone);
  const e = state?.errors ?? {};
  const v = (k: keyof ProfileInitial) => state?.values?.[k] ?? (initial[k] as string);
  const inv = (k: string) => ({ 'aria-invalid': !!e[k], 'aria-describedby': e[k] ? `${k}-error` : undefined });

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="section" value={section} />
      {state?.message && (
        <p role={state.ok ? 'status' : 'alert'} className={`rounded-xl p-3 ${state.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>{state.message}</p>
      )}
      {showContact && (
        <>
      <Field id="display_name" label="Nome profissional" error={e.display_name} hint="Como os clientes vão ver você. Ex.: João Encanador.">
        <input id="display_name" name="display_name" defaultValue={v('display_name')} maxLength={80} className="input" autoComplete="name" {...inv('display_name')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" label="Telefone com DDD" error={e.phone} hint="Não aparece no perfil nem na busca.">
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={v('phone')} placeholder="(67) 99999-1234" className="input" {...inv('phone')} />
        </Field>
        <div>
          <label className="mt-7 flex min-h-11 items-center gap-2">
            <input type="checkbox" name="same_whatsapp" checked={same} onChange={(ev) => setSame(ev.target.checked)} className="h-5 w-5" />
            Este número também é meu WhatsApp
          </label>
        </div>
      </div>
      {!same && (
        <Field id="whatsapp" label="WhatsApp para contato" error={e.whatsapp} hint="Celular com DDD. Usado só para gerar o link “Chamar no WhatsApp”.">
          <input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" defaultValue={v('whatsapp')} placeholder="(67) 99999-1234" className="input" {...inv('whatsapp')} />
        </Field>
      )}
      {same && e.whatsapp && <p className="field-error" role="alert">{e.whatsapp}</p>}

      {cpf.enabled && (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
          <Field id="cpf" label="CPF (privado)" error={e.cpf}
            hint={initial.cpfLast2 ? `CPF já informado (final ${initial.cpfLast2}). Preencha só se quiser trocar.` : 'Nunca aparece no perfil, na busca ou em links.'}>
            <input id="cpf" name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" className="input" {...inv('cpf')} />
          </Field>
          <div className="mt-3 text-sm text-stone-700" id="cpf-aviso">
            <p><strong>Aviso de privacidade:</strong> {cpf.purpose ?? 'Usamos o CPF apenas para a finalidade informada pela operação do piloto.'}</p>
            <p className="mt-1">O CPF é guardado cifrado e só é usado para essa finalidade. A checagem dos dígitos confere apenas o formato e não verifica sua identidade. Você pode pedir a exclusão a qualquer momento em <Link href="/conta" className="underline">Minha conta</Link>.</p>
          </div>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="cpf_aviso" className="mt-0.5 h-5 w-5" /> Li o aviso sobre o uso do CPF.
          </label>
        </div>
      )}

        </>
      )}

      {showServices && <ProfilePhotoUploader initialUrl={initial.photoUrl} error={e.photo} />}
      {showServices && <ServicePicker catalog={catalog} selected={initial.services} main={initial.main} error={e.services} mainError={e.main_service} />}

      {showContact && <Field id="bio" label={<>Descrição curta <span className="font-normal text-stone-500">(opcional)</span></>} error={e.bio} hint="Até 600 caracteres. Conte sua experiência e o que você resolve.">
        <textarea id="bio" name="bio" defaultValue={v('bio')} maxLength={600} rows={4} className="input" {...inv('bio')} />
      </Field>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {section === 'tudo' ? (
          <>
            {initial.status === 'draft' && <SubmitButton name="intent" value="rascunho" className="btn-ghost" pendingText="Salvando…">Salvar rascunho</SubmitButton>}
            <SubmitButton name="intent" value="continuar" className="btn-primary" pendingText="Salvando…">
              {initial.status === 'draft' ? 'Salvar e continuar' : 'Salvar alterações'}
            </SubmitButton>
          </>
        ) : (
          <SubmitButton name="intent" value="salvar" className="btn-primary" pendingText="Salvando…">Salvar alterações</SubmitButton>
        )}
      </div>
    </form>
  );
}

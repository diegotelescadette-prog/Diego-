'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { Field } from './Field';
import { SubmitButton } from './SubmitButton';
import { completeSignup, requestPasswordReset, resendConfirmation, signIn, signUp, updatePassword, type AuthState } from '@/app/auth-actions';

export type Bairro = { id: number; name: string };

function Msg({ state }: { state: AuthState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={`rounded-xl p-3 ${state.ok ? 'bg-sage text-stone-900' : 'bg-red-50 text-red-900'}`}>
      {state.message}
    </p>
  );
}

const inv = (s: AuthState, k: string) => ({ 'aria-invalid': !!s?.errors?.[k], 'aria-describedby': s?.errors?.[k] ? `${k}-error` : undefined });

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, undefined);
  const [rState, resend] = useActionState(resendConfirmation, undefined);
  const q = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <Msg state={state} />
        <Field id="email" label="E-mail" error={state?.errors?.email}>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" defaultValue={state?.email} {...inv(state, 'email')} />
        </Field>
        <Field id="password" label="Senha" error={state?.errors?.password}>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" {...inv(state, 'password')} />
        </Field>
        <SubmitButton className="btn-primary w-full" pendingText="Entrando…">Entrar</SubmitButton>
      </form>
      {state?.message?.startsWith('Confirme') && (
        <form action={resend} className="space-y-2">
          <input type="hidden" name="email" value={state.email ?? ''} />
          <SubmitButton className="btn-ghost w-full">Reenviar e-mail de confirmação</SubmitButton>
          <Msg state={rState} />
        </form>
      )}
      <p className="text-center"><Link className="text-brand-700 underline" href="/recuperar-senha">Esqueci minha senha</Link></p>
      <p className="text-center text-stone-700">Ainda não tem conta? <Link className="font-semibold text-brand-700 underline" href={`/cadastrar${q}`}>Criar conta</Link></p>
    </div>
  );
}

/** Nome completo, nome público, celular, bairro e os aceites: os mesmos no cadastro e ao completar uma conta antiga. */
function ProfileFields({ state, bairros }: { state: AuthState; bairros: Bairro[] }) {
  const v = state?.values ?? {};
  return (
    <>
      <Field id="nome_completo" label="Nome completo" error={state?.errors?.nome_completo} hint="Usado na identificação da conta. Não aparece para os outros.">
        <input id="nome_completo" name="nome_completo" autoComplete="name" required maxLength={100} className="input" defaultValue={v.nome_completo} {...inv(state, 'nome_completo')} />
      </Field>
      <Field id="nome_publico" label="Nome público" error={state?.errors?.nome_publico} hint="É como você aparece no app, por exemplo “Ana do Centro”.">
        <input id="nome_publico" name="nome_publico" autoComplete="nickname" required maxLength={60} className="input" defaultValue={v.nome_publico} {...inv(state, 'nome_publico')} />
      </Field>
      <Field id="celular" label="Celular com WhatsApp" error={state?.errors?.celular} hint="Só aparece para alguém depois que vocês dois aceitarem o contato.">
        <input id="celular" name="celular" type="tel" inputMode="tel" autoComplete="tel-national" required placeholder="(67) 99999-9999" className="input" defaultValue={v.celular} {...inv(state, 'celular')} />
      </Field>
      <Field id="bairro" label="Bairro de Campo Grande" error={state?.errors?.bairro}>
        {/* key: depois de um erro, o formulário volta com o bairro já escolhido */}
        <select key={v.bairro ?? ''} id="bairro" name="bairro" required className="input" defaultValue={v.bairro ?? ''} {...inv(state, 'bairro')}>
          <option value="" disabled>Escolha o seu bairro</option>
          {bairros.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <div>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="aceite" className="mt-1 h-5 w-5" {...inv(state, 'aceite')} />
          <span>
            Li e aceito os <Link href="/termos" className="text-brand-700 underline" target="_blank">Termos de uso</Link> e o{' '}
            <Link href="/privacidade" className="text-brand-700 underline" target="_blank">Aviso de privacidade</Link>.
          </span>
        </label>
        <p className="mt-1 text-sm text-stone-600" data-testid="aceite-resumo">
          Usamos seus dados para identificar quem está do outro lado e manter o app seguro. Seu telefone só aparece com o aceite das duas partes, e você pode excluir a conta quando quiser em Minha conta.
        </p>
        {state?.errors?.aceite && <p id="aceite-error" className="field-error" role="alert">{state.errors.aceite}</p>}
      </div>
    </>
  );
}

export function SignUpForm({ next, bairros }: { next: string; bairros: Bairro[] }) {
  const [state, action] = useActionState(signUp, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Msg state={state} />
      <ProfileFields state={state} bairros={bairros} />
      <Field id="email" label="E-mail" error={state?.errors?.email} hint="Usado só para entrar e recuperar a senha. Não aparece no perfil.">
        <input id="email" name="email" type="email" autoComplete="email" required className="input" defaultValue={state?.email} {...inv(state, 'email')} />
      </Field>
      <Field id="password" label="Senha" error={state?.errors?.password} hint="Mínimo de 8 caracteres.">
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="input" {...inv(state, 'password')} />
      </Field>
      <SubmitButton className="btn-primary w-full" pendingText="Criando conta…">Criar conta grátis</SubmitButton>
      <p className="text-center text-stone-700">Já tem conta? <Link className="font-semibold text-brand-700 underline" href={`/entrar?next=${encodeURIComponent(next)}`}>Entrar</Link></p>
    </form>
  );
}

export function CompleteSignupForm({ next, bairros, defaults }: { next: string; bairros: Bairro[]; defaults: Record<string, string> }) {
  const [state, action] = useActionState(completeSignup, { values: defaults });
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Msg state={state} />
      <ProfileFields state={state} bairros={bairros} />
      <SubmitButton className="btn-primary w-full" pendingText="Salvando…">Salvar e continuar</SubmitButton>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Msg state={state} />
      <Field id="email" label="E-mail da conta" error={state?.errors?.email}>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" {...inv(state, 'email')} />
      </Field>
      <SubmitButton className="btn-primary w-full">Enviar link</SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Msg state={state} />
      <Field id="password" label="Nova senha" error={state?.errors?.password} hint="Mínimo de 8 caracteres.">
        <input id="password" name="password" type="password" autoComplete="new-password" required className="input" {...inv(state, 'password')} />
      </Field>
      <Field id="confirm" label="Repita a nova senha" error={state?.errors?.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" {...inv(state, 'confirm')} />
      </Field>
      <SubmitButton className="btn-primary w-full">Salvar nova senha</SubmitButton>
    </form>
  );
}

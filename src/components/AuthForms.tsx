'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { Field } from './Field';
import { SubmitButton } from './SubmitButton';
import { requestPasswordReset, resendConfirmation, signIn, signUp, updatePassword, type AuthState } from '@/app/auth-actions';

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

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Msg state={state} />
      <Field id="email" label="E-mail" error={state?.errors?.email} hint="Usado só para entrar e recuperar a senha. Não aparece no perfil.">
        <input id="email" name="email" type="email" autoComplete="email" required className="input" defaultValue={state?.email} {...inv(state, 'email')} />
      </Field>
      <Field id="password" label="Senha" error={state?.errors?.password} hint="Mínimo de 8 caracteres.">
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="input" {...inv(state, 'password')} />
      </Field>
      <div>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="aceite" className="mt-1 h-5 w-5" {...inv(state, 'aceite')} />
          <span>Li e concordo com o <Link href="/privacidade" className="text-brand-700 underline" target="_blank">aviso de privacidade</Link>.</span>
        </label>
        {state?.errors?.aceite && <p id="aceite-error" className="field-error" role="alert">{state.errors.aceite}</p>}
      </div>
      <SubmitButton className="btn-primary w-full" pendingText="Criando conta…">Criar conta</SubmitButton>
      <p className="text-center text-stone-700">Já tem conta? <Link className="font-semibold text-brand-700 underline" href={`/entrar?next=${encodeURIComponent(next)}`}>Entrar</Link></p>
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

'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/validation';
import { siteUrl } from '@/lib/site';

export type AuthState = { errors?: Record<string, string>; message?: string; ok?: boolean; email?: string } | undefined;

const Email = z.string().trim().toLowerCase().email('Informe um e-mail válido');
const Password = z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(72, 'Senha muito longa');

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const email = Email.safeParse(form.get('email'));
  const password = z.string().min(1, 'Informe a senha').safeParse(form.get('password'));
  const next = safeNext(String(form.get('next') ?? ''), '/');
  const errors: Record<string, string> = {};
  if (!email.success) errors.email = email.error.issues[0].message;
  if (!password.success) errors.password = password.error.issues[0].message;
  if (Object.keys(errors).length) return { errors, email: String(form.get('email') ?? '') };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data!, password: password.data! });
  if (error) {
    if (error.code === 'email_not_confirmed') {
      return { message: 'Confirme seu e-mail antes de entrar. Procure a mensagem que enviamos (veja também o spam).', email: email.data };
    }
    if (error.status === 429) return { message: 'Muitas tentativas. Aguarde alguns minutos.', email: email.data };
    return { message: 'E-mail ou senha incorretos.', email: email.data };
  }
  redirect(next);
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const email = Email.safeParse(form.get('email'));
  const password = Password.safeParse(form.get('password'));
  const next = safeNext(String(form.get('next') ?? ''), '/');
  const errors: Record<string, string> = {};
  if (!email.success) errors.email = email.error.issues[0].message;
  if (!password.success) errors.password = password.error.issues[0].message;
  if (form.get('aceite') !== 'on') errors.aceite = 'É preciso concordar com o aviso de privacidade';
  if (Object.keys(errors).length) return { errors, email: String(form.get('email') ?? '') };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.data!,
    password: password.data!,
    options: { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    if (error.status === 429) return { message: 'Muitas tentativas. Aguarde alguns minutos.', email: email.data };
    if (error.code === 'weak_password') return { errors: { password: 'Escolha uma senha mais forte' }, email: email.data };
    return { message: 'Não foi possível criar a conta agora. Tente novamente.', email: email.data };
  }
  // Se a confirmação de e-mail estiver desligada no projeto, a sessão já vem pronta.
  if (data.session) redirect(next);
  redirect('/verifique-email');
}

export async function resendConfirmation(_: AuthState, form: FormData): Promise<AuthState> {
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { errors: { email: 'Informe um e-mail válido' } };
  const supabase = await createClient();
  await supabase.auth.resend({ type: 'signup', email: email.data, options: { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=%2F` } });
  return { ok: true, message: 'Se houver uma conta pendente com esse e-mail, reenviamos a confirmação.' };
}

export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { errors: { email: email.error.issues[0].message } };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent('/redefinir-senha')}`,
  });
  // Mesma resposta exista ou não a conta (não revela e-mails cadastrados).
  return { ok: true, message: 'Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha.' };
}

export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const password = Password.safeParse(form.get('password'));
  if (!password.success) return { errors: { password: password.error.issues[0].message } };
  if (form.get('password') !== form.get('confirm')) return { errors: { confirm: 'As senhas não conferem' } };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { message: 'O link expirou. Peça um novo link de recuperação.' };
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { message: error.code === 'same_password' ? 'Use uma senha diferente da atual.' : 'Não foi possível alterar a senha.' };
  redirect('/conta?senha=alterada');
}

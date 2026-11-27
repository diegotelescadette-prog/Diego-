'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeWhatsapp, safeNext } from '@/lib/validation';
import { siteUrl } from '@/lib/site';
import { FIRST_GOALS } from '@/lib/nav';

export type AuthState = { errors?: Record<string, string>; message?: string; ok?: boolean; email?: string; values?: Record<string, string> } | undefined;

const CAREFUL = 'Quer reescrever com mais carinho? O texto tem palavras que não usamos aqui.';

/** Dados do cadastro (uma tela): nome completo, nome público, celular com WhatsApp, bairro e os aceites. */
function parseProfile(form: FormData) {
  const values = {
    nome_completo: String(form.get('nome_completo') ?? '').trim().replace(/\s+/g, ' '),
    nome_publico: String(form.get('nome_publico') ?? '').trim().replace(/\s+/g, ' '),
    celular: String(form.get('celular') ?? '').trim(),
    bairro: String(form.get('bairro') ?? ''),
  };
  const errors: Record<string, string> = {};
  if (values.nome_completo.length < 5 || !values.nome_completo.includes(' ') || values.nome_completo.length > 100) errors.nome_completo = 'Informe o nome completo (nome e sobrenome)';
  if (values.nome_publico.length < 2 || values.nome_publico.length > 60) errors.nome_publico = 'Informe como você quer aparecer no app (de 2 a 60 letras)';
  const phone = normalizeWhatsapp(values.celular);
  if (!phone) errors.celular = 'Informe um celular com DDD, por exemplo (67) 99999-9999';
  const bairro = Number(values.bairro);
  if (!Number.isInteger(bairro) || bairro <= 0) errors.bairro = 'Escolha o seu bairro';
  if (form.get('aceite') !== 'on') errors.aceite = 'É preciso aceitar os Termos de uso e o Aviso de privacidade';
  return { values, errors, phone: phone ?? '', bairro };
}

/** Confere ofensas nos nomes antes de criar a conta (o banco confere de novo ao gravar). */
async function offensiveNames(values: { nome_completo: string; nome_publico: string }) {
  const admin = createAdminClient();
  for (const k of ['nome_completo', 'nome_publico'] as const) {
    const { data } = await admin.rpc('text_offense', { t: values[k] });
    if (data) return k;
  }
  return null;
}

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
  // Conta antiga, sem os dados do cadastro: completa antes de seguir (o redirecionamento da ação não passa pelo middleware).
  const { data: done } = await supabase.from('member_accounts').select('user_id').maybeSingle();
  if (!done) redirect(`/completar-cadastro?next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const email = Email.safeParse(form.get('email'));
  const password = Password.safeParse(form.get('password'));
  const next = safeNext(String(form.get('next') ?? ''), '/');
  const profile = parseProfile(form);
  const errors: Record<string, string> = { ...profile.errors };
  if (!email.success) errors.email = email.error.issues[0].message;
  if (!password.success) errors.password = password.error.issues[0].message;
  const back = { email: String(form.get('email') ?? ''), values: profile.values };
  if (Object.keys(errors).length) return { errors, ...back };
  const bad = await offensiveNames(profile.values);
  if (bad) return { errors: { [bad]: CAREFUL }, ...back };

  // Depois de confirmar o e-mail: volta para o link de origem ou, sem link, para "O que você quer fazer primeiro?".
  const after = next === '/' ? '/boas-vindas' : next;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.data!,
    password: password.data!,
    options: { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(after)}` },
  });
  if (error) {
    if (error.status === 429) return { message: 'Muitas tentativas. Aguarde alguns minutos.', ...back };
    if (error.code === 'weak_password') return { errors: { password: 'Escolha uma senha mais forte' }, ...back };
    return { message: 'Não foi possível criar a conta agora. Tente novamente.', ...back };
  }
  // E-mail já cadastrado: o Supabase devolve uma conta sem identidades e não cria nada.
  if (data.user && (data.user.identities?.length ?? 0) > 0) {
    await createAdminClient().rpc('save_signup', {
      p_user: data.user.id, p_full_name: profile.values.nome_completo, p_public_name: profile.values.nome_publico,
      p_phone: profile.phone, p_neighborhood: profile.bairro, p_terms: true, p_goal: null,
    });
  }
  // Se a confirmação de e-mail estiver desligada no projeto, a sessão já vem pronta.
  if (data.session) redirect(after);
  redirect('/verifique-email');
}

/** Conta antiga ou cadastro incompleto: completa os dados e segue para onde ia. */
export async function completeSignup(_: AuthState, form: FormData): Promise<AuthState> {
  const next = safeNext(String(form.get('next') ?? ''), '/');
  const profile = parseProfile(form);
  if (Object.keys(profile.errors).length) return { errors: profile.errors, values: profile.values };
  const supabase = await createClient();
  const { error } = await supabase.rpc('complete_signup', {
    p_full_name: profile.values.nome_completo, p_public_name: profile.values.nome_publico,
    p_phone: profile.phone, p_neighborhood: profile.bairro, p_terms: true,
  });
  if (error) {
    if (error.message.includes('carinho')) return { message: CAREFUL, values: profile.values };
    if (error.code === '42501') redirect(`/entrar?next=${encodeURIComponent(next)}`);
    return { message: error.code === '22023' ? error.message : 'Não foi possível salvar agora. Tente novamente.', values: profile.values };
  }
  redirect(next);
}

/** "O que você quer fazer primeiro?": guarda a escolha (opcional) e leva para a área. */
export async function chooseFirstGoal(form: FormData) {
  const goal = FIRST_GOALS.find((g) => g.key === form.get('goal'));
  if (!goal) redirect('/');
  const supabase = await createClient();
  await supabase.rpc('set_first_goal', { p_goal: goal.key });
  redirect(goal.href);
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

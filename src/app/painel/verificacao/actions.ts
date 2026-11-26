'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { onlyDigits } from '@/lib/validation';

export type VerifState = { ok?: boolean; message?: string; error?: string; values?: Record<string, string> } | undefined;

const keys = ['legal_name', 'is_company', 'company_name', 'responsible_name', 'experience_years', 'refs_consent', 'privacy_ack',
  'ch_institution', 'ch_role', 'ch_linked', 'ch_url',
  ...[1, 2, 3].flatMap((i) => [`r${i}_name`, `r${i}_contact`, `r${i}_service`, `r${i}_period`])];

/** Salva o rascunho ou envia para análise. O banco confere tudo de novo (função save_my_verification). */
export async function saveVerification(_: VerifState, form: FormData): Promise<VerifState> {
  const values = Object.fromEntries(keys.map((k) => [k, String(form.get(k) ?? '')]));
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Entre na sua conta para continuar.', values };
  const submit = form.get('intent') === 'enviar';
  const exp = values.experience_years.trim();
  if (exp && !/^\d{1,2}$/.test(exp)) return { error: 'Informe o tempo de experiência em anos (só números).', values };
  const url = values.ch_url.trim();
  if (values.ch_institution.trim() && !/^https:\/\/\S+$/.test(url)) return { error: 'O canal oficial precisa ser um endereço que começa com https://', values };
  const refs = [1, 2, 3].map((i) => ({
    position: i, name: values[`r${i}_name`], contact: onlyDigits(values[`r${i}_contact`]), service: values[`r${i}_service`], period: values[`r${i}_period`],
  }));
  const { data, error } = await supabase.rpc('save_my_verification', {
    p_legal_name: values.legal_name, p_is_company: values.is_company === '1', p_company_name: values.company_name,
    p_responsible_name: values.responsible_name, p_experience_years: exp ? Number(exp) : null, p_refs: refs,
    p_refs_consent: values.refs_consent === '1', p_privacy_ack: values.privacy_ack === '1',
    p_channel: values.ch_institution.trim() ? { institution_name: values.ch_institution, role: values.ch_role || 'instituicao', linked_institution: values.ch_linked, official_url: url } : null,
    p_submit: submit,
  });
  if (error) {
    const msg = error.code === '23514' || error.code === '42501' ? error.message : 'Não foi possível salvar. Tente de novo.';
    return { error: msg, values };
  }
  revalidatePath('/painel', 'layout');
  return {
    ok: true, values,
    message: submit
      ? (data === 'aprovado' ? 'Dados atualizados. Seu cadastro continua aprovado.' : 'Enviado para análise. A equipe vai conferir seus dados e falar com as referências.')
      : 'Rascunho salvo.',
  };
}

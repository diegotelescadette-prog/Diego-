'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/data';
import { encryptCpf } from '@/lib/cpf-crypto';
import { isValidCnpj, isValidCpf, onlyDigits } from '@/lib/validation';

export type EmployerState = { ok?: boolean; message?: string; errors?: Record<string, string>; values?: Record<string, string> };

/** Quem contrata informa CNPJ (empresa) ou CPF (pessoa) e o endereço. O CPF é cifrado antes de ir para o banco. */
export async function submitEmployer(_: EmployerState, form: FormData): Promise<EmployerState> {
  const user = await getUser();
  if (!user) return { message: 'Entre na sua conta.' };
  const v = Object.fromEntries(['kind', 'document', 'legal_name', 'address', 'neighborhood_id'].map((k) => [k, String(form.get(k) ?? '').trim()]));
  const errors: Record<string, string> = {};
  const kind = v.kind === 'cpf' ? 'cpf' : v.kind === 'cnpj' ? 'cnpj' : '';
  const doc = onlyDigits(v.document);
  if (!kind) errors.kind = 'Escolha empresa (CNPJ) ou pessoa (CPF)';
  else if (kind === 'cnpj' && !isValidCnpj(doc)) errors.document = 'CNPJ inválido. Confira os 14 números.';
  else if (kind === 'cpf' && !isValidCpf(doc)) errors.document = 'CPF inválido. Confira os 11 números.';
  if (v.legal_name.length < 2) errors.legal_name = kind === 'cpf' ? 'Informe seu nome completo' : 'Informe a razão social ou o nome da empresa';
  if (v.address.length < 5) errors.address = 'Informe o endereço com número';
  if (v.neighborhood_id && !/^\d+$/.test(v.neighborhood_id)) errors.neighborhood_id = 'Bairro inválido';
  const values = { ...v, document: '' };
  if (Object.keys(errors).length) return { errors, values, message: 'Confira os campos destacados.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_employer_verification', {
    p_kind: kind, p_cnpj: kind === 'cnpj' ? doc : null, p_cpf_ciphertext: kind === 'cpf' ? encryptCpf(doc) : null,
    p_cpf_last2: kind === 'cpf' ? doc.slice(-2) : null, p_legal_name: v.legal_name.slice(0, 120), p_address: v.address.slice(0, 200),
    p_neighborhood: v.neighborhood_id ? Number(v.neighborhood_id) : null,
  });
  if (error) return { values, message: error.message.includes('already_verified') ? 'Seus dados já foram conferidos.' : 'Não foi possível enviar agora. Tente de novo.' };
  revalidatePath('/vagas/verificacao');
  return { ok: true, message: 'Recebemos seus dados. A equipe confere em até 1 dia útil e a sua vaga vai ao ar logo depois.' };
}

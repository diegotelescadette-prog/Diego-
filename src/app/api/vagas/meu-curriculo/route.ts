import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { hitLimit } from '@/lib/rate-limit';
import { normalizeWhatsapp } from '@/lib/validation';
import { looksLikePdf, MAX_RESUME_BYTES, safeResumeName } from '@/lib/jobs';

/** Cria ou atualiza o currículo no banco. O PDF é opcional ao atualizar (mantém o anterior). */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Entre na sua conta para enviar o currículo' }, { status: 401 });
  if (!(await hitLimit('banco-curriculo', user.id, 20, 3600))) {
    return NextResponse.json({ error: 'Muitos envios. Aguarde um pouco.' }, { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Envio inválido' }, { status: 400 });

  const { data: current } = await supabase.from('talent_profiles').select('resume_path').eq('user_id', user.id).maybeSingle();
  const errors: Record<string, string> = {};
  const fullName = String(form.get('full_name') ?? '').trim().replace(/\s+/g, ' ');
  const role = String(form.get('desired_role') ?? '').trim().replace(/\s+/g, ' ');
  const summary = String(form.get('summary') ?? '').trim().replace(/\r\n/g, '\n');
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const phoneRaw = String(form.get('phone') ?? '').trim();
  const phone = phoneRaw ? normalizeWhatsapp(phoneRaw) : null;
  const nbRaw = String(form.get('neighborhood_id') ?? '');
  const file = form.get('resume');
  const hasFile = file instanceof File && file.size > 0;

  if (fullName.length < 3 || fullName.length > 100) errors.full_name = 'Informe seu nome completo';
  if (role.length < 3 || role.length > 100) errors.desired_role = 'Informe a área ou o cargo que procura, ex.: Vendedor(a)';
  if (summary.length > 1500) errors.summary = 'Use até 1.500 caracteres';
  if (!z.string().email().max(160).safeParse(email).success) errors.email = 'Informe um e-mail válido';
  if (phoneRaw && !phone) errors.phone = 'Informe um celular com DDD, ex.: (67) 99999-1234';
  if (nbRaw && !/^\d+$/.test(nbRaw)) errors.neighborhood_id = 'Bairro inválido';
  if (!hasFile && !current) errors.resume = 'Anexe seu currículo em PDF';
  else if (hasFile && file.size > MAX_RESUME_BYTES) errors.resume = 'O currículo deve ter até 4 MB';
  if (form.get('consent') !== 'on') errors.consent = 'Para entrar no banco, autorize que empresas com vaga aberta vejam seu currículo';
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });

  let fileFields: Record<string, unknown> = {};
  let newPath: string | null = null;
  if (hasFile) {
    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    if (!looksLikePdf(bytes)) return NextResponse.json({ errors: { resume: 'O arquivo precisa ser um PDF' } }, { status: 415 });
    newPath = `${user.id}/banco-${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await supabase.storage.from('curriculos').upload(newPath, bytes, { contentType: 'application/pdf', upsert: false });
    if (upErr) return NextResponse.json({ error: 'Falha ao salvar o currículo. Tente de novo.' }, { status: 500 });
    fileFields = { resume_path: newPath, resume_filename: safeResumeName((file as File).name), resume_size: bytes.length };
  }

  const row = {
    full_name: fullName, desired_role: role, summary: summary || null, email, phone,
    neighborhood_id: nbRaw ? Number(nbRaw) : null, consent_at: new Date().toISOString(), visible: true, ...fileFields,
  };
  const { error } = current
    ? await supabase.from('talent_profiles').update(row).eq('user_id', user.id)
    : await supabase.from('talent_profiles').insert({ ...row, user_id: user.id });
  if (error) {
    if (newPath) await supabase.storage.from('curriculos').remove([newPath]);
    return NextResponse.json({ error: 'Não foi possível salvar. Tente de novo.' }, { status: 409 });
  }
  if (newPath && current?.resume_path) await supabase.storage.from('curriculos').remove([current.resume_path]);
  return NextResponse.json({ ok: true });
}

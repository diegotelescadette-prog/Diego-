import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { hitLimit } from '@/lib/rate-limit';
import { normalizeWhatsapp } from '@/lib/validation';
import { looksLikePdf, MAX_RESUME_BYTES, safeResumeName } from '@/lib/jobs';

/** Candidatura com currículo em PDF. O arquivo vai para o bucket PRIVADO "curriculos",
 *  na pasta do próprio candidato; o banco confere vaga aberta, dono do arquivo e limites. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Entre na sua conta para se candidatar' }, { status: 401 });
  if (!(await hitLimit('candidatura', user.id, 30, 3600))) {
    return NextResponse.json({ error: 'Muitos envios. Aguarde um pouco.' }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Envio inválido' }, { status: 400 });
  const errors: Record<string, string> = {};
  const jobId = z.string().uuid().safeParse(form.get('job_id'));
  if (!jobId.success) return NextResponse.json({ error: 'Vaga inválida' }, { status: 400 });
  const fullName = String(form.get('full_name') ?? '').trim().replace(/\s+/g, ' ');
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const phoneRaw = String(form.get('phone') ?? '').trim();
  const phone = phoneRaw ? normalizeWhatsapp(phoneRaw) : null;
  const message = String(form.get('message') ?? '').trim().replace(/\r\n/g, '\n');
  const file = form.get('resume');

  if (fullName.length < 3 || fullName.length > 100) errors.full_name = 'Informe seu nome completo';
  if (!z.string().email().max(160).safeParse(email).success) errors.email = 'Informe um e-mail válido';
  if (phoneRaw && !phone) errors.phone = 'Informe um celular com DDD, ex.: (67) 99999-1234';
  if (message.length > 1500) errors.message = 'Use até 1.500 caracteres';
  if (!(file instanceof File) || file.size === 0) errors.resume = 'Anexe seu currículo em PDF';
  else if (file.size > MAX_RESUME_BYTES) errors.resume = 'O currículo deve ter até 4 MB';
  if (form.get('consent') !== 'on') errors.consent = 'Para se candidatar, autorize o envio dos seus dados para quem publicou a vaga';
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });

  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  if (!looksLikePdf(bytes)) return NextResponse.json({ errors: { resume: 'O arquivo precisa ser um PDF' } }, { status: 415 });

  // Confere antes de gravar o arquivo (o banco confere de novo na inserção).
  const { data: job } = await supabase.from('jobs').select('id, poster_id, status, expires_at').eq('id', jobId.data).maybeSingle();
  if (!job || job.status !== 'aberta' || new Date(job.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'Esta vaga não está mais recebendo currículos' }, { status: 409 });
  }
  if (job.poster_id === user.id) return NextResponse.json({ error: 'Você não pode se candidatar à própria vaga' }, { status: 409 });
  const { data: existing } = await supabase.from('job_applications').select('id').eq('job_id', job.id).eq('applicant_id', user.id).maybeSingle();
  if (existing) return NextResponse.json({ error: 'Você já se candidatou a esta vaga' }, { status: 409 });

  const path = `${user.id}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await supabase.storage.from('curriculos').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (upErr) return NextResponse.json({ error: 'Falha ao salvar o currículo. Tente de novo.' }, { status: 500 });

  const { data: row, error } = await supabase.from('job_applications').insert({
    job_id: job.id, applicant_id: user.id, full_name: fullName, email, phone, message: message || null,
    resume_path: path, resume_filename: safeResumeName((file as File).name), resume_size: bytes.length,
    consent_at: new Date().toISOString(),
  }).select('id').single();
  if (error || !row) {
    await supabase.storage.from('curriculos').remove([path]);
    const msg = error?.code === '23505' ? 'Você já se candidatou a esta vaga'
      : error?.code === '54000' || error?.code === '23514' ? error.message : 'Não foi possível enviar a candidatura.';
    return NextResponse.json({ error: msg }, { status: 409 });
  }
  return NextResponse.json({ id: row.id });
}

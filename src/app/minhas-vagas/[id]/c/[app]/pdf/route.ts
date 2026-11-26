import { NextResponse } from 'next/server';
import { z } from 'zod';
import { APP_NAME } from '@/config/brand';
import type { ResumeSnapshot } from '@/lib/resume';
import { resumePdf } from '@/lib/resume-pdf';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** PDF do currículo enviado (só quem publicou a vaga, conferido pelas regras de acesso do banco). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; app: string }> }) {
  const { id, app } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(app).success) return new NextResponse('Não encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Entre na sua conta', { status: 401 });
  const { data: job } = await supabase.from('jobs').select('id').eq('id', id).eq('poster_id', user.id).maybeSingle();
  const { data: a } = job ? await supabase.from('job_applications').select('resume_snapshot, phone, email').eq('id', app).eq('job_id', id).maybeSingle() : { data: null };
  const snap = a?.resume_snapshot as ResumeSnapshot | null;
  if (!snap) return new NextResponse('Não encontrado', { status: 404 });
  let photo: Uint8Array | null = null;
  if (snap.photo_path) {
    const { data: blob } = await createAdminClient().storage.from('curriculos').download(snap.photo_path);
    if (blob) photo = new Uint8Array(await blob.arrayBuffer());
  }
  const pdf = await resumePdf({ ...snap, email: a!.email, phone: a!.phone, photo }, `Currículo recebido pelo ${APP_NAME}. Use só para esta seleção.`);
  return new NextResponse(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="curriculo.pdf"', 'Cache-Control': 'private, no-store' } });
}

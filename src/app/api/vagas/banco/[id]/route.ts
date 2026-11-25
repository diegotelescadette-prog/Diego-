import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hitLimit } from '@/lib/rate-limit';
import { safeResumeName } from '@/lib/jobs';

/** Download de um currículo do banco: o próprio dono ou quem tem vaga aberta (RLS decide se a linha é visível). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse('Não encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Entre na sua conta', { status: 401 });
  const { data: t } = await supabase.from('talent_profiles').select('user_id, resume_path, resume_filename').eq('user_id', id).maybeSingle();
  if (!t) return new NextResponse('Não encontrado', { status: 404 });
  // Contra coleta em massa: até 60 downloads por dia de currículos de outras pessoas.
  if (t.user_id !== user.id && !(await hitLimit('download-banco', user.id, 60, 86400))) {
    return new NextResponse('Limite diário de downloads atingido', { status: 429 });
  }
  const { data: blob, error } = await createAdminClient().storage.from('curriculos').download(t.resume_path);
  if (error || !blob) return new NextResponse('Arquivo indisponível', { status: 404 });
  return new NextResponse(blob, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="curriculo.pdf"; filename*=UTF-8''${encodeURIComponent(safeResumeName(t.resume_filename))}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

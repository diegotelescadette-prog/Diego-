import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeResumeName } from '@/lib/jobs';

/** Download do currículo. Só o candidato e quem publicou a vaga: a linha da candidatura
 *  só é visível para eles (RLS). Ao baixar, quem publicou marca a candidatura como "vista". */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse('Não encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Entre na sua conta', { status: 401 });

  const { data: app } = await supabase.from('job_applications')
    .select('id, applicant_id, status, resume_path, resume_filename, full_name, jobs!inner(poster_id)').eq('id', id).maybeSingle();
  if (!app) return new NextResponse('Não encontrado', { status: 404 });
  const posterId = (app.jobs as unknown as { poster_id: string }).poster_id;
  if (app.applicant_id !== user.id && posterId !== user.id) return new NextResponse('Não encontrado', { status: 404 });

  const { data: blob, error } = await createAdminClient().storage.from('curriculos').download(app.resume_path);
  if (error || !blob) return new NextResponse('Arquivo indisponível', { status: 404 });
  if (posterId === user.id && app.status === 'recebida') {
    await supabase.rpc('set_application_status', { p_application: app.id, p_status: 'vista' });
  }
  const name = safeResumeName(app.resume_filename);
  return new NextResponse(blob, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="curriculo.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

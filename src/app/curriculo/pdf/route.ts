import { NextResponse } from 'next/server';
import { APP_NAME } from '@/config/brand';
import { getNeighborhoods, getUser } from '@/lib/data';
import { getMyResume } from '@/lib/resume-data';
import { resumePdf } from '@/lib/resume-pdf';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Baixa o próprio currículo em PDF. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/entrar?next=%2Fcurriculo', req.url));
  const { data, exists } = await getMyResume(user.id, user.email);
  if (!exists) return NextResponse.redirect(new URL('/curriculo', req.url));
  const nb = data.neighborhood_id ? (await getNeighborhoods()).find((n) => n.id === data.neighborhood_id)?.name : null;
  let photo: Uint8Array | null = null;
  if (data.photo_path) {
    const { data: blob } = await createAdminClient().storage.from('curriculos').download(data.photo_path);
    if (blob) photo = new Uint8Array(await blob.arrayBuffer());
  }
  const pdf = await resumePdf({ ...data, neighborhood: nb ? `${nb}, Campo Grande–MS` : 'Campo Grande–MS', references: data.references_list, photo },
    `Currículo gerado pelo ${APP_NAME}`);
  const name = data.full_name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'curriculo';
  return new NextResponse(Buffer.from(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="curriculo-${name}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}

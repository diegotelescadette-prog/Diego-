import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createClient } from '@/lib/supabase/server';
import { hitLimit } from '@/lib/rate-limit';
import { photoUrl } from '@/lib/data';

const MAX_INPUT = 8 * 1024 * 1024;
const ALLOWED = new Set(['jpeg', 'png', 'webp']);
const MAX_WORK_PHOTOS = 6;

/** Recebe a imagem, confere o formato real, reprocessa para WebP (remove EXIF/GPS)
 *  e grava na pasta do próprio usuário (política de storage). */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Entre para enviar fotos' }, { status: 401 });
  if (!(await hitLimit('upload', user.id, 30, 3600))) {
    return NextResponse.json({ error: 'Muitos envios. Aguarde um pouco.' }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const k = form?.get('kind');
  const kind = k === 'work' ? 'work' : k === 'post' ? 'post' : 'profile';
  if (!(file instanceof File)) return NextResponse.json({ error: 'Selecione uma imagem' }, { status: 400 });
  if (file.size > MAX_INPUT) return NextResponse.json({ error: 'A imagem deve ter até 8 MB' }, { status: 413 });

  // Fotos da comunidade: qualquer conta (pedidos de indicação também levam fotos). A publicação valida o tipo e a autoria.
  const { data: profile } = await supabase.from('provider_profiles').select('id, photo_path, status').eq('id', user.id).maybeSingle();
  if (!profile && kind !== 'post') return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 });
  if (kind === 'work') {
    const { count } = await supabase.from('provider_work_photos').select('id', { count: 'exact', head: true }).eq('provider_id', user.id);
    if ((count ?? 0) >= MAX_WORK_PHOTOS) return NextResponse.json({ error: `Limite de ${MAX_WORK_PHOTOS} fotos de trabalhos` }, { status: 400 });
  }

  let out: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(input).metadata();
    if (!meta.format || !ALLOWED.has(meta.format)) {
      return NextResponse.json({ error: 'Envie uma imagem JPG, PNG ou WebP' }, { status: 415 });
    }
    if ((meta.width ?? 0) * (meta.height ?? 0) > 50_000_000) {
      return NextResponse.json({ error: 'Imagem com resolução muito alta' }, { status: 413 });
    }
    const size = kind === 'profile' ? 600 : kind === 'post' ? 1600 : 1400;
    // .rotate() aplica a orientação; sem .withMetadata() o sharp descarta EXIF (inclui GPS).
    out = await sharp(input).rotate().resize({ width: size, height: size, fit: kind === 'profile' ? 'cover' : 'inside', withoutEnlargement: kind !== 'profile' })
      .webp({ quality: 80 }).toBuffer();
  } catch {
    return NextResponse.json({ error: 'Arquivo de imagem inválido' }, { status: 415 });
  }

  const path = `${user.id}/${kind}-${crypto.randomUUID()}.webp`;
  const bucket = kind === 'post' ? 'post-media' : 'profile-photos';
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, out, { contentType: 'image/webp', upsert: false });
  if (upErr) return NextResponse.json({ error: 'Falha ao salvar a imagem' }, { status: 500 });
  // Foto de publicação: só o arquivo; a publicação é criada depois, com todas as mídias.
  if (kind === 'post') return NextResponse.json({ path });

  if (kind === 'profile' && profile) {
    await supabase.from('provider_profiles').update({ photo_path: path }).eq('id', user.id);
    if (profile.photo_path) await supabase.storage.from('profile-photos').remove([profile.photo_path]);
    return NextResponse.json({ path, url: photoUrl(path) });
  }
  const { data: row } = await supabase.from('provider_work_photos').insert({ provider_id: user.id, path }).select('id').single();
  return NextResponse.json({ id: row?.id, path, url: photoUrl(path) });
}

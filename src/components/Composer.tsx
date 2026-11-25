'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createPost } from '@/app/publicacoes/actions';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { POST_LIMITS, VIDEO_TYPES } from '@/lib/posts-shared';

type Picked = { kind: 'foto' | 'video'; file: File; preview: string };

/** Reduz a foto no navegador antes de enviar (a rota ainda reprocessa e tira EXIF/GPS no servidor). */
async function shrink(file: File): Promise<Blob> {
  if (file.size < 2.5 * 1024 * 1024) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b ?? file), 'image/jpeg', 0.86));
}

function videoSeconds(file: File): Promise<number> {
  return new Promise((ok) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { ok(v.duration); URL.revokeObjectURL(v.src); };
    v.onerror = () => ok(0);
    v.src = URL.createObjectURL(file);
  });
}

/** Caixa para o prestador publicar um trabalho: texto + até 6 fotos OU 1 vídeo curto. */
export function Composer({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [items, setItems] = useState<Picked[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const hasVideo = items.some((i) => i.kind === 'video');

  async function addPhotos(files: FileList | null) {
    setErr(null);
    if (!files?.length) return;
    if (hasVideo) { setErr('Use um vídeo OU até 6 fotos. Tire o vídeo para adicionar fotos.'); return; }
    const list = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (list.length < files.length) setErr('Envie fotos JPG, PNG ou WebP.');
    const room = POST_LIMITS.photos - items.length;
    if (list.length > room) setErr(`Até ${POST_LIMITS.photos} fotos por publicação.`);
    setItems([...items, ...list.slice(0, room).map((f) => ({ kind: 'foto' as const, file: f, preview: URL.createObjectURL(f) }))]);
  }

  async function addVideo(files: FileList | null) {
    setErr(null);
    const f = files?.[0];
    if (!f) return;
    if (items.length) { setErr('Use um vídeo OU até 6 fotos. Tire as fotos para adicionar um vídeo.'); return; }
    if (!(VIDEO_TYPES as readonly string[]).includes(f.type)) { setErr('Envie o vídeo em MP4, MOV ou WebM.'); return; }
    if (f.size > POST_LIMITS.videoMB * 1024 * 1024) { setErr(`O vídeo deve ter até ${POST_LIMITS.videoMB} MB.`); return; }
    const secs = await videoSeconds(f);
    if (secs > POST_LIMITS.videoSeconds + 0.5) { setErr(`O vídeo deve ter até ${POST_LIMITS.videoSeconds} segundos.`); return; }
    setItems([{ kind: 'video', file: f, preview: URL.createObjectURL(f) }]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!body.trim() && !items.length) { setErr('Escreva algo ou adicione fotos ou um vídeo.'); return; }
    const media: { kind: 'foto' | 'video'; path: string }[] = [];
    try {
      for (const [i, it] of items.entries()) {
        if (it.kind === 'foto') {
          setStep(`Enviando foto ${i + 1} de ${items.length}…`);
          const fd = new FormData();
          fd.append('file', new File([await shrink(it.file)], it.file.name, { type: it.file.type }));
          fd.append('kind', 'post');
          const res = await fetch('/api/upload', { method: 'POST', body: fd });
          const out = await res.json().catch(() => ({}));
          if (!res.ok || !out.path) throw new Error(out.error ?? 'Falha ao enviar a foto.');
          media.push({ kind: 'foto', path: out.path });
        } else {
          setStep('Enviando o vídeo… pode levar um minuto.');
          const ext = it.file.type === 'video/quicktime' ? 'mov' : it.file.type === 'video/webm' ? 'webm' : 'mp4';
          const path = `${userId}/video-${crypto.randomUUID()}.${ext}`;
          const { error } = await createBrowserSupabase().storage.from('post-media').upload(path, await it.file.arrayBuffer(), { contentType: it.file.type, upsert: false });
          if (error) throw new Error('Falha ao enviar o vídeo. Confira a conexão e tente de novo.');
          media.push({ kind: 'video', path });
        }
      }
      setStep('Publicando…');
      const r = await createPost({ body, media });
      if (!r.ok) throw new Error(r.message ?? 'Não foi possível publicar.');
      items.forEach((i) => URL.revokeObjectURL(i.preview));
      setBody(''); setItems([]); setDone(true);
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Não foi possível publicar.');
    } finally {
      setStep(null);
    }
  }

  return (
    <form onSubmit={submit} className="post space-y-3 p-4" aria-label="Nova publicação">
      {done && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900">Publicado! Seu trabalho já aparece no início.</p>}
      <label htmlFor="post-body" className="label">O que você fez, {name.split(' ')[0]}?</label>
      <textarea id="post-body" rows={4} maxLength={POST_LIMITS.body} className="input" value={body} onChange={(e) => { setBody(e.target.value); setDone(false); }}
        placeholder="Ex.: Troquei toda a fiação da cozinha hoje no Tiradentes. Atendo ainda esta semana!" />
      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" aria-label="Arquivos escolhidos">
          {items.map((it, i) => (
            <li key={it.preview} className="relative overflow-hidden rounded-xl bg-stone-100">
              {it.kind === 'foto'
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={it.preview} alt={`Foto ${i + 1}`} className="aspect-square w-full object-cover" />
                // eslint-disable-next-line jsx-a11y/media-has-caption
                : <video src={it.preview} className="aspect-square w-full object-cover" muted />}
              <button type="button" className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"
                aria-label={`Tirar ${it.kind === 'foto' ? `foto ${i + 1}` : 'vídeo'}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-outline min-h-11 px-3 text-sm" onClick={() => photoInput.current?.click()} disabled={hasVideo || items.length >= POST_LIMITS.photos}>📷 Fotos</button>
        <button type="button" className="btn-outline min-h-11 px-3 text-sm" onClick={() => videoInput.current?.click()} disabled={items.length > 0}>🎬 Vídeo</button>
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-testid="post-photos" onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
        <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" hidden data-testid="post-video" onChange={(e) => { addVideo(e.target.files); e.target.value = ''; }} />
        <button type="submit" className="btn-hoje ml-auto min-h-11 px-5" disabled={!!step}>{step ? 'Publicando…' : 'Publicar'}</button>
      </div>
      <p className="hint">Até {POST_LIMITS.photos} fotos ou 1 vídeo de até {POST_LIMITS.videoSeconds} segundos ({POST_LIMITS.videoMB} MB). Não mostre rosto, placa ou endereço de clientes sem permissão.</p>
      {step && <p role="status" className="text-sm font-semibold text-brand-700">{step}</p>}
      {err && <p role="alert" className="field-error">{err}</p>}
    </form>
  );
}

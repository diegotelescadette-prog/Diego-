'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createStory } from '@/app/momentos/actions';
import { discardUpload } from '@/app/comunidade/actions';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { STORY_LIMITS } from '@/lib/stories-shared';
import { VIDEO_TYPES } from '@/lib/posts-shared';

type Picked = { kind: 'foto' | 'video'; file: File; preview: string };

function videoSeconds(file: File): Promise<number> {
  return new Promise((ok) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { ok(v.duration); URL.revokeObjectURL(v.src); };
    v.onerror = () => ok(0);
    v.src = URL.createObjectURL(file);
  });
}

/** Escolhe uma foto ou um vídeo, escreve uma legenda curta e publica. */
export function StoryComposer({ userId, publicName }: { userId: string; publicName: string | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.preview); }, [picked]);

  async function choose(files: FileList | null, kind: 'foto' | 'video') {
    setErr(null);
    const file = files?.[0];
    if (!file) return;
    if (kind === 'foto') {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setErr('Envie uma foto JPG, PNG ou WebP.');
      if (file.size > STORY_LIMITS.photoMB * 1024 * 1024) return setErr(`A foto deve ter até ${STORY_LIMITS.photoMB} MB.`);
    } else {
      if (!(VIDEO_TYPES as readonly string[]).includes(file.type)) return setErr('Envie um vídeo MP4, MOV ou WebM.');
      if (file.size > STORY_LIMITS.videoMB * 1024 * 1024) return setErr(`O vídeo deve ter até ${STORY_LIMITS.videoMB} MB.`);
      const s = await videoSeconds(file);
      if (s > STORY_LIMITS.videoSeconds + 0.5) return setErr(`O vídeo deve ter até ${STORY_LIMITS.videoSeconds} segundos.`);
    }
    setPicked({ kind, file, preview: URL.createObjectURL(file) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!picked) return setErr('Escolha uma foto ou um vídeo.');
    if (!publicName && name.trim().length < 2) return setErr('Informe seu nome público.');
    let path: string | null = null;
    try {
      setBusy(picked.kind === 'foto' ? 'Enviando a foto…' : 'Enviando o vídeo…');
      if (picked.kind === 'foto') {
        const fd = new FormData();
        fd.set('file', picked.file);
        fd.set('kind', 'post');
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.path) throw new Error(j.error ?? 'Falha ao enviar a foto.');
        path = j.path;
      } else {
        const ext = picked.file.type === 'video/quicktime' ? 'mov' : picked.file.type === 'video/webm' ? 'webm' : 'mp4';
        path = `${userId}/momento-${crypto.randomUUID()}.${ext}`;
        const { error } = await createBrowserSupabase().storage.from('post-media')
          .upload(path, await picked.file.arrayBuffer(), { contentType: picked.file.type, upsert: false });
        if (error) throw new Error('Falha ao enviar o vídeo. Confira a conexão e tente de novo.');
      }
      setBusy('Publicando…');
      const r = await createStory({ kind: picked.kind, path: path!, caption, ...(publicName ? {} : { publicName: name }) });
      if (!r.ok) { await discardUpload(path!); throw new Error(r.message ?? 'Não foi possível publicar.'); }
      router.push(`/momentos/${userId}`);
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Não foi possível publicar.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="post space-y-4 p-4" aria-label="Publicar momento">
      {picked ? (
        <div className="story-preview">
          {picked.kind === 'foto'
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={picked.preview} alt="Foto escolhida" />
            // eslint-disable-next-line jsx-a11y/media-has-caption
            : <video src={picked.preview} controls playsInline aria-label="Vídeo escolhido" />}
          <button type="button" className="btn-outline mt-2 min-h-11 w-full" onClick={() => setPicked(null)} disabled={!!busy}>Trocar</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-outline min-h-14" onClick={() => photoInput.current?.click()}>Escolher foto</button>
          <button type="button" className="btn-outline min-h-14" onClick={() => videoInput.current?.click()}>Escolher vídeo</button>
        </div>
      )}
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="story-photo"
        onChange={(e) => { void choose(e.target.files, 'foto'); e.target.value = ''; }} />
      <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" hidden data-testid="story-video"
        onChange={(e) => { void choose(e.target.files, 'video'); e.target.value = ''; }} />
      <p className="hint">Foto até {STORY_LIMITS.photoMB} MB ou vídeo de até {STORY_LIMITS.videoSeconds} segundos.</p>

      <div>
        <label htmlFor="s-caption" className="label">Legenda (opcional)</label>
        <input id="s-caption" className="input" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={STORY_LIMITS.caption}
          placeholder="Ex.: Café antes de começar a obra" />
      </div>
      {!publicName && (
        <div>
          <label htmlFor="s-name" className="label">Seu nome público</label>
          <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} autoComplete="given-name" />
          <p className="hint">Aparece no momento e nos seus comentários. Seu e-mail nunca aparece.</p>
        </div>
      )}
      <p className="rounded-xl bg-paper p-3 text-sm text-stone-700">
        Qualquer pessoa da comunidade vê seus momentos. Não mostre telefone, endereço completo nem documentos.
      </p>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <button type="submit" className="btn-primary min-h-12 w-full" disabled={!!busy || !picked}>{busy ?? 'Publicar momento'}</button>
    </form>
  );
}

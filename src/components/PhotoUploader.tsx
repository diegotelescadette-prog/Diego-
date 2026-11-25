'use client';
import { useRef, useState } from 'react';
import { deleteWorkPhoto } from '@/app/painel/actions';

async function send(file: File, kind: 'profile' | 'work') {
  const fd = new FormData();
  fd.set('file', file);
  fd.set('kind', kind);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Falha no envio');
  return body as { id?: number; url: string; path: string };
}

export function ProfilePhotoUploader({ initialUrl, error }: { initialUrl: string | null; error?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="label" id="photo-label">Foto de perfil</p>
      <div className="flex items-center gap-4">
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt="Sua foto de perfil" className="h-24 w-24 rounded-2xl object-cover" />
          : <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-stone-200 text-sm text-stone-600">Sem foto</span>}
        <div>
          <input ref={ref} id="photo" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-labelledby="photo-label"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true); setMsg(null);
              try { const r = await send(f, 'profile'); setUrl(r.url); setMsg('Foto atualizada.'); }
              catch (err) { setMsg((err as Error).message); }
              finally { setBusy(false); e.target.value = ''; }
            }} />
          <button type="button" className="btn-outline" onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? 'Enviando…' : url ? 'Trocar foto' : 'Enviar foto'}
          </button>
          <p className="hint">JPG, PNG ou WebP até 8 MB. Uma foto do rosto ajuda o cliente a reconhecer você.</p>
        </div>
      </div>
      <p aria-live="polite" className="text-sm">{msg}</p>
      {error && !url && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function WorkPhotosUploader({ initial }: { initial: { id: number; url: string }[] }) {
  const [photos, setPhotos] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="label" id="work-label">Fotos de trabalhos <span className="font-normal text-stone-500">(opcional, até 6)</span></p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {photos.map((p) => (
          <li key={p.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="Foto de trabalho" className="aspect-square w-full rounded-xl object-cover" />
            <form action={async (fd) => { await deleteWorkPhoto(fd); setPhotos((ph) => ph.filter((x) => x.id !== p.id)); }}>
              <input type="hidden" name="id" value={p.id} />
              <button className="mt-1 w-full rounded-lg bg-stone-100 py-1 text-sm hover:bg-red-50" type="submit">Remover</button>
            </form>
          </li>
        ))}
      </ul>
      {photos.length < 6 && (
        <>
          <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-labelledby="work-label"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true); setMsg(null);
              try { const r = await send(f, 'work'); setPhotos((ph) => [...ph, { id: r.id!, url: r.url }]); }
              catch (err) { setMsg((err as Error).message); }
              finally { setBusy(false); e.target.value = ''; }
            }} />
          <button type="button" className="btn-ghost mt-2" onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? 'Enviando…' : '+ Adicionar foto de trabalho'}
          </button>
        </>
      )}
      <p className="hint">Removemos automaticamente a localização (GPS) e outros dados das fotos.</p>
      <p aria-live="polite" className="text-sm">{msg}</p>
    </div>
  );
}

'use client';
import { useActionState } from 'react';
import { removeResumePhoto, uploadResumePhoto, type ResumeState } from './actions';

export function PhotoForm({ url, name }: { url: string | null; name: string }) {
  const [state, action, pending] = useActionState<ResumeState, FormData>(uploadResumePhoto, {});
  return (
    <div className="flex flex-wrap items-center gap-4">
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={`Foto de ${name}`} className="h-20 w-20 rounded-2xl object-cover" />
        : <span className="grid h-20 w-20 place-items-center rounded-2xl bg-hoje-100 text-2xl font-bold text-hoje-700" aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</span>}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="photo" className="label">Foto (opcional)</label>
          <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="input py-2" />
          {state.errors?.photo && <p className="field-error" role="alert">{state.errors.photo}</p>}
          {state.message && <p className={state.ok ? 'hint' : 'field-error'} role="status">{state.message}</p>}
        </div>
        <button type="submit" className="btn-outline" disabled={pending}>{pending ? 'Enviando…' : 'Enviar foto'}</button>
      </form>
      {url && <form action={removeResumePhoto}><button type="submit" className="btn-ghost min-h-11 px-3 text-sm">Tirar foto</button></form>}
    </div>
  );
}

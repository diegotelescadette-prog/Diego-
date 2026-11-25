'use client';
import { useActionState, useEffect, useState } from 'react';
import { createReport } from '@/app/p/actions';
import { SubmitButton } from './SubmitButton';

export function GeneralContactButton({ providerId, defaultMessage }: { providerId: string; defaultMessage: string }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(defaultMessage);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/contact/general', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId, message: msg }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) { window.location.assign(body.url); return; }
      setErr(res.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : res.status === 404 ? 'Este perfil não está mais disponível.' : 'Não foi possível abrir o WhatsApp.');
    } catch { setErr('Sem conexão. Tente novamente.'); } finally { setBusy(false); }
  }

  if (!open) return <button type="button" className="btn-zap" disabled={!ready} onClick={() => setOpen(true)}>Chamar no WhatsApp</button>;
  return (
    <div className="w-full rounded-2xl border border-zap-600/40 bg-green-50 p-4" role="group" aria-label="Mensagem para o WhatsApp">
      <label htmlFor="wa-msg" className="label">Mensagem (você pode editar antes de enviar)</label>
      <textarea id="wa-msg" rows={4} maxLength={600} className="input" value={msg} onChange={(e) => setMsg(e.target.value)} />
      <p className="hint">O WhatsApp abre com o texto pronto. Você decide se envia.</p>
      {err && <p role="alert" className="field-error">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-zap flex-1" onClick={go} disabled={busy || msg.trim().length < 5}>{busy ? 'Abrindo…' : 'Abrir WhatsApp'}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}

export function UrgentContactButton({ providerId, serviceId, neighborhoodId, cityId, backHref }: {
  providerId: string; serviceId: number; neighborhoodId: number | null; cityId: number | null; backHref: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'changed' | 'error'>('idle');
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function go() {
    setState('busy');
    const res = await fetch('/api/contact/urgent', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId, serviceId, neighborhoodId, cityId }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (res?.ok && body?.url) { window.location.assign(body.url); return; }
    setState(res?.status === 409 ? 'changed' : 'error');
  }
  if (state === 'changed') {
    return (
      <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
        A disponibilidade deste profissional mudou. <a className="font-semibold underline" href={backHref}>Ver quem atende hoje</a>
      </p>
    );
  }
  return (
    <>
      <button type="button" className="btn-zap" onClick={go} disabled={!ready || state === 'busy'}>{state === 'busy' ? 'Abrindo…' : 'Chamar no WhatsApp'}</button>
      {state === 'error' && <p role="alert" className="field-error">Não foi possível abrir o WhatsApp.</p>}
    </>
  );
}

export function ReportForm({ providerId }: { providerId: string }) {
  const [state, action] = useActionState(createReport, undefined);
  if (state?.ok) return <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900">{state.message}</p>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="provider_id" value={providerId} />
      {state?.message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{state.message}</p>}
      <div>
        <label htmlFor="reason" className="label">Motivo</label>
        <select id="reason" name="reason" className="input" defaultValue="" aria-invalid={!!state?.errors?.reason}>
          <option value="" disabled>Escolha</option>
          <option value="informacoes_falsas">Informações falsas</option>
          <option value="golpe_ou_cobranca">Golpe ou cobrança indevida</option>
          <option value="comportamento_inadequado">Comportamento inadequado</option>
          <option value="conteudo_improprio">Foto ou texto impróprio</option>
          <option value="outro">Outro</option>
        </select>
        {state?.errors?.reason && <p className="field-error">{state.errors.reason}</p>}
      </div>
      <div>
        <label htmlFor="details" className="label">Detalhes <span className="font-normal text-stone-500">(opcional)</span></label>
        <textarea id="details" name="details" rows={3} maxLength={1000} className="input" />
        {state?.errors?.details && <p className="field-error">{state.errors.details}</p>}
      </div>
      <SubmitButton className="btn-danger">Enviar denúncia</SubmitButton>
    </form>
  );
}

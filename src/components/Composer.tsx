'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPost, discardUpload, updatePost } from '@/app/comunidade/actions';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { POST_KINDS, POST_LIMITS, VIDEO_TYPES, type MediaLabel, type PostKind } from '@/lib/posts-shared';

type Item = { key: string; kind: 'foto' | 'video'; preview: string; file?: File; path?: string; label: MediaLabel; existing?: boolean };
export interface ComposerCatalog { id: number; name: string; slug: string; services: { id: number; name: string }[] }
export interface ComposerProps {
  userId: string;
  canPostAsProvider: boolean; hasProfile: boolean;
  services: { id: number; name: string }[]; mainServiceId: number | null;
  publicName: string | null; firstPost: boolean;
  catalog: ComposerCatalog[]; neighborhoods: { id: number; name: string }[];
  initialKind?: PostKind | null; initialCategory?: string | null;
  /** Pedidos concluídos pelo app que ainda não viraram publicação ("Feito pelo Próximo"). */
  bookings?: { id: string; serviceId: number; label: string }[]; initialBooking?: string | null;
  edit?: { id: string; kind: PostKind; body: string; serviceId: number | null; categoryId: number | null; neighborhoodId: number | null; price: string | null;
    media: { kind: 'foto' | 'video'; path: string; url: string; label: MediaLabel }[] };
}

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

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));

/** Criar ou editar publicação: Mostrar um trabalho, Divulgar meu serviço ou Pedir uma indicação. */
export function Composer(props: ComposerProps) {
  const { userId, canPostAsProvider, hasProfile, services, catalog, neighborhoods, edit } = props;
  const router = useRouter();
  const startCategory = catalog.find((c) => c.slug === props.initialCategory) ?? null;
  const suggestedService = startCategory ? services.find((s) => startCategory.services.some((x) => x.id === s.id))?.id ?? null : null;
  const [kind, setKind] = useState<PostKind | null>(edit?.kind ?? props.initialKind ?? null);
  const [body, setBody] = useState(edit?.body ?? '');
  const [serviceId, setServiceId] = useState<number | null>(edit?.serviceId ?? props.bookings?.find((b) => b.id === props.initialBooking)?.serviceId ?? suggestedService ?? props.mainServiceId ?? services[0]?.id ?? null);
  const [reqCategory, setReqCategory] = useState<number | null>(edit?.categoryId ?? startCategory?.id ?? null);
  const [reqService, setReqService] = useState<number | null>(edit?.kind === 'pedido' ? edit.serviceId : null);
  const bookings = edit ? [] : props.bookings ?? [];
  const startBooking = bookings.find((b) => b.id === props.initialBooking) ?? null;
  const [booking, setBooking] = useState<string | null>(startBooking?.id ?? null);
  const [hood, setHood] = useState<number | null>(edit?.neighborhoodId ?? null);
  const [price, setPrice] = useState(edit?.price ?? '');
  const [name, setName] = useState('');
  const [items, setItems] = useState<Item[]>(edit?.media.map((m) => ({ key: m.path, kind: m.kind, preview: m.url, path: m.path, label: m.label, existing: true })) ?? []);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const token = useRef(newKey());
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const hasVideo = items.some((i) => i.kind === 'video');
  const providerKind = kind === 'trabalho' || kind === 'divulgacao';
  const blocked = providerKind && !canPostAsProvider && !edit;

  useEffect(() => () => { items.forEach((i) => { if (i.file) URL.revokeObjectURL(i.preview); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addPhotos(files: FileList | null) {
    setErr(null);
    if (!files?.length) return;
    if (hasVideo) { setErr('Use um vídeo OU até 6 fotos. Tire o vídeo para adicionar fotos.'); return; }
    const list = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (list.length < files.length) setErr('Envie fotos JPG, PNG ou WebP.');
    const big = list.filter((f) => f.size > POST_LIMITS.photoMB * 1024 * 1024);
    if (big.length) setErr(`Cada foto deve ter até ${POST_LIMITS.photoMB} MB.`);
    const ok = list.filter((f) => !big.includes(f));
    const room = POST_LIMITS.photos - items.length;
    if (ok.length > room) setErr(`Até ${POST_LIMITS.photos} fotos por publicação.`);
    setItems([...items, ...ok.slice(0, room).map((f) => ({ key: newKey(), kind: 'foto' as const, file: f, preview: URL.createObjectURL(f), label: null }))]);
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
    setItems([{ key: newKey(), kind: 'video', file: f, preview: URL.createObjectURL(f), label: null }]);
  }

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  }
  function remove(i: number) {
    const it = items[i];
    if (it.path && !it.existing) void discardUpload(it.path);
    if (it.file) URL.revokeObjectURL(it.preview);
    setItems(items.filter((_, j) => j !== i));
  }
  function setLabel(i: number, label: MediaLabel) {
    setItems(items.map((it, j) => (j === i ? { ...it, label } : it)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!kind) return;
    if (kind === 'trabalho' && !items.length) { setErr('Adicione de 1 a 6 fotos do trabalho (ou um vídeo).'); return; }
    if (kind !== 'trabalho' && body.trim().length < 10) { setErr(kind === 'pedido' ? 'Descreva o que você precisa (pelo menos 10 letras).' : 'Escreva o texto da divulgação (pelo menos 10 letras).'); return; }
    if (kind === 'pedido' && !reqCategory && !reqService) { setErr('Escolha a categoria do serviço.'); return; }
    if (kind === 'pedido' && !props.publicName && name.trim().length < 2) { setErr('Informe seu nome público.'); return; }
    // Envia só o que ainda não subiu: repetir depois de uma falha reaproveita os arquivos já enviados.
    const working = [...items];
    try {
      for (const [i, it] of working.entries()) {
        if (it.path) continue;
        if (it.kind === 'foto') {
          setStep(`Enviando foto ${i + 1} de ${working.length}…`);
          const fd = new FormData();
          fd.append('file', new File([await shrink(it.file!)], it.file!.name, { type: it.file!.type }));
          fd.append('kind', 'post');
          const res = await fetch('/api/upload', { method: 'POST', body: fd });
          const out = await res.json().catch(() => ({}));
          if (!res.ok || !out.path) throw new Error(out.error ?? 'Falha ao enviar a foto.');
          working[i] = { ...it, path: out.path };
        } else {
          setStep('Enviando o vídeo… pode levar um minuto.');
          const ext = it.file!.type === 'video/quicktime' ? 'mov' : it.file!.type === 'video/webm' ? 'webm' : 'mp4';
          const path = `${userId}/video-${newKey()}.${ext}`;
          const { error } = await createBrowserSupabase().storage.from('post-media').upload(path, await it.file!.arrayBuffer(), { contentType: it.file!.type, upsert: false });
          if (error) throw new Error('Falha ao enviar o vídeo. Confira a conexão e tente de novo.');
          working[i] = { ...it, path };
        }
        setItems([...working]);
      }
      setStep(edit ? 'Salvando…' : 'Publicando…');
      const input = {
        kind, body,
        serviceId: kind === 'pedido' ? reqService : serviceId,
        categoryId: kind === 'pedido' ? reqCategory : null,
        neighborhoodId: hood, price: kind === 'divulgacao' ? price : null,
        media: working.map((m) => ({ kind: m.kind, path: m.path!, label: m.kind === 'foto' ? m.label : null })),
        ...(kind === 'pedido' && !props.publicName ? { publicName: name } : {}),
        ...(kind === 'trabalho' && booking && !edit ? { bookingId: booking } : {}),
      };
      const r = edit ? await updatePost(edit.id, input) : await createPost({ ...input, token: token.current });
      if (!r.ok || !r.id) throw new Error(r.message ?? 'Não foi possível publicar.');
      token.current = newKey();
      router.push(`/comunidade/${r.id}${edit ? '' : '?nova=1'}`);
      router.refresh();
    } catch (x) {
      setErr(`${x instanceof Error ? x.message : 'Não foi possível publicar.'} O que você escreveu continua aqui: toque em ${edit ? 'Salvar' : 'Publicar'} para tentar de novo.`);
    } finally {
      setStep(null);
    }
  }

  if (!kind) {
    return (
      <div className="post space-y-3 p-4" data-testid="composer-kinds">
        <h2 className="text-lg font-bold">O que você quer compartilhar?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {POST_KINDS.map((k) => (
            <button key={k.key} type="button" className="kind-opt" onClick={() => setKind(k.key)}>
              <span className="block font-bold">{k.cta}</span>
              <span className="block text-sm text-stone-600">{k.hint}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const meta = POST_KINDS.find((k) => k.key === kind)!;
  const reqServices = catalog.find((c) => c.id === reqCategory)?.services ?? [];

  return (
    <form onSubmit={submit} className="post space-y-4 p-4" aria-label={edit ? 'Editar publicação' : meta.cta}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{edit ? `Editar: ${meta.label.toLowerCase()}` : meta.cta}</h2>
        {!edit && <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => { setKind(null); setErr(null); }}>Trocar tipo</button>}
      </div>

      {blocked ? (
        <div className="rounded-xl bg-brand-50 p-4 text-brand-900">
          <p>{hasProfile
            ? 'Para mostrar trabalhos e divulgar serviços, seu perfil de prestador precisa estar publicado e com a área de atendimento confirmada.'
            : 'Mostrar trabalhos e divulgar serviços é para prestadores. Crie seu perfil grátis em duas etapas.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={hasProfile ? '/painel' : '/sou-prestador'} className="btn-primary min-h-11 px-4">{hasProfile ? 'Ir para o painel' : 'Criar meu perfil de prestador'}</Link>
            <button type="button" className="btn-outline min-h-11 px-4" onClick={() => setKind('pedido')}>Pedir uma indicação</button>
          </div>
        </div>
      ) : (
        <>
          {props.firstPost && !edit && (
            <p className="rounded-xl bg-hoje-100 p-3 text-sm text-stone-900" data-testid="first-post-notice">
              <strong>Sua primeira publicação.</strong> Seu nome público, o texto e as fotos ficam visíveis para qualquer visitante.
              Não coloque telefone, e-mail ou endereço completo: informe só o bairro ou a cidade. Use fotos que você tem permissão para divulgar.
            </p>
          )}

          {kind === 'trabalho' && bookings.length > 0 && (
            <div className="rounded-2xl border border-line bg-white p-3" data-testid="proof-picker">
              <label htmlFor="p-booking" className="label">Foi um pedido feito pelo Próximo?</label>
              <select id="p-booking" className="input" value={booking ?? ''}
                onChange={(e) => {
                  const b = bookings.find((x) => x.id === e.target.value) ?? null;
                  setBooking(b?.id ?? null);
                  if (b) setServiceId(b.serviceId);
                }}>
                <option value="">Não, foi um trabalho por fora</option>
                {bookings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
              <p className="mt-1 text-sm text-stone-600">
                Ligado ao pedido, o post ganha o selo <strong>Feito pelo Próximo</strong> com a nota que o cliente deu. O nome e o endereço do cliente não aparecem.
              </p>
            </div>
          )}

          {providerKind && (
            <div>
              <label htmlFor="p-service" className="label">Serviço</label>
              <select id="p-service" className="input" value={serviceId ?? ''} onChange={(e) => setServiceId(Number(e.target.value) || null)} required disabled={!!booking && kind === 'trabalho'}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {kind === 'pedido' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="p-cat" className="label">Categoria</label>
                <select id="p-cat" className="input" value={reqCategory ?? ''} onChange={(e) => { setReqCategory(Number(e.target.value) || null); setReqService(null); }} required>
                  <option value="">Escolha</option>
                  {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="p-svc" className="label">Serviço (opcional)</label>
                <select id="p-svc" className="input" value={reqService ?? ''} onChange={(e) => setReqService(Number(e.target.value) || null)} disabled={!reqServices.length}>
                  <option value="">Qualquer serviço da categoria</option>
                  {reqServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="post-body" className="label">
              {kind === 'trabalho' ? 'Conte o que foi feito (opcional)' : kind === 'divulgacao' ? 'Texto da divulgação' : 'Do que você precisa?'}
            </label>
            <textarea id="post-body" rows={4} maxLength={POST_LIMITS.body} className="input" value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={kind === 'trabalho' ? 'Ex.: Troquei toda a fiação da cozinha. Antes estava tudo exposto.'
                : kind === 'divulgacao' ? 'Ex.: Faço instalação de ar-condicionado com garantia. Atendo a cidade toda, inclusive sábado.'
                : 'Ex.: Procuro eletricista de confiança para trocar o quadro de luz ainda esta semana.'} />
          </div>

          {kind === 'divulgacao' && (
            <div>
              <label htmlFor="p-price" className="label">Preço (opcional)</label>
              <div className="flex flex-wrap gap-2">
                <input id="p-price" className="input min-w-0 flex-1" maxLength={POST_LIMITS.price} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ex.: A partir de R$ 120" />
                <button type="button" className={`btn-outline min-h-11 px-3 text-sm${price === 'Sob orçamento' ? ' ring-2 ring-brand-500' : ''}`} aria-pressed={price === 'Sob orçamento'}
                  onClick={() => setPrice(price === 'Sob orçamento' ? '' : 'Sob orçamento')}>Sob orçamento</button>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="p-hood" className="label">{kind === 'pedido' ? 'Bairro' : kind === 'trabalho' ? 'Bairro do trabalho (opcional)' : 'Bairro em destaque (opcional)'}</label>
            <select id="p-hood" className="input" value={hood ?? ''} onChange={(e) => setHood(Number(e.target.value) || null)}>
              <option value="">{kind === 'pedido' ? 'Qualquer bairro de Campo Grande' : 'Não informar'}</option>
              {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            {providerKind && <p className="hint">Nos filtros, a publicação aparece pelos bairros onde você atende.</p>}
          </div>

          {kind === 'pedido' && !props.publicName && (
            <div>
              <label htmlFor="p-name" className="label">Seu nome público</label>
              <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} autoComplete="given-name" placeholder="Ex.: Ana do Tiradentes" />
              <p className="hint">Aparece no pedido e nos seus comentários. Seu e-mail nunca aparece.</p>
            </div>
          )}

          {items.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Fotos e vídeo escolhidos (a primeira é a capa)">
              {items.map((it, i) => (
                <li key={it.key} className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50" data-testid="picked">
                  <div className="relative">
                    {it.kind === 'foto'
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={it.preview} alt={`Foto ${i + 1}`} className="aspect-square w-full object-cover" />
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      : <video src={it.preview} className="aspect-square w-full object-cover" muted />}
                    {i === 0 && it.kind === 'foto' && <span className="absolute left-1 top-1 rounded-full bg-brand-700 px-2 py-0.5 text-xs font-bold text-white">Capa</span>}
                    {it.path && !it.existing && <span className="absolute bottom-1 left-1 rounded-full bg-brand-700 px-2 py-0.5 text-xs font-bold text-white">Enviada</span>}
                    <button type="button" className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white"
                      aria-label={`Tirar ${it.kind === 'foto' ? `foto ${i + 1}` : 'vídeo'}`} onClick={() => remove(i)} disabled={!!step}>✕</button>
                  </div>
                  {it.kind === 'foto' && (
                    <div className="flex items-center gap-1 p-1.5">
                      <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-stone-300 bg-white disabled:opacity-40" aria-label={`Mover foto ${i + 1} para trás`} onClick={() => move(i, -1)} disabled={i === 0 || !!step}>←</button>
                      <select className="input min-h-9 min-w-0 flex-1 px-1 py-1 text-sm" aria-label={`Rótulo da foto ${i + 1}`} value={it.label ?? ''} onChange={(e) => setLabel(i, (e.target.value || null) as MediaLabel)}>
                        <option value="">Sem rótulo</option><option value="antes">Antes</option><option value="depois">Depois</option>
                      </select>
                      <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-stone-300 bg-white disabled:opacity-40" aria-label={`Mover foto ${i + 1} para frente`} onClick={() => move(i, 1)} disabled={i === items.length - 1 || !!step}>→</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline min-h-11 px-3 text-sm" onClick={() => photoInput.current?.click()} disabled={hasVideo || items.length >= POST_LIMITS.photos || !!step}>📷 {kind === 'trabalho' ? 'Fotos do trabalho' : 'Fotos (opcional)'}</button>
            {kind !== 'pedido' && <button type="button" className="btn-outline min-h-11 px-3 text-sm" onClick={() => videoInput.current?.click()} disabled={items.length > 0 || !!step}>🎬 Vídeo curto</button>}
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-testid="post-photos" onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
            <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" hidden data-testid="post-video" onChange={(e) => { void addVideo(e.target.files); e.target.value = ''; }} />
          </div>
          <p className="hint">
            Até {POST_LIMITS.photos} fotos (JPG, PNG ou WebP, {POST_LIMITS.photoMB} MB cada){kind !== 'pedido' && <> ou 1 vídeo de até {POST_LIMITS.videoSeconds} segundos</>}. A primeira foto é a capa; use as setas para mudar a ordem.
            Não mostre rosto, placa ou endereço de clientes sem permissão.
          </p>

          {step && <p role="status" className="text-sm font-semibold text-brand-700">{step}</p>}
          {err && <p role="alert" className="field-error">{err}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {edit && <Link href={`/comunidade/${edit.id}`} className="btn-outline min-h-11 px-4">Cancelar</Link>}
            <button type="submit" className="btn-hoje min-h-11 px-6" disabled={!!step}>{step ? (edit ? 'Salvando…' : 'Publicando…') : edit ? 'Salvar' : 'Publicar'}</button>
          </div>
        </>
      )}
    </form>
  );
}

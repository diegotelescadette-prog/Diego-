'use client';
import { Glyph } from './CategoryIcon';
import { APP_NAME } from '@/config/brand';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { addComment, deleteComment, editComment, findProviders, hideComment, reportPost, type Result } from '@/app/comunidade/actions';
import { POST_LIMITS, POST_REPORT_REASON, timeAgo, type CommentView } from '@/lib/posts-shared';

type Ctx = { postId: string; viewerId: string | null; isPostAuthor: boolean; needsName: boolean; defaultName: string; recommend: boolean };
type Picked = { id: string; slug: string; name: string; service: string | null };

/** Campo para indicar um perfil público (busca por nome ou serviço). */
function ProviderPicker({ value, onChange }: { value: Picked | null; onChange: (p: Picked | null) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Picked[]>([]);
  const [, start] = useTransition();
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return; }
    const t = setTimeout(() => start(async () => setList(await findProviders(q))), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-2 text-sm" data-testid="picked-provider">
        Indicando <strong>{value.name}</strong>{value.service && <> · {value.service}</>}
        <button type="button" className="font-semibold text-brand-700 underline" onClick={() => onChange(null)}>Trocar</button>
      </p>
    );
  }
  return (
    <div>
      <label className="label" htmlFor="c-prov">Indicar um prestador do {APP_NAME} (opcional)</label>
      <input id="c-prov" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou serviço, ex.: eletricista" autoComplete="off" />
      {list.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-stone-200 bg-white" aria-label="Prestadores encontrados">
          {list.map((p) => (
            <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-stone-50" onClick={() => { onChange(p); setQ(''); }}>
              <span className="font-semibold">{p.name}</span>{p.service && <span className="text-stone-600"> · {p.service}</span>}
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentForm({ ctx, parentId, onDone }: { ctx: Ctx; parentId?: number; onDone?: () => void }) {
  const [state, action, pending] = useActionState<Result | undefined, FormData>(addComment, undefined);
  const [prov, setProv] = useState<Picked | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = parentId ? `r-${parentId}` : 'c';
  useEffect(() => { if (state?.ok) { form.current?.reset(); setProv(null); onDone?.(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form ref={form} action={action} className="space-y-2">
      <input type="hidden" name="post_id" value={ctx.postId} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      {prov && <input type="hidden" name="provider_id" value={prov.id} />}
      {ctx.needsName && (
        <div>
          <label htmlFor={`${id}-name`} className="label">Seu nome (aparece no comentário)</label>
          <input id={`${id}-name`} name="name" className="input" defaultValue={ctx.defaultName} minLength={2} maxLength={60} required autoComplete="name" />
        </div>
      )}
      <label htmlFor={`${id}-body`} className="label">{parentId ? 'Sua resposta' : ctx.recommend ? 'Indique alguém ou comente' : 'Escreva um comentário'}</label>
      <textarea id={`${id}-body`} name="body" rows={2} maxLength={POST_LIMITS.comment} className="input" required
        placeholder={ctx.recommend ? 'Ex.: Chama o Carlos, ele trocou o quadro aqui de casa e ficou ótimo.' : 'Ex.: Fez um ótimo trabalho aqui em casa!'} />
      {ctx.recommend && !parentId && <ProviderPicker value={prov} onChange={setProv} />}
      {state?.message && !state.ok && <p role="alert" className="field-error">{state.message}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-11 px-5" disabled={pending}>{pending ? 'Enviando…' : parentId ? 'Responder' : 'Comentar'}</button>
        {parentId && <button type="button" className="btn-ghost min-h-11 px-3" onClick={onDone}>Cancelar</button>}
      </div>
    </form>
  );
}

function CommentItem({ c, replies, ctx }: { c: CommentView; replies: CommentView[]; ctx: Ctx }) {
  const [pending, start] = useTransition();
  const [reporting, setReporting] = useState(false);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body);
  const [err, setErr] = useState<string | null>(null);
  const mine = ctx.viewerId === c.authorId;
  return (
    <li className="flex gap-2" data-testid="comment">
      <span aria-hidden="true" className="mt-1 grid h-8 w-8 flex-none place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{c.name[0]?.toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <div className={`rounded-2xl px-3 py-2 ${c.status === 'oculto' ? 'bg-stone-50 text-stone-500' : 'bg-stone-100'}`}>
          <p className="text-sm font-bold">{c.name}{c.status === 'oculto' && <span className="ml-2 text-xs font-semibold uppercase">oculto</span>}</p>
          {editing ? (
            <div className="mt-1 space-y-2">
              <label className="sr-only" htmlFor={`e-${c.id}`}>Editar comentário</label>
              <textarea id={`e-${c.id}`} className="input" rows={2} maxLength={POST_LIMITS.comment} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" className="btn-primary min-h-10 px-4 text-sm" disabled={pending}
                  onClick={() => start(async () => { const r = await editComment(c.id, ctx.postId, text); if (r.ok) setEditing(false); else setErr(r.message ?? 'Não foi possível salvar.'); })}>Salvar</button>
                <button type="button" className="btn-ghost min-h-10 px-3 text-sm" onClick={() => { setEditing(false); setText(c.body); }}>Cancelar</button>
              </div>
              {err && <p role="alert" className="field-error">{err}</p>}
            </div>
          ) : <p className="whitespace-pre-line text-[15px] [overflow-wrap:anywhere]">{c.body}</p>}
          {c.provider && (
            <Link href={`/p/${c.provider.slug}`} className="mt-2 flex items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm hover:border-brand-500" data-testid="recommended">
              <span className="text-hoje-700"><Glyph d="M5 12h14M13 6l6 6-6 6" size={18} /></span><span className="min-w-0"><span className="block font-semibold">Indicou {c.provider.name}</span>{c.provider.service && <span className="block text-stone-600">{c.provider.service} · ver perfil</span>}</span>
            </Link>
          )}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs font-semibold text-stone-500">
          <time dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
          {c.editedAt && <span>editado</span>}
          {ctx.viewerId && !c.parentId && c.status === 'visivel' && <button type="button" onClick={() => setReplying(!replying)}>Responder</button>}
          {mine && !editing && <button type="button" onClick={() => setEditing(true)}>Editar</button>}
          {mine && <button type="button" disabled={pending} onClick={() => start(async () => { await deleteComment(c.id, ctx.postId); })}>Apagar</button>}
          {ctx.isPostAuthor && !mine && (
            <button type="button" disabled={pending} onClick={() => start(async () => { await hideComment(c.id, ctx.postId, c.status !== 'oculto'); })}>
              {c.status === 'oculto' ? 'Mostrar' : 'Ocultar'}
            </button>
          )}
          {ctx.viewerId && !mine && <button type="button" onClick={() => setReporting(!reporting)}>Denunciar</button>}
        </p>
        {reporting && <div className="mt-2"><ReportBox postId={ctx.postId} commentId={c.id} /></div>}
        {replies.length > 0 && <ul className="mt-3 space-y-3">{replies.map((r) => <CommentItem key={r.id} c={r} replies={[]} ctx={ctx} />)}</ul>}
        {replying && <div className="mt-2"><CommentForm ctx={ctx} parentId={c.id} onDone={() => setReplying(false)} /></div>}
      </div>
    </li>
  );
}

export function ReportBox({ postId, commentId }: { postId: string; commentId?: number }) {
  const [state, action] = useActionState<Result | undefined, FormData>(reportPost, undefined);
  if (state?.ok) return <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-900">{state.message}</p>;
  return (
    <form action={action} className="space-y-2 rounded-xl border border-stone-200 bg-white p-3">
      <input type="hidden" name="post_id" value={postId} />
      {commentId && <input type="hidden" name="comment_id" value={commentId} />}
      <label className="label" htmlFor={`rr-${commentId ?? 'p'}`}>Motivo da denúncia</label>
      <select id={`rr-${commentId ?? 'p'}`} name="reason" className="input" defaultValue="" required>
        <option value="" disabled>Escolha</option>
        {Object.entries(POST_REPORT_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <textarea name="details" rows={2} maxLength={1000} className="input" placeholder="Detalhes (opcional)" aria-label="Detalhes da denúncia" />
      {state?.message && <p role="alert" className="field-error">{state.message}</p>}
      <button type="submit" className="btn-outline min-h-10 px-3 text-sm">Enviar denúncia</button>
    </form>
  );
}

const PREVIEW = 5;

/** Comentários da publicação (prévia + "ver mais"), respostas e campo para comentar. Em pedidos, permite indicar um perfil. */
export function PostComments({ postId, comments, viewerId, isPostAuthor, needsName, defaultName, here, recommend = false }: {
  postId: string; comments: CommentView[]; viewerId: string | null; isPostAuthor: boolean; needsName: boolean; defaultName: string; here: string; recommend?: boolean;
}) {
  const [all, setAll] = useState(false);
  const ctx: Ctx = { postId, viewerId, isPostAuthor, needsName, defaultName, recommend };
  const top = comments.filter((c) => !c.parentId || !comments.some((p) => p.id === c.parentId));
  const shown = all ? top : top.slice(0, PREVIEW);
  const visible = comments.filter((c) => c.status === 'visivel').length;
  return (
    <section aria-labelledby="comentarios-titulo" className="post space-y-4 p-4" id="comentarios">
      <h2 id="comentarios-titulo" className="text-lg font-bold">{visible === 1 ? '1 comentário' : `${visible} comentários`}</h2>
      {top.length > 0 ? (
        <ul className="space-y-3">{shown.map((c) => <CommentItem key={c.id} c={c} replies={comments.filter((r) => r.parentId === c.id)} ctx={ctx} />)}</ul>
      ) : <p className="text-stone-600">{recommend ? 'Ninguém indicou ainda. Conhece um bom profissional? Indique aqui.' : 'Ninguém comentou ainda. Já contratou este profissional? Conte como foi.'}</p>}
      {!all && top.length > PREVIEW && <button type="button" className="btn-outline w-full" onClick={() => setAll(true)}>Ver mais {top.length - PREVIEW} comentários</button>}
      <div id="comentar">
        {viewerId ? <CommentForm ctx={ctx} /> : (
          <Link className="btn-outline w-full" href={`/entrar?motivo=comentar&next=${encodeURIComponent(here)}`}>{recommend ? 'Entre para indicar ou comentar' : 'Entre para comentar'}</Link>
        )}
      </div>
    </section>
  );
}

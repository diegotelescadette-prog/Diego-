'use client';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { addComment, deleteComment, hideComment, reportPost, type Result } from '@/app/publicacoes/actions';
import { POST_LIMITS, POST_REPORT_REASON, timeAgo, type CommentView } from '@/lib/posts-shared';

function CommentItem({ c, postId, viewerId, isPostAuthor }: { c: CommentView; postId: string; viewerId: string | null; isPostAuthor: boolean }) {
  const [pending, start] = useTransition();
  const [reporting, setReporting] = useState(false);
  const mine = viewerId === c.authorId;
  return (
    <li className="flex gap-2" data-testid="comment">
      <span aria-hidden="true" className="mt-1 grid h-8 w-8 flex-none place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{c.name[0]?.toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <div className={`rounded-2xl px-3 py-2 ${c.status === 'oculto' ? 'bg-stone-50 text-stone-500' : 'bg-stone-100'}`}>
          <p className="text-sm font-bold">{c.name}{c.status === 'oculto' && <span className="ml-2 text-xs font-semibold uppercase">oculto</span>}</p>
          <p className="whitespace-pre-line text-[15px] [overflow-wrap:anywhere]">{c.body}</p>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-4 px-2 text-xs font-semibold text-stone-500">
          <time dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
          {mine && <button type="button" disabled={pending} onClick={() => start(async () => { await deleteComment(c.id, postId); })}>Apagar</button>}
          {isPostAuthor && !mine && (
            <button type="button" disabled={pending} onClick={() => start(async () => { await hideComment(c.id, postId, c.status !== 'oculto'); })}>
              {c.status === 'oculto' ? 'Mostrar' : 'Ocultar'}
            </button>
          )}
          {viewerId && !mine && <button type="button" onClick={() => setReporting(!reporting)}>Denunciar</button>}
        </p>
        {reporting && <div className="mt-2"><ReportBox postId={postId} commentId={c.id} /></div>}
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

/** Comentários da publicação + campo para comentar. */
export function PostComments({ postId, comments, viewerId, isPostAuthor, needsName, defaultName, here }: {
  postId: string; comments: CommentView[]; viewerId: string | null; isPostAuthor: boolean; needsName: boolean; defaultName: string; here: string;
}) {
  const [state, action, pending] = useActionState<Result | undefined, FormData>(addComment, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  const visible = comments.filter((c) => c.status === 'visivel').length;
  return (
    <section aria-labelledby="comentarios-titulo" className="post space-y-4 p-4" id="comentarios">
      <h2 id="comentarios-titulo" className="text-lg font-bold">{visible === 1 ? '1 comentário' : `${visible} comentários`}</h2>
      {comments.length > 0 ? (
        <ul className="space-y-3">{comments.map((c) => <CommentItem key={c.id} c={c} postId={postId} viewerId={viewerId} isPostAuthor={isPostAuthor} />)}</ul>
      ) : <p className="text-stone-600">Ninguém comentou ainda. Já contratou este profissional? Conte como foi.</p>}
      <div id="comentar">
        {viewerId ? (
          <form ref={form} action={action} className="space-y-2">
            <input type="hidden" name="post_id" value={postId} />
            {needsName && (
              <div>
                <label htmlFor="c-name" className="label">Seu nome (aparece no comentário)</label>
                <input id="c-name" name="name" className="input" defaultValue={defaultName} minLength={2} maxLength={60} required autoComplete="name" />
              </div>
            )}
            <label htmlFor="c-body" className="label">Escreva um comentário</label>
            <textarea id="c-body" name="body" rows={2} maxLength={POST_LIMITS.comment} className="input" required placeholder="Ex.: Fez um ótimo trabalho aqui em casa!" />
            {state?.message && !state.ok && <p role="alert" className="field-error">{state.message}</p>}
            <button type="submit" className="btn-primary min-h-11 px-5" disabled={pending}>{pending ? 'Enviando…' : 'Comentar'}</button>
          </form>
        ) : (
          <Link className="btn-outline w-full" href={`/entrar?motivo=comentar&next=${encodeURIComponent(here)}`}>Entre para comentar</Link>
        )}
      </div>
    </section>
  );
}

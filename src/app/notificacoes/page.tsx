import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { REACTIONS, isReaction } from '@/lib/posts-shared';

export const metadata: Metadata = { title: 'Notificações' };
export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Campo_Grande' });

type Row = { id: number; kind: 'reacao' | 'comentario' | 'resposta' | 'seguiu'; actor_id: string | null; post_id: string | null; data: Record<string, string>; read_at: string | null; created_at: string };

function line(n: Row, actor: string): { text: string; href: string } {
  const post = n.post_id ? `/comunidade/${n.post_id}` : '/notificacoes';
  switch (n.kind) {
    case 'reacao': return { text: `${actor} reagiu com “${isReaction(n.data.reacao) ? REACTIONS.find((r) => r.key === n.data.reacao)!.label : 'Valeu'}” à sua publicação.`, href: post };
    case 'comentario': return { text: `${actor} comentou na sua publicação.`, href: `${post}#comentarios` };
    case 'resposta': return { text: `${actor} respondeu ao seu comentário.`, href: `${post}#comentarios` };
    case 'seguiu': return { text: `${actor} começou a seguir você.`, href: '/painel' };
  }
}

/** Notificações: reações, comentários, respostas e novos seguidores. Ao abrir, ficam como lidas (o destaque vale para esta visita). */
export default async function Notificacoes() {
  const user = await getUser();
  if (!user) redirect('/entrar?next=/notificacoes');
  const sb = await createClient();
  const { data } = await sb.from('notifications').select('id, kind, actor_id, post_id, data, read_at, created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
  const rows = (data ?? []) as Row[];
  const names = new Map<string, string>();
  await Promise.all([...new Set(rows.map((r) => r.actor_id).filter(Boolean))].map(async (id) => {
    const { data: n } = await sb.rpc('public_name', { p_user: id });
    if (n) names.set(id as string, String(n));
  }));
  if (rows.some((r) => !r.read_at)) await sb.rpc('mark_notifications_read');

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-3xl text-stone-900">Notificações</h1>
      {rows.length > 0 ? (
        <ul className="card divide-y divide-line p-2" data-testid="notifications">
          {rows.map((n) => {
            const t = line(n, (n.actor_id && names.get(n.actor_id)) || 'Alguém');
            return (
              <li key={n.id}>
                <Link href={t.href} className={`flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-paper${n.read_at ? '' : ' notif-unread'}`} data-testid="notification">
                  {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-coral" aria-label="Nova" />}
                  <span className="min-w-0 flex-1"><span className="block text-stone-900">{t.text}</span><span className="text-sm text-stone-600">{fmt.format(new Date(n.created_at))}</span></span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="card p-5 text-stone-700" data-testid="notifications-empty">
          <p>Quando alguém reagir, comentar ou seguir você, aparece aqui.</p>
          <Link href="/comunidade" className="btn-outline mt-3 min-h-11">Ver a comunidade</Link>
        </section>
      )}
    </div>
  );
}

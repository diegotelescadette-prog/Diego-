import Link from 'next/link';
import { safeNext } from '@/lib/validation';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProfileDetails } from '@/components/ProfileDetails';
import { GeneralContactButton, ReportForm, UrgentContactButton } from '@/components/ProfileActions';
import { toggleFavorite } from '@/app/p/actions';
import { loadProfile } from '@/lib/profile';
import { getNeighborhoods, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { generalMessage } from '@/lib/whatsapp';
import { PostCard } from '@/components/PostCard';
import { getPosts } from '@/lib/posts';
import { STATUS_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';

type SP = { servico?: string; bairro?: string; cidade?: string; online?: string; hoje?: string; voltar?: string };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await loadProfile({ slug: (await params).slug });
  return { title: p ? `${p.display_name}${p.main_service ? ` · ${p.main_service.name}` : ''}` : 'Perfil' };
}

export default async function PerfilPublico({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const p = await loadProfile({ slug });
  if (!p) notFound();
  const user = await getUser();

  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][]).toString();
  const here = `/p/${slug}${qs ? `?${qs}` : ''}`;

  // Contexto da busca → mensagem e eventual contato urgente
  const ctxService = p.services.find((s) => s.slug === sp.servico) ?? p.main_service ?? p.services[0];
  const nbs = p.city ? await getNeighborhoods(p.city.id) : [];
  const ctxNb = nbs.find((n) => n.slug === sp.bairro);
  const place = ctxNb ? `${ctxNb.name}, ${p.city?.name}` : p.city?.name ?? null;
  const online = sp.online === '1' || (!place && p.serves_online);
  const defaultMessage = generalMessage(ctxService?.name ?? 'um serviço', place, online);
  // Veio do "Preciso para hoje" (com ou sem bairro): contato sem login, revalidado no servidor.
  const urgentCtx = ctxService?.urgent_pilot && sp.hoje === '1' && sp.servico === ctxService.slug && p.available_today;

  let isFav = false;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase.from('favorites').select('provider_id').eq('user_id', user.id).eq('provider_id', p.id).maybeSingle();
    isFav = !!data;
  }
  const isOwner = user?.id === p.id;
  const posts = p.status === 'published' ? await getPosts({ author: p.id, limit: 20 }) : [];

  const actions = p.status === 'published' && !isOwner ? (
    <>
      {p.channel && (
        <a className="btn-primary" href={`/api/canal/${p.id}`} target="_blank" rel="noopener noreferrer" data-testid="canal-oficial">Acessar canal oficial</a>
      )}
      {urgentCtx ? (
        <UrgentContactButton providerId={p.id} serviceId={ctxService.id} neighborhoodId={ctxNb?.id ?? null} cityId={p.city?.id ?? null} backHref={`/hoje?servico=${ctxService.slug}${ctxNb ? `&bairro=${ctxNb.slug}` : ''}`} />
      ) : user ? (
        <GeneralContactButton providerId={p.id} defaultMessage={defaultMessage} />
      ) : (
        <Link className="btn-zap" href={`/entrar?motivo=contato&next=${encodeURIComponent(here)}`}>Chamar no WhatsApp</Link>
      )}
      <form action={toggleFavorite}>
        <input type="hidden" name="provider_id" value={p.id} />
        <input type="hidden" name="back" value={here} />
        <input type="hidden" name="fav" value={isFav ? '1' : '0'} />
        <button type="submit" className="btn-outline w-full" aria-pressed={isFav}>{isFav ? '★ Salvo nos favoritos' : '☆ Salvar nos favoritos'}</button>
      </form>
    </>
  ) : null;

  // Volta para a mesma busca, com todos os filtros (só caminhos internos de busca).
  const back = sp.voltar && /^\/(buscar|hoje|favoritos)(\?|$)/.test(safeNext(sp.voltar, '')) ? sp.voltar : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {back && (
        <Link href={back} className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 underline" data-testid="back-to-results">
          <span aria-hidden="true">←</span> Voltar aos resultados
        </Link>
      )}
      {p.status !== 'published' && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">
          Prévia — este perfil está <strong>{STATUS_LABEL[p.status]}</strong> e não aparece para visitantes.
        </p>
      )}
      {isOwner && p.status === 'published' && (
        <p className="rounded-xl bg-brand-50 p-3 text-brand-900">É assim que os clientes veem seu perfil. <Link className="underline" href="/painel">Voltar ao painel</Link></p>
      )}
      <ProfileDetails p={p} actions={actions} />
      {posts.length > 0 && (
        <section aria-labelledby="pub-titulo" className="space-y-4">
          <h2 id="pub-titulo" className="text-xl font-bold">Publicações</h2>
          {posts.map((po) => <PostCard key={po.id} post={po} viewerId={user?.id ?? null} message={defaultMessage} />)}
        </section>
      )}
      {p.channel && (
        <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-700" data-testid="credit-notice">
          Proposta, análise de crédito, CPF, renda e documentos do imóvel são tratados somente no canal oficial da instituição. O Resolve Aqui não recebe esses dados. Desconfie de promessa de aprovação garantida ou de pedido de pagamento antecipado, e denuncie.
        </p>
      )}
      {!user && p.status === 'published' && !urgentCtx && (
        <p className="text-sm text-stone-600">Para chamar pelo WhatsApp a partir da busca geral, entre com e-mail e senha. Você volta para este perfil logo depois.</p>
      )}
      {p.status === 'published' && !isOwner && (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-stone-700">Denunciar perfil</summary>
          <div className="mt-3">
            {user ? <ReportForm providerId={p.id} /> : (
              <Link className="btn-outline" href={`/entrar?motivo=denuncia&next=${encodeURIComponent(here)}`}>Entre para denunciar</Link>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

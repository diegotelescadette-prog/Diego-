import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProfileDetails } from '@/components/ProfileDetails';
import { GeneralContactButton, ReportForm, UrgentContactButton } from '@/components/ProfileActions';
import { toggleFavorite } from '@/app/p/actions';
import { loadProfile } from '@/lib/profile';
import { getNeighborhoods, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { generalMessage } from '@/lib/whatsapp';
import { STATUS_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';

type SP = { servico?: string; bairro?: string; cidade?: string; online?: string };

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
  const urgentCtx = ctxService?.urgent_pilot && ctxNb && sp.servico === ctxService.slug && p.available_today;

  let isFav = false;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase.from('favorites').select('provider_id').eq('user_id', user.id).eq('provider_id', p.id).maybeSingle();
    isFav = !!data;
  }
  const isOwner = user?.id === p.id;

  const actions = p.status === 'published' && !isOwner ? (
    <>
      {urgentCtx ? (
        <UrgentContactButton providerId={p.id} serviceId={ctxService.id} neighborhoodId={ctxNb.id} backHref={`/hoje?servico=${ctxService.slug}&bairro=${ctxNb.slug}`} />
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {p.status !== 'published' && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">
          Prévia — este perfil está <strong>{STATUS_LABEL[p.status]}</strong> e não aparece para visitantes.
        </p>
      )}
      {isOwner && p.status === 'published' && (
        <p className="rounded-xl bg-brand-50 p-3 text-brand-900">É assim que os clientes veem seu perfil. <Link className="underline" href="/painel">Voltar ao painel</Link></p>
      )}
      <ProfileDetails p={p} actions={actions} />
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

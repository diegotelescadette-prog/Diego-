import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AvailabilityPanel } from './AvailabilityPanel';
import { setProfileStatus } from './actions';
import { loadPanel, nextStep } from './overview';
import { PublishForm } from './previa/PublishForm';
import { CopyLink } from '@/components/CopyLink';
import { SubmitButton } from '@/components/SubmitButton';
import { getUser } from '@/lib/data';
import { siteUrl } from '@/lib/site';
import { STATUS_LABEL } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { VERIFICATION_LABEL, VERIFICATION_STYLE, verificationNext, type VerificationStatus } from '@/lib/verification';

export const metadata: Metadata = { title: 'Painel do prestador' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE = { draft: 'bg-stone-200 text-stone-900', published: 'bg-green-100 text-green-900', paused: 'bg-amber-100 text-amber-900', suspended: 'bg-red-100 text-red-900' };

export default async function Painel({ searchParams }: { searchParams: Promise<{ publicado?: string; erro?: string }> }) {
  const sp = await searchParams;
  const user = (await getUser())!;
  const d = await loadPanel(user.id);
  if (!d) redirect('/painel/perfil');
  const { p, coverage, today, cityName } = d;
  const step = nextStep(d);
  const { data: ver } = await (await createClient()).from('provider_verification').select('status, pending_reason').eq('provider_id', user.id).maybeSingle();
  const vStatus = (ver?.status ?? 'rascunho') as VerificationStatus;
  const visible = p.status === 'published' && coverage !== 'pendente';
  const visibility = p.status === 'published'
    ? (visible ? 'Visível na busca.' : 'Fora da busca até você confirmar a área de atendimento.')
    : p.status === 'draft' ? 'Ainda não aparece na busca. Complete o cadastro e publique.'
    : p.status === 'paused' ? 'Oculto da busca enquanto estiver pausado. Quem salvou nos favoritos também deixa de ver.'
    : 'Fora da busca e sem contato por decisão da moderação.';
  const publicUrl = `${await siteUrl()}/p/${p.slug}`;
  const areaText = coverage === 'cidade' ? `Toda ${cityName}`
    : coverage === 'bairros' ? d.areaNames.join(', ')
    : coverage === 'online' ? 'Somente atendimento online'
    : 'Área ainda não confirmada';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Visão geral</h1>
        <p className="text-stone-700">{p.display_name || 'Seu perfil profissional'}</p>
      </div>
      {sp.publicado && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900">Perfil publicado! Agora você aparece na busca.</p>}
      {sp.erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{sp.erro}</p>}

      {step && (
        <section aria-labelledby="proximo" className="card border-2 border-amber-300 bg-amber-50/60 p-5" data-testid={coverage === 'pendente' && p.status !== 'draft' ? 'confirm-area' : 'next-step'}>
          <h2 id="proximo" className="text-sm font-bold uppercase tracking-wide text-amber-900">Próximo passo</h2>
          {coverage === 'pendente' && p.status !== 'draft' && <p className="mt-1 text-lg font-semibold text-amber-950">Confirme sua área de atendimento.</p>}
          <p className="mt-1 text-amber-950">{step.text}</p>
          <Link className="btn-primary mt-3" href={step.href}>{step.cta}</Link>
        </section>
      )}

      <section className="card p-5" aria-labelledby="estado">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="estado" className="text-xl font-bold">Meu perfil</h2>
          <span className={`tag ${STATUS_STYLE[p.status]}`} data-testid="status">{STATUS_LABEL[p.status]}</span>
        </div>
        <p className="mt-2 flex items-center gap-2 text-stone-800" data-testid="visibility">
          <span aria-hidden="true">{visible ? '●' : '○'}</span>{visibility}
        </p>
        {p.status === 'suspended' && (
          <div className="mt-3 rounded-xl bg-red-50 p-3 text-red-950">
            <p className="font-semibold">Seu perfil foi suspenso pela moderação.</p>
            <p className="mt-1">Enquanto estiver suspenso, ele não aparece na busca e não recebe contatos. A reativação depende de uma nova análise da equipe de moderação. Você pode manter seus dados atualizados e consultar ou excluir sua conta em <Link className="underline" href="/conta">Minha conta</Link>.</p>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {p.status === 'draft' && d.missing.length > 0 && step && <Link className="btn-primary" href={step.href}>Continuar cadastro</Link>}
          {p.status === 'draft' && d.missing.length === 0 && <PublishForm label="Publicar meu perfil" />}
          {p.status === 'published' && <Link className="btn-outline" href={`/p/${p.slug}`}>Ver perfil público</Link>}
          {p.status === 'published' && (
            <form action={setProfileStatus}><input type="hidden" name="status" value="paused" />
              <SubmitButton className="btn-ghost w-full" pendingText="Pausando…">Pausar publicação</SubmitButton></form>
          )}
          {p.status === 'paused' && (
            <form action={setProfileStatus}><input type="hidden" name="status" value="published" />
              <SubmitButton className="btn-primary w-full" pendingText="Reativando…">Reativar publicação</SubmitButton></form>
          )}
          <Link className="btn-ghost" href="/painel/perfil">Editar perfil</Link>
        </div>
      </section>

      <section className="card p-5" aria-labelledby="verif" data-testid="panel-verification">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="verif" className="text-xl font-bold">Verificação do perfil</h2>
          <span className={`tag ${VERIFICATION_STYLE[vStatus]}`}>{VERIFICATION_LABEL[vStatus]}</span>
        </div>
        <p className="mt-1 text-stone-800">{verificationNext(vStatus, ver?.pending_reason)}</p>
        <Link className={vStatus === 'aprovado' || vStatus === 'em_analise' ? 'btn-ghost mt-3' : 'btn-primary mt-3'} href="/painel/verificacao">
          {vStatus === 'rascunho' ? 'Começar verificação' : vStatus === 'pendencia' ? 'Corrigir e reenviar' : 'Ver verificação'}
        </Link>
      </section>

      <section className="card border-hoje-500/40 p-5" aria-labelledby="hoje">
        <h2 id="hoje" className="mb-3 text-xl font-bold">Atendo hoje</h2>
        {today.blocked === 'not_published' ? (
          <p className="text-stone-700">Disponível depois que seu perfil estiver <strong>Publicado</strong>.</p>
        ) : today.blocked === 'no_in_person' ? (
          <p className="text-stone-700">O “Atendo hoje” vale para serviços presenciais. Adicione um em <Link className="underline" href="/painel/servicos">Serviços e fotos</Link>.</p>
        ) : today.blocked === 'no_area' ? (
          <p className="text-stone-700">Confirme sua área de atendimento para usar o “Atendo hoje”.</p>
        ) : (
          <AvailabilityPanel key={today.active ? 'on' : 'off'} cityName={cityName} services={today.services} areaNeighborhoods={today.areaNeighborhoods}
            servesWholeCity={p.serves_whole_city} active={today.active} />
        )}
      </section>

      <section className="card p-5" aria-labelledby="area">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="area" className="text-xl font-bold">Área de atendimento</h2>
          <Link className="btn-ghost" href="/painel/atendimento">Editar área</Link>
        </div>
        <p className="mt-1 text-stone-800" data-testid="area-summary">{areaText}{p.serves_online && coverage !== 'online' ? ' · Atendimento online' : ''}</p>
        <p className="mt-1 text-sm text-stone-600">Seu endereço de referência é privado e não aparece para os clientes.</p>
      </section>

      <section className="card p-5" aria-labelledby="publico">
        <h2 id="publico" className="text-xl font-bold">Perfil público</h2>
        {visible ? (
          <>
            <p className="mt-1 text-stone-700">Confira como os clientes veem você e compartilhe seu link.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
              <Link className="btn-outline" href={`/p/${p.slug}`}>Ver perfil público</Link>
              <CopyLink url={publicUrl} />
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-stone-700">O link público funciona quando o perfil estiver publicado e com a área confirmada.</p>
            <Link className="btn-outline mt-3" href="/painel/previa">Ver prévia</Link>
          </>
        )}
      </section>
    </div>
  );
}

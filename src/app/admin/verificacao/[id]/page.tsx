import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { verificationAction } from '../../actions';
import { SubmitButton } from '@/components/SubmitButton';
import { getIsAdmin, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LABEL, type ProviderStatus } from '@/lib/types';
import { REF_LABEL, VERIFICATION_LABEL, VERIFICATION_STYLE, type RefResult, type VerificationStatus } from '@/lib/verification';

export const metadata: Metadata = { title: 'Verificação do perfil' };
export const dynamic = 'force-dynamic';

type Detail = {
  provider: { id: string; slug: string; display_name: string; status: ProviderStatus; coverage: string; area_label: string | null; apt: boolean };
  whatsapp: string | null;
  services: { name: string; official_channel: boolean }[];
  verification: {
    status: VerificationStatus; legal_name: string | null; is_company: boolean; company_name: string | null; responsible_name: string | null;
    experience_years: number | null; refs_consent: boolean; privacy_ack: boolean; pending_reason: string | null; submitted_at: string | null;
    identity_checked_at: string | null; identity_checked_by: string | null; contact_checked_at: string | null; contact_checked_by: string | null;
    decided_at: string | null; decided_by: string | null;
  } | null;
  references: { id: number; position: number; name: string; contact: string; service: string; period: string | null; result: RefResult; checked_at: string | null; checked_by: string | null; internal_note: string | null }[];
  channel: { institution_name: string; role: string; linked_institution: string | null; official_url: string; checked_at: string | null } | null;
  ready: boolean;
};

const when = (iso: string | null) => iso ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Campo_Grande' }).format(new Date(iso)) : '';
const phone = (d: string) => d.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');

function Act({ id, op, label, back, refId, note, cls = 'btn-outline' }: { id: string; op: string; label: string; back: string; refId?: number; note?: boolean; cls?: string }) {
  return (
    <form action={verificationAction} className={note ? 'flex flex-col gap-2 sm:flex-row sm:items-end' : ''}>
      <input type="hidden" name="provider_id" value={id} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="back" value={back} />
      {refId && <input type="hidden" name="ref_id" value={refId} />}
      {note && (
        <div className="flex-1">
          <label htmlFor={`n-${op}-${refId ?? ''}`} className="label">Observação interna (sem dados pessoais)</label>
          <input id={`n-${op}-${refId ?? ''}`} name="note" className="input" maxLength={500} />
        </div>
      )}
      <SubmitButton className={`${cls} min-h-10 px-3 text-sm`}>{label}</SubmitButton>
    </form>
  );
}

export default async function VerificacaoAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; voltar?: string }> }) {
  if (!(await getIsAdmin())) {
    const user = await getUser();
    return (
      <div className="mx-auto max-w-xl card p-6" role="alert" data-testid="acesso-restrito">
        <h1 className="text-2xl font-extrabold">Acesso restrito</h1>
        <p className="mt-2 text-stone-700">Documentos e contatos de referência ficam restritos à equipe que trata o cadastro{user ? '. Sua conta não tem essa permissão.' : '.'}</p>
        <Link className="btn-primary mt-4" href="/">Voltar ao início</Link>
      </div>
    );
  }
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sb = await createClient();
  const { data, error } = await sb.rpc('admin_verification_detail', { p_provider: id });
  if (error || !data) notFound();
  const d = data as Detail;
  const v = d.verification;
  const status = (v?.status ?? 'rascunho') as VerificationStatus;
  const back = sp.voltar && /^\/admin\?aba=[a-z]+/.test(sp.voltar) ? sp.voltar : '/admin?aba=perfis&verificacao=fila';
  const confirmed = d.references.filter((r) => r.result === 'confirmada').length;
  const needsChannel = d.services.some((s) => s.official_channel);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 underline"><span aria-hidden="true">←</span> Voltar à lista</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-extrabold">{d.provider.display_name || '(sem nome)'}</h1>
        <span className={`tag ${VERIFICATION_STYLE[status]}`} data-testid="admin-verif-status">{VERIFICATION_LABEL[status]}</span>
        <span className="tag bg-stone-100 text-stone-800">Perfil: {STATUS_LABEL[d.provider.status]}</span>
        {d.provider.apt && <span className="tag cov-ok">Apto para o lançamento</span>}
      </div>
      {sp.msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{sp.msg}</p>}
      <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-700">Dados restritos. Não copie contatos ou documentos para observações, mensagens ou planilhas. Não guarde cópia de documento: registre só o resultado.</p>

      <section className="card space-y-2 p-5" aria-labelledby="a-id">
        <h2 id="a-id" className="text-lg font-bold">Identidade e contato</h2>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="font-semibold">Nome completo</dt><dd>{v?.legal_name || <em>não informado</em>}</dd>
          {v?.is_company && <><dt className="font-semibold">Empresa</dt><dd>{v.company_name}</dd><dt className="font-semibold">Responsável</dt><dd>{v.responsible_name}</dd></>}
          <dt className="font-semibold">WhatsApp profissional</dt><dd>{d.whatsapp ? phone(d.whatsapp) : <em>não informado</em>}</dd>
          <dt className="font-semibold">Experiência informada</dt><dd>{v?.experience_years != null ? `${v.experience_years} anos` : '—'}</dd>
          <dt className="font-semibold">Serviços</dt><dd>{d.services.map((s) => s.name).join(', ') || '—'}</dd>
          <dt className="font-semibold">Área</dt><dd>{d.provider.area_label ?? (d.provider.coverage === 'pendente' ? 'Área pendente' : d.provider.coverage)}</dd>
          <dt className="font-semibold">Enviado em</dt><dd>{when(v?.submitted_at ?? null) || '—'}</dd>
          <dt className="font-semibold">Consentimentos</dt><dd>{v?.refs_consent ? 'Referências avisadas' : 'Referências não confirmadas'} · {v?.privacy_ack ? 'aviso de privacidade aceito' : 'aviso de privacidade pendente'}</dd>
        </dl>
        <div className="grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2">
          <div className="space-y-2" data-testid="check-identity">
            <p className="text-sm"><strong>Identidade:</strong> {v?.identity_checked_at ? `conferida em ${when(v.identity_checked_at)} por ${v.identity_checked_by ?? '—'}` : 'a conferir'}</p>
            {v?.identity_checked_at
              ? <Act id={id} op="identidade_desfazer" label="Desfazer" back={back} cls="btn-ghost" />
              : <Act id={id} op="identidade_ok" label="Marcar identidade conferida" back={back} />}
          </div>
          <div className="space-y-2" data-testid="check-contact">
            <p className="text-sm"><strong>WhatsApp:</strong> {v?.contact_checked_at ? `conferido em ${when(v.contact_checked_at)} por ${v.contact_checked_by ?? '—'}` : 'a conferir'}</p>
            {v?.contact_checked_at
              ? <Act id={id} op="contato_desfazer" label="Desfazer" back={back} cls="btn-ghost" />
              : <Act id={id} op="contato_ok" label="Marcar WhatsApp conferido" back={back} />}
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-5" aria-labelledby="a-refs">
        <h2 id="a-refs" className="text-lg font-bold">Referências <span className="text-sm font-normal text-stone-600">({confirmed} confirmada{confirmed === 1 ? '' : 's'} de {d.references.length})</span></h2>
        <p className="text-sm text-stone-600">Pergunte só se o serviço foi feito pelo profissional. Registre o resultado; não anote a conversa.</p>
        {d.references.length === 0 && <p>Nenhuma referência informada.</p>}
        <ul className="space-y-3">
          {d.references.map((r) => (
            <li key={r.id} className="rounded-xl border border-stone-200 p-3" data-testid="admin-ref">
              <p className="flex flex-wrap items-center gap-2"><strong>{r.position}. {r.name}</strong> <span className="text-stone-700">{phone(r.contact)}</span>
                <span className={`tag ${r.result === 'confirmada' ? 'cov-ok' : r.result === 'nao_confirmada' ? 'cov-none' : 'bg-stone-100 text-stone-800'}`}>{REF_LABEL[r.result]}</span></p>
              <p className="text-sm text-stone-700">{r.service}{r.period ? ` · ${r.period}` : ''}</p>
              {r.checked_at && <p className="text-xs text-stone-600">Registrado em {when(r.checked_at)} por {r.checked_by ?? '—'}{r.internal_note ? ` · ${r.internal_note}` : ''}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {r.result !== 'confirmada' && <Act id={id} op="referencia_confirmada" refId={r.id} label="Confirmou o serviço" back={back} />}
                {r.result !== 'nao_confirmada' && <Act id={id} op="referencia_nao_confirmada" refId={r.id} label="Não confirmou / não atendeu" back={back} cls="btn-ghost" />}
                {r.result !== 'a_conferir' && <Act id={id} op="referencia_desfazer" refId={r.id} label="Voltar para a conferir" back={back} cls="btn-ghost" />}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {(needsChannel || d.channel) && (
        <section className="card space-y-2 p-5" aria-labelledby="a-ch">
          <h2 id="a-ch" className="text-lg font-bold">Canal oficial (crédito)</h2>
          {d.channel ? (
            <>
              <p className="text-sm"><strong>{d.channel.institution_name}</strong> · {d.channel.role === 'correspondente' ? `correspondente de ${d.channel.linked_institution}` : 'a própria instituição'}</p>
              <p className="break-all text-sm"><a className="underline" href={d.channel.official_url} target="_blank" rel="noopener noreferrer">{d.channel.official_url}</a></p>
              <p className="text-sm text-stone-600">Confira a instituição e o vínculo nas fontes oficiais do Banco Central antes de marcar: <a className="underline" href="https://www.bcb.gov.br/meubc/encontreinstituicao" target="_blank" rel="noopener noreferrer">consulta de instituições</a> e <a className="underline" href="https://www.bcb.gov.br/meubc/faqs/p/lista-de-correspondentes-no-pais" target="_blank" rel="noopener noreferrer">lista de correspondentes</a>.</p>
              <p className="text-sm"><strong>Situação:</strong> {d.channel.checked_at ? `conferido em ${when(d.channel.checked_at)}` : 'a conferir'}</p>
              {d.channel.checked_at
                ? <Act id={id} op="canal_desfazer" label="Desfazer" back={back} cls="btn-ghost" />
                : <Act id={id} op="canal_ok" label="Marcar canal oficial conferido" back={back} />}
            </>
          ) : <p className="text-sm">O prestador oferece crédito e ainda não informou o canal oficial.</p>}
        </section>
      )}

      <section className="card space-y-3 p-5" aria-labelledby="a-dec">
        <h2 id="a-dec" className="text-lg font-bold">Decisão</h2>
        {v?.pending_reason && status === 'pendencia' && <p className="rounded-xl bg-hoje-100 p-3 text-sm text-stone-900"><strong>Pendência atual:</strong> {v.pending_reason}</p>}
        {v?.decided_at && <p className="text-sm text-stone-600">Última decisão em {when(v.decided_at)} por {v.decided_by ?? '—'}.</p>}
        <p className="text-sm">{d.ready ? 'Pronto para aprovar: identidade e WhatsApp conferidos e ao menos uma referência confirmada.' : 'Para aprovar: identidade e WhatsApp conferidos e ao menos uma referência confirmada.'}</p>
        {status !== 'aprovado' && <Act id={id} op="aprovar" label="Aprovar cadastro" back={back} cls="btn-primary" />}
        <form action={verificationAction} className="space-y-2" data-testid="pending-form">
          <input type="hidden" name="provider_id" value={id} />
          <input type="hidden" name="op" value="pendencia" />
          <input type="hidden" name="back" value={back} />
          <label htmlFor="pend-note" className="label">Motivo da pendência (o prestador vê este texto)</label>
          <textarea id="pend-note" name="note" rows={2} maxLength={500} className="input" placeholder="Ex.: a referência 1 não confirmou o serviço. Informe outra referência." />
          <SubmitButton className="btn-outline">Registrar pendência</SubmitButton>
        </form>
      </section>
    </div>
  );
}

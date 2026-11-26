'use client';
import { APP_NAME } from '@/config/brand';
import { useActionState, useState } from 'react';
import { saveVerification, type VerifState } from './actions';
import { REF_LABEL, type RefResult, type VerificationStatus } from '@/lib/verification';

export interface VerifInitial {
  legal_name: string; is_company: boolean; company_name: string; responsible_name: string; experience_years: string;
  refs_consent: boolean; privacy_ack: boolean;
  refs: { name: string; contact: string; service: string; period: string; result: RefResult | null }[];
  channel: { institution: string; role: string; linked: string; url: string; checked: boolean } | null;
}

export function VerificationForm({ initial, needsChannel, status }: { initial: VerifInitial; needsChannel: boolean; status: VerificationStatus }) {
  const [state, action, pending] = useActionState<VerifState, FormData>(saveVerification, undefined);
  const v = state?.values;
  const val = (k: string, d: string) => (v ? v[k] ?? '' : d);
  const [company, setCompany] = useState(v ? v.is_company === '1' : initial.is_company);
  const [role, setRole] = useState(val('ch_role', initial.channel?.role ?? 'instituicao'));

  return (
    <form action={action} className="space-y-4" noValidate>
      <section className="card space-y-3 p-5" aria-labelledby="v-id">
        <h2 id="v-id" className="text-lg font-bold">Identidade e contato</h2>
        <p className="text-sm text-stone-600">Seu nome completo é privado: só a equipe que confere o cadastro vê. No perfil aparece o nome profissional.</p>
        <div>
          <label htmlFor="legal_name" className="label">Nome completo</label>
          <input id="legal_name" name="legal_name" className="input" defaultValue={val('legal_name', initial.legal_name)} maxLength={120} autoComplete="name" />
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="is_company" value="1" checked={company} onChange={(e) => setCompany(e.target.checked)} className="h-5 w-5" />
          Atendo como empresa
        </label>
        {company && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="company_name" className="label">Nome da empresa</label>
              <input id="company_name" name="company_name" className="input" defaultValue={val('company_name', initial.company_name)} maxLength={120} /></div>
            <div><label htmlFor="responsible_name" className="label">Responsável</label>
              <input id="responsible_name" name="responsible_name" className="input" defaultValue={val('responsible_name', initial.responsible_name)} maxLength={120} /></div>
          </div>
        )}
        <p className="text-sm text-stone-600">A equipe confere seu WhatsApp profissional (cadastrado em Meu perfil) e pode pedir para ver um documento de identidade por videochamada. Não enviamos nem guardamos cópia do documento: registramos só que a conferência foi feita, por quem e quando.</p>
      </section>

      <section className="card space-y-3 p-5" aria-labelledby="v-exp">
        <h2 id="v-exp" className="text-lg font-bold">Atuação</h2>
        <div className="max-w-xs">
          <label htmlFor="experience_years" className="label">Tempo de experiência (anos)</label>
          <input id="experience_years" name="experience_years" inputMode="numeric" className="input" defaultValue={val('experience_years', initial.experience_years)} maxLength={2} />
        </div>
        <p className="text-sm text-stone-600">Aparece no perfil como “Experiência informada”, porque é você quem declara. Seus serviços, área de atendimento e fotos ficam em <a className="underline" href="/painel/servicos">Serviços e fotos</a> e <a className="underline" href="/painel/atendimento">Onde atendo</a>.</p>
      </section>

      <section className="card space-y-3 p-5" aria-labelledby="v-refs">
        <h2 id="v-refs" className="text-lg font-bold">Três referências de clientes</h2>
        <p className="text-sm text-stone-600">Indique clientes que contrataram você. A equipe só pergunta se o serviço foi feito, e registra o resultado internamente. Com uma referência confirmada o cadastro já pode ser aprovado; as outras continuam sendo conferidas.</p>
        {initial.refs.map((r, idx) => {
          const i = idx + 1;
          return (
            <fieldset key={i} className="space-y-2 rounded-xl border border-stone-200 p-3" data-testid={`ref-${i}`}>
              <legend className="px-1 font-semibold">Referência {i}{r.result && <span className="ml-2 text-sm font-normal text-stone-600">({REF_LABEL[r.result]})</span>}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><label htmlFor={`r${i}_name`} className="label">Nome do cliente</label>
                  <input id={`r${i}_name`} name={`r${i}_name`} className="input" defaultValue={val(`r${i}_name`, r.name)} maxLength={80} /></div>
                <div><label htmlFor={`r${i}_contact`} className="label">WhatsApp do cliente (com DDD)</label>
                  <input id={`r${i}_contact`} name={`r${i}_contact`} className="input" inputMode="tel" defaultValue={val(`r${i}_contact`, r.contact)} maxLength={20} /></div>
                <div><label htmlFor={`r${i}_service`} className="label">Serviço realizado</label>
                  <input id={`r${i}_service`} name={`r${i}_service`} className="input" defaultValue={val(`r${i}_service`, r.service)} maxLength={120} placeholder="Ex.: troca do chuveiro" /></div>
                <div><label htmlFor={`r${i}_period`} className="label">Quando, aproximadamente</label>
                  <input id={`r${i}_period`} name={`r${i}_period`} className="input" defaultValue={val(`r${i}_period`, r.period)} maxLength={60} placeholder="Ex.: março de 2025" /></div>
              </div>
            </fieldset>
          );
        })}
        <label className="flex items-start gap-2">
          <input type="checkbox" name="refs_consent" value="1" defaultChecked={v ? v.refs_consent === '1' : initial.refs_consent} className="mt-1 h-5 w-5" />
          Avisei essas pessoas e elas concordaram em ser contatadas pela equipe do {APP_NAME}.
        </label>
      </section>

      {needsChannel && (
        <section className="card space-y-3 p-5" aria-labelledby="v-ch">
          <h2 id="v-ch" className="text-lg font-bold">Crédito imobiliário: canal oficial</h2>
          <p className="text-sm text-stone-600">Quem oferece financiamento ou empréstimo informa a instituição responsável e o canal oficial. A equipe confere nas fontes oficiais antes de mostrar o serviço. Proposta, análise de crédito, CPF, renda e documentos do imóvel ficam no canal oficial, nunca no {APP_NAME}.</p>
          {initial.channel?.checked && <p className="text-sm font-semibold text-green-800">✓ Canal oficial conferido pela equipe. Alterar os dados pede nova conferência.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label htmlFor="ch_institution" className="label">Quem oferece o atendimento</label>
              <input id="ch_institution" name="ch_institution" className="input" defaultValue={val('ch_institution', initial.channel?.institution ?? '')} maxLength={120} /></div>
            <div><label htmlFor="ch_role" className="label">Atua como</label>
              <select id="ch_role" name="ch_role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="instituicao">A própria instituição</option>
                <option value="correspondente">Correspondente de uma instituição</option>
              </select></div>
            {role === 'correspondente' && (
              <div><label htmlFor="ch_linked" className="label">Instituição contratante</label>
                <input id="ch_linked" name="ch_linked" className="input" defaultValue={val('ch_linked', initial.channel?.linked ?? '')} maxLength={120} /></div>
            )}
            <div><label htmlFor="ch_url" className="label">Endereço do canal oficial</label>
              <input id="ch_url" name="ch_url" type="url" className="input" defaultValue={val('ch_url', initial.channel?.url ?? '')} maxLength={300} placeholder="https://" /></div>
          </div>
        </section>
      )}

      <section className="card space-y-3 p-5" aria-labelledby="v-priv">
        <h2 id="v-priv" className="text-lg font-bold">Aviso de privacidade</h2>
        <p className="text-sm text-stone-700" data-testid="privacy-notice">
          Usamos seu nome completo, WhatsApp e os contatos das referências só para conferir o cadastro antes de mostrar os selos. Esses dados ficam restritos à equipe que trata o seu cadastro, não aparecem no perfil público, no feed, nos links nem no histórico comum. Guardamos o resultado das conferências enquanto o perfil existir; ao excluir a conta, tudo é apagado. Não fazemos consulta de processos ou antecedentes.
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="privacy_ack" value="1" defaultChecked={v ? v.privacy_ack === '1' : initial.privacy_ack} className="mt-1 h-5 w-5" />
          Li o aviso e concordo com o uso desses dados para a verificação.
        </label>
      </section>

      {state?.error && <p role="alert" className="field-error rounded-xl bg-red-50 p-3" data-testid="verif-error">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900" data-testid="verif-ok">{state.message}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" name="intent" value="enviar" className="btn-primary" disabled={pending}>
          {pending ? 'Enviando…' : status === 'aprovado' ? 'Salvar alterações' : status === 'rascunho' ? 'Enviar para análise' : 'Reenviar para análise'}
        </button>
        <button type="submit" name="intent" value="rascunho" className="btn-outline" disabled={pending}>Salvar rascunho</button>
      </div>
    </form>
  );
}

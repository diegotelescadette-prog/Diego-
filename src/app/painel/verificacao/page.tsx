import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { VerificationForm, type VerifInitial } from './VerificationForm';
import { getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { badgeTexts, REF_LABEL, VERIFICATION_LABEL, VERIFICATION_STYLE, verificationNext, type RefResult, type VerificationStatus } from '@/lib/verification';

export const metadata: Metadata = { title: 'Verificação do perfil' };
export const dynamic = 'force-dynamic';

export default async function Verificacao() {
  const user = (await getUser())!;
  const sb = await createClient();
  const { data: prof } = await sb.from('provider_profiles').select('id, slug').eq('id', user.id).maybeSingle();
  if (!prof) redirect('/painel/perfil');
  const [{ data: v }, { data: refs }, { data: ch }, { data: priv }, { data: svcs }, { data: badges }] = await Promise.all([
    sb.from('provider_verification').select('*').eq('provider_id', user.id).maybeSingle(),
    sb.from('provider_references').select('id, position, name, contact, service, period, result').eq('provider_id', user.id).order('position'),
    sb.from('provider_official_channel').select('institution_name, role, linked_institution, official_url, checked_at').eq('provider_id', user.id).maybeSingle(),
    sb.from('provider_private').select('whatsapp').eq('provider_id', user.id).maybeSingle(),
    sb.from('provider_services').select('services(service_categories(official_channel))').eq('provider_id', user.id),
    sb.rpc('provider_badges', { p_ids: [user.id] }),
  ]);
  const status = (v?.status ?? 'rascunho') as VerificationStatus;
  const needsChannel = (svcs ?? []).some((r) => (r.services as unknown as { service_categories: { official_channel: boolean } } | null)?.service_categories?.official_channel);
  const b = (badges as { identity_checked: boolean; refs_confirmed: number; experience_years: number | null }[] | null)?.[0];
  const shown = badgeTexts(b ? { identity: b.identity_checked, refs: b.refs_confirmed, experience: b.experience_years } : null);

  const initial: VerifInitial = {
    legal_name: v?.legal_name ?? '', is_company: !!v?.is_company, company_name: v?.company_name ?? '', responsible_name: v?.responsible_name ?? '',
    experience_years: v?.experience_years != null ? String(v.experience_years) : '',
    refs_consent: !!v?.refs_consent, privacy_ack: !!v?.privacy_ack,
    refs: [1, 2, 3].map((i) => {
      const r = (refs ?? []).find((x) => x.position === i);
      return { name: r?.name ?? '', contact: r?.contact ?? '', service: r?.service ?? '', period: r?.period ?? '', result: (r?.result ?? null) as RefResult | null };
    }),
    channel: ch ? { institution: ch.institution_name, role: ch.role, linked: ch.linked_institution ?? '', url: ch.official_url, checked: !!ch.checked_at } : null,
  };
  const checks = [
    { label: 'Identidade e contato', done: !!v?.identity_checked_at && !!v?.contact_checked_at,
      text: v?.identity_checked_at && v?.contact_checked_at ? 'Conferidos pela equipe' : v?.identity_checked_at ? 'Identidade conferida · WhatsApp a conferir' : 'A conferir' },
    { label: 'Referências', done: (refs ?? []).some((r) => r.result === 'confirmada'),
      text: (refs ?? []).length === 0 ? 'Nenhuma informada' : (refs ?? []).map((r) => `${r.position}: ${REF_LABEL[r.result as RefResult]}`).join(' · ') },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Verificação do perfil</h1>
        <p className="text-stone-700">A equipe confere sua identidade, seu WhatsApp e pelo menos uma de três referências de clientes. A verificação é separada da publicação do perfil.</p>
      </div>

      <section className="card p-5" aria-labelledby="andamento" data-testid="verif-status">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="andamento" className="text-xl font-bold">Andamento</h2>
          <span className={`tag ${VERIFICATION_STYLE[status]}`} data-testid="verif-label">{VERIFICATION_LABEL[status]}</span>
        </div>
        <ol className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Etapas">
          {(['rascunho', 'em_analise', 'pendencia', 'aprovado'] as const).map((s) => (
            <li key={s} className={`rounded-full px-3 py-1 ${s === status ? 'bg-brand-600 font-bold text-white' : 'bg-stone-100 text-stone-700'}`} aria-current={s === status ? 'step' : undefined}>{VERIFICATION_LABEL[s]}</li>
          ))}
        </ol>
        <p className={`mt-3 ${status === 'pendencia' ? 'rounded-xl bg-hoje-100 p-3 text-stone-900' : 'text-stone-800'}`} data-testid="verif-next">
          <strong>Próximo passo:</strong> {verificationNext(status, v?.pending_reason)}
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {checks.map((c) => <li key={c.label}><span aria-hidden="true">{c.done ? '✓' : '○'}</span> <strong>{c.label}:</strong> {c.text}</li>)}
        </ul>
        {shown.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-semibold">Selos no seu perfil</p>
            <ul className="mt-1 flex flex-wrap gap-2">{shown.map((s) => <li key={s.key} className="verif-badge">✓ {s.text}</li>)}</ul>
          </div>
        )}
        {!priv?.whatsapp && <p className="mt-3 text-sm text-red-800">Informe seu WhatsApp profissional em <Link className="underline" href="/painel/perfil#phone">Meu perfil</Link> antes de enviar.</p>}
      </section>

      <VerificationForm initial={initial} needsChannel={needsChannel || !!ch} status={status} />
    </div>
  );
}

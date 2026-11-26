import Link from 'next/link';
import { Avatar } from './Avatar';
import type { ProfileView } from '@/lib/profile';
import { BADGES_DISCLAIMER, badgeTexts } from '@/lib/verification';

export type ProfileTab = 'trabalhos' | 'sobre' | 'publicacoes';
export interface ProfileStats { posts: number; useful: number; saved: number }

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'trabalhos', label: 'Trabalhos' },
  { key: 'sobre', label: 'Sobre' },
  { key: 'publicacoes', label: 'Publicações' },
];

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Perfil no estilo rede profissional: capa, foto, título com os serviços, selos, números, ações e abas.
 * Sem `tabHref` (prévia do painel), mostra todas as seções em sequência.
 */
export function ProfileDetails({ p, actions, stats, tab, tabHref, publications }: {
  p: ProfileView; actions?: React.ReactNode; stats?: ProfileStats;
  tab?: ProfileTab; tabHref?: (t: ProfileTab) => string; publications?: React.ReactNode;
}) {
  const others = p.services.filter((s) => s.id !== p.main_service?.id);
  const badges = badgeTexts(p.badges);
  const headline = [p.main_service, ...others].filter(Boolean).slice(0, 3).map((s) => s!.name).join(' · ');
  const tabs = tabHref ? TABS.filter((t) => t.key !== 'publicacoes' || publications) : [];
  const show = (t: ProfileTab) => !tabHref || tab === t;

  const works = (
    <section aria-labelledby="pf-trab" className="p-4 sm:p-5" data-testid="profile-works">
      <h2 id="pf-trab" className={tabHref ? 'sr-only' : 'mb-2 font-bold'}>Fotos de trabalhos</h2>
      {p.work_photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {p.work_photos.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <li key={u}><img src={u} alt={`Trabalho ${i + 1} de ${p.display_name}`} className="aspect-square w-full rounded-xl object-cover" loading="lazy" /></li>
          ))}
        </ul>
      ) : <p className="text-stone-600">Ainda não há fotos de trabalhos.</p>}
    </section>
  );

  const about = (
    <section aria-labelledby="pf-sobre" className="space-y-4 p-4 sm:p-5" data-testid="profile-about">
      <h2 id="pf-sobre" className={tabHref ? 'sr-only' : 'font-bold'}>Sobre</h2>
      {p.bio ? <p className="whitespace-pre-line text-stone-800">{p.bio}</p> : <p className="text-stone-600">Sem apresentação ainda.</p>}
      {p.area_label && <p className="text-stone-700"><span className="font-semibold">Atende:</span> {p.area_label}</p>}
      {others.length > 0 && (
        <div>
          <h3 className="font-semibold text-stone-800">Outros serviços</h3>
          <ul className="mt-2 flex flex-wrap gap-2">{others.map((s) => <li key={s.id} className="soft-tag">{s.name}</li>)}</ul>
        </div>
      )}
    </section>
  );

  return (
    <article className="card overflow-hidden" data-testid="profile">
      <div className="pf-cover" aria-hidden="true" />
      <div className="px-4 pb-4 sm:px-6">
        <div className="pf-avatar"><Avatar src={p.photo} name={p.display_name || '?'} size={104} round /></div>
        <h1 className="mt-2 text-2xl font-bold text-stone-900">{p.display_name || 'Seu nome profissional'}</h1>
        {headline && <p className="text-[17px] text-stone-700">{headline}</p>}
        {(p.area_label || p.city) && <p className="mt-0.5 text-sm text-stone-500">{[p.area_label, p.city?.name].filter(Boolean).join(' · ')}</p>}

        {(badges.length > 0 || p.available_today) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {p.available_today && <span className="pf-today">● Atende hoje <span className="font-normal">· horário pelo WhatsApp</span></span>}
            {badges.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Checagens do perfil" data-testid="profile-badges">
                {badges.map((b) => <li key={b.key} className={b.key === 'exp' ? 'verif-badge verif-badge-exp' : 'verif-badge'}>{b.key === 'exp' ? '' : '✓ '}{b.text}</li>)}
              </ul>
            )}
          </div>
        )}
        {badges.length > 0 && (
          <details className="mt-2 text-sm" data-testid="badges-explained">
            <summary className="cursor-pointer font-semibold text-stone-600">O que os selos significam</summary>
            <ul className="mt-2 space-y-1 text-stone-700">{badges.map((b) => <li key={b.key}><strong>{b.text}:</strong> {b.hint}</li>)}</ul>
            <p className="mt-2 text-stone-600">{BADGES_DISCLAIMER}</p>
          </details>
        )}
        {p.channel && (
          <p className="mt-3 text-stone-800" data-testid="official-channel">
            <span className="font-semibold">Atendimento por:</span> {p.channel.institution_name}
            {p.channel.role === 'correspondente' && p.channel.linked_institution && <> · correspondente de {p.channel.linked_institution}</>}
          </p>
        )}

        {stats && (
          <dl className="pf-stats" data-testid="profile-stats">
            <div><dt>{plural(stats.posts, 'publicação', 'publicações')}</dt><dd>{stats.posts}</dd></div>
            <div><dt>{plural(stats.useful, 'achou útil', 'acharam útil')}</dt><dd>{stats.useful}</dd></div>
            <div><dt>{plural(stats.saved, 'salvou', 'salvaram')}</dt><dd>{stats.saved}</dd></div>
          </dl>
        )}
        {actions && <div className="pf-actions">{actions}</div>}
      </div>

      {tabs.length > 0 && (
        <nav aria-label="Seções do perfil" className="pf-tabs">
          {tabs.map((t) => (
            <Link key={t.key} href={tabHref!(t.key)} scroll={false} replace aria-current={tab === t.key ? 'page' : undefined}>{t.label}</Link>
          ))}
        </nav>
      )}
      <div className={tabHref ? '' : 'divide-y divide-line border-t border-line'}>
        {show('trabalhos') && works}
        {show('sobre') && about}
        {tabHref && tab === 'publicacoes' && publications && <div className="bg-paper p-3 sm:p-4" data-testid="profile-posts">{publications}</div>}
      </div>
    </article>
  );
}

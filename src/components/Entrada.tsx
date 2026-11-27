import Image from 'next/image';
import Link from 'next/link';
import { Glyph } from '@/components/CategoryIcon';
import { EMPLOYMENT_LABEL, type EmploymentType } from '@/lib/jobs';
import { FIRST_GOALS, NAV_ICONS } from '@/lib/nav';
import { SKY, hourIn, skyPeriod } from '@/lib/sky';
import { createClient } from '@/lib/supabase/server';

const SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5';

/** O que a pessoa encontra em cada área, na ordem dos botões da tela inicial. */
const AREAS: Record<(typeof FIRST_GOALS)[number]['key'], { title: string; text: string }> = {
  servico: { title: 'Preciso de um serviço', text: 'Eletricista, diarista, pedreiro e mais, com profissional verificado.' },
  prestar: { title: 'Sou prestador de serviço', text: 'Esta área é para você: mostre seus trabalhos, receba pedidos e seja indicado.' },
  emprego: { title: 'Procuro emprego', text: 'Veja as vagas de Campo Grande e candidate-se com o currículo do app. Ninguém cobra para você conseguir vaga.' },
  vaga: { title: 'Ofereço uma vaga', text: 'Anuncie grátis, receba currículos e marque entrevistas com segurança.' },
  comercio: { title: 'Comércio', text: 'Anuncie o que você vende ou encontre quem vende perto de você.' },
  comunidade: { title: 'Comunidade', text: 'O dia a dia da cidade, trabalhos mostrados e pedidos de indicação.' },
};

const SAFETY = [
  'Identidade e referências dos profissionais conferidas pela equipe.',
  'Seu telefone só aparece para quem você aceitar.',
  'É proibido cobrar para alguém conseguir vaga.',
  'Denúncia em um toque, com resposta da equipe.',
];

type Showcase = { total: number; vagas: { cargo: string; bairro: string | null; tipo: EmploymentType }[] };
type Trust = { verificados: number; vagas: number; concluidos: number };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
const signup = (next: string) => `/cadastrar?next=${encodeURIComponent(next)}`;

/**
 * Página de entrada (sem conta): explica cada área, mostra uma vitrine de vagas sem expor empresa,
 * salário ou contato, os números de confiança que não forem zero e como mantemos a pessoa segura.
 */
export async function Entrada({ vaga, timezone }: { vaga: string; timezone: string }) {
  const q = vaga.trim().slice(0, 60);
  const supabase = await createClient();
  const [{ data: show }, { data: trust }] = await Promise.all([
    supabase.rpc('entry_job_showcase', { p_q: q || null }),
    supabase.rpc('entry_trust_numbers'),
  ]);
  const showcase = (show ?? { total: 0, vagas: [] }) as Showcase;
  const t = (trust ?? { verificados: 0, vagas: 0, concluidos: 0 }) as Trust;
  const numbers = [
    { n: t.verificados, label: (n: number) => plural(n, 'profissional verificado', 'profissionais verificados') },
    { n: t.vagas, label: (n: number) => plural(n, 'vaga aberta', 'vagas abertas') },
    { n: t.concluidos, label: (n: number) => plural(n, 'serviço concluído', 'serviços concluídos') },
  ].filter((x) => x.n > 0);
  const sky = SKY[skyPeriod(hourIn(timezone))];
  const anyJobs = showcase.total > 0 || q !== '';

  return (
    <div className="mx-auto max-w-4xl space-y-10" data-testid="entrada">
      <header className="dawn">
        <Image src={sky.src} alt={sky.alt} fill priority sizes="(min-width: 1024px) 896px, 100vw" className="dawn-photo" style={{ objectPosition: sky.pos }} />
        <div className="dawn-text">
          <h1 className="text-[30px] leading-tight text-white sm:text-[42px]">Gente de confiança, perto de você.</h1>
          <p className="mt-2 max-w-md text-[17px] text-white">A rede de Campo Grande para contratar, trabalhar, vender e se ajudar. Todo mundo aqui é identificado.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/cadastrar" className="btn-primary min-h-12 px-5" data-testid="cta-criar">Criar conta grátis</Link>
            <Link href="/entrar" className="btn min-h-12 border border-white/70 px-5 text-white hover:bg-white/10" data-testid="cta-entrar">Entrar</Link>
          </div>
        </div>
        <a className="dawn-credit" href={sky.href} target="_blank" rel="noopener noreferrer">Foto: {sky.credit}</a>
      </header>

      <section aria-labelledby="areas-t">
        <h2 id="areas-t" className="text-2xl text-stone-900">O que você encontra lá dentro</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="entrada-areas">
          {FIRST_GOALS.map((g) => (
            <li key={g.key}>
              <Link href={signup(g.href)} className="card hub-link h-full" data-testid={`area-${g.key}`}>
                <span className="ic ic-md" aria-hidden="true"><Glyph d={NAV_ICONS[g.icon]} size={20} /></span>
                <span>
                  <span className="block font-bold text-stone-900">{AREAS[g.key].title}</span>
                  <span className="block text-sm text-stone-600">{AREAS[g.key].text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {anyJobs && (
        <section aria-labelledby="vitrine-t" className="card p-5" data-testid="vitrine-vagas">
          <h2 id="vitrine-t" className="text-2xl text-stone-900">Vagas abertas em Campo Grande</h2>
          <form method="get" action="/" role="search" className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block font-semibold">Qual vaga você procura?</span>
              <input name="vaga" defaultValue={q} maxLength={60} placeholder="Ex.: vendedor, cozinha, motorista" className="input" />
            </label>
            <button type="submit" className="btn-outline min-h-12 px-4">Ver vagas</button>
          </form>
          <p className="mt-4 font-semibold" data-testid="vitrine-total" aria-live="polite">
            {showcase.total > 0
              ? `${plural(showcase.total, 'vaga aberta', 'vagas abertas')}${q ? ` para “${q}”` : ''}`
              : `Nenhuma vaga aberta para “${q}” agora.`}
          </p>
          {showcase.vagas.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {showcase.vagas.map((v, i) => (
                <li key={i} className="py-2" data-testid="vitrine-vaga">
                  <span className="font-semibold text-stone-900">{v.cargo}</span>
                  <span className="text-stone-600"> · {v.bairro ?? 'Campo Grande'} · {EMPLOYMENT_LABEL[v.tipo] ?? v.tipo}</span>
                </li>
              ))}
            </ul>
          )}
          {showcase.total === 0 && q && <p className="mt-1"><Link href="/" className="text-brand-700 underline">Ver todas as vagas abertas</Link></p>}
          <p className="mt-3 text-sm text-stone-600">Empresa, salário e como se candidatar aparecem depois que você entra.</p>
          <Link href={signup('/vagas')} className="btn-primary mt-3 min-h-12 px-5" data-testid="vitrine-cta">Criar conta para ver e se candidatar</Link>
        </section>
      )}

      {numbers.length > 0 && (
        <section aria-label="Números de confiança" data-testid="confianca">
          <ul className={`grid gap-3 ${numbers.length === 3 ? 'sm:grid-cols-3' : numbers.length === 2 ? 'sm:grid-cols-2' : ''}`}>
            {numbers.map((x) => (
              <li key={x.label(2)} className="card p-4 text-center text-lg font-bold text-stone-900">{x.label(x.n)}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="seg-t" className="safety p-5" data-testid="seguranca">
        <h2 id="seg-t" className="flex items-center gap-2 text-xl"><span className="text-oliva-600"><Glyph d={SHIELD} size={22} /></span>Como mantemos você seguro</h2>
        <ul className="mt-3 list-inside list-disc space-y-1">
          {SAFETY.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </section>

      <p className="pb-2 text-center">
        <Link href="/cadastrar" className="btn-primary min-h-12 px-6">Criar conta grátis</Link>
        <span className="mt-2 block text-stone-700">Já tem conta? <Link href="/entrar" className="font-semibold text-brand-700 underline">Entrar</Link></span>
      </p>
    </div>
  );
}

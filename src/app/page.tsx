import Image from 'next/image';
import Link from 'next/link';
import { Glyph } from '@/components/CategoryIcon';
import { Guarantee, PackageCard } from '@/components/PackageCard';
import { getPackages } from '@/lib/booking';
import { getAgenda } from '@/lib/agenda';
import { AgendaCard } from '@/components/AgendaCard';
import { getPilotCity, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const TOOL = 'M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7V21h3.3l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z';
const BAG = 'M4 8h16v11H4zM9 8V5h6v3M4 13h16';
const MEGA = 'M3 10v4h3l7 4V6L6 10zM16 9a3 3 0 0 1 0 6M19 7a6 6 0 0 1 0 10';
const SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5';
const BOLT = 'M13 2 4 14h7l-1 8 9-12h-7z';

/**
 * Fotos reais do céu de Campo Grande, uma por período (manhã, tarde e noite pelo horário da cidade).
 * Fotos do Wikimedia Commons; a licença pede o crédito, que fica no canto da foto.
 */
const SKY = {
  manha: { src: '/ceu/dia.webp', pos: '50% 30%', alt: 'Céu azul sobre os prédios de Campo Grande', credit: 'Rodrigo Santos · CC BY 3.0', href: 'https://commons.wikimedia.org/wiki/File:Skyline_de_CG_visto_da_Av._Salgado_Filho_-_panoramio.jpg' },
  tarde: { src: '/ceu/tarde.webp', pos: '50% 45%', alt: 'Pôr do sol refletido no lago, com prédios de Campo Grande', credit: 'Camilo Carromeu · domínio público', href: 'https://commons.wikimedia.org/wiki/File:Por_do_sol.jpg' },
  noite: { src: '/ceu/noite.webp', pos: '50% 35%', alt: 'Céu azul do anoitecer na Praça Nazareth, em Campo Grande', credit: 'bigfield767 · CC BY-SA 3.0', href: 'https://commons.wikimedia.org/wiki/File:Entardecer_-_Pra%C3%A7a_Nazareth_-_panoramio.jpg' },
} as const;

function skyPeriod(hour: number): keyof typeof SKY {
  return hour >= 5 && hour < 12 ? 'manha' : hour >= 12 && hour < 18 ? 'tarde' : 'noite';
}

function hourIn(timeZone: string) {
  return Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
}

function greeting(h: number) {
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

async function firstName(userId: string | undefined) {
  if (!userId) return null;
  const supabase = await createClient();
  const [{ data: nm }, { data: prof }] = await Promise.all([
    supabase.from('member_names').select('name').eq('user_id', userId).maybeSingle(),
    supabase.from('provider_profiles').select('display_name').eq('id', userId).maybeSingle(),
  ]);
  const name = (nm?.name ?? prof?.display_name ?? '').trim();
  return name ? name.split(/\s+/)[0] : null;
}

/**
 * Tela inicial: saudação, "Preciso de um serviço", "Procuro trabalho" e "Quero contratar", o próximo compromisso,
 * os serviços mais pedidos e a garantia. Cada seção só aparece quando tem conteúdo.
 * "Indicados pela sua rede" e "Palestras esta semana" entram quando esses módulos existirem (fases 4 e 5).
 */
export default async function Home() {
  const city = await getPilotCity();
  const user = await getUser();
  const [pkgs, name, upcoming] = await Promise.all([getPackages(), firstName(user?.id), user ? getAgenda(user.id, 1) : Promise.resolve([])]);
  const featured = [...pkgs.filter((p) => p.featured), ...pkgs.filter((p) => !p.featured)].slice(0, 4);
  const next = upcoming[0];
  const hour = hourIn(city.timezone || 'America/Campo_Grande');
  const period = skyPeriod(hour);
  const sky = SKY[period];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="dawn" data-testid="home-dawn" data-periodo={period}>
        <Image src={sky.src} alt={sky.alt} fill priority sizes="(min-width: 1024px) 896px, 100vw" className="dawn-photo" style={{ objectPosition: sky.pos }} />
        <div className="dawn-text">
          <h1 className="text-[32px] leading-tight text-white sm:text-[42px]">{greeting(hour)}{name ? `, ${name}` : ''}.</h1>
          <p className="mt-1 inline-block rounded-lg bg-[#1c1a17] px-2 py-0.5 text-[17px] font-semibold text-white">Gente de confiança, perto de você.</p>
        </div>
        <a className="dawn-credit" href={sky.href} target="_blank" rel="noopener noreferrer" data-testid="foto-credito">Foto: {sky.credit}</a>
      </header>

      <section aria-label="O que você procura" className="space-y-3">
        <div className="home-main" data-testid="home-servico">
          <div className="flex items-start gap-3">
            <span className="home-main-ic"><Glyph d={TOOL} size={24} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl text-white"><Link href="/servicos" className="hover:underline">Preciso de um serviço</Link></h2>
              <p className="mt-0.5 text-[15px] text-brand-100">Preço fechado e profissional verificado. Você paga depois de pronto.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/servicos" className="btn-hoje min-h-11 flex-1 px-4 sm:flex-none">Ver serviços</Link>
            <Link href="/hoje" className="btn min-h-11 flex-1 border border-white/40 px-4 text-white hover:bg-surface/10 sm:flex-none" data-testid="cta-hoje"><Glyph d={BOLT} size={18} />Preciso para hoje</Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/vagas" className="home-side" data-testid="home-trabalho">
            <span className="ic ic-md mod-trabalho"><Glyph d={BAG} size={22} /></span>
            <span className="serif text-lg leading-snug text-stone-900">Procuro trabalho</span>
            <span className="text-sm text-stone-600">Vagas e meu currículo</span>
          </Link>
          <Link href="/vagas/nova" className="home-side" data-testid="home-contratar">
            <span className="ic ic-md mod-trabalho"><Glyph d={MEGA} size={22} /></span>
            <span className="serif text-lg leading-snug text-stone-900">Quero contratar</span>
            <span className="text-sm text-stone-600">Publicar uma vaga</span>
          </Link>
        </div>
      </section>

      {next && (
        <section aria-labelledby="enc-t" data-testid="next-meeting">
          <h2 id="enc-t" className="mb-3 text-xl text-stone-900">Seu próximo encontro</h2>
          <AgendaCard item={next} />
        </section>
      )}

      {featured.length > 0 && (
        <section aria-labelledby="mais-t" data-testid="most-requested">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="mais-t" className="text-xl text-stone-900">Mais pedidos em {city.name}</h2>
            <Link href="/servicos" className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline">Ver todos</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((p) => <PackageCard key={p.id} p={p} compact />)}
          </div>
        </section>
      )}

      <form action="/buscar" method="get" role="search" data-testid="home-search">
        <div className="home-search">
          <Glyph d={SEARCH} size={20} />
          <input name="q" aria-label="Buscar serviço ou profissional" placeholder="Buscar: chuveiro, diarista, chaveiro" enterKeyHint="search" />
          <input type="hidden" name="cidade" value={city.slug} />
          <button className="btn-primary min-h-10 px-4" type="submit">Buscar</button>
        </div>
      </form>

      <Guarantee />

      <p className="safety flex items-start gap-2 text-sm" data-testid="home-safety">
        <span className="mt-0.5 text-oliva-600"><Glyph d={SHIELD} size={18} /></span>
        <span>Aqui ninguém paga para conseguir emprego, e seu telefone só aparece para quem você aceitar.</span>
      </p>

      <p className="home-quote pb-2 text-[17px]" data-testid="home-quote">Servir bem é a nossa forma de cuidar do próximo.</p>
    </div>
  );
}

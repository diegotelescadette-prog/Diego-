import Link from 'next/link';
import { APP_NAME } from '@/config/brand';
import { CategoryIcon, Glyph } from './CategoryIcon';
import { durationLabel, formatPrice, type ServicePackage } from '@/lib/booking-shared';

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
const CLOCK = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2';
const SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5';

/** Preço sempre em destaque: "a partir de" pequeno em cima, valor grande. */
export function Price({ cents, from, size = 'md' }: { cents: number; from?: boolean; size?: 'md' | 'lg' }) {
  return (
    <span className="price" data-testid="price">
      {from && <span className="price-from">a partir de</span>}
      <span className={size === 'lg' ? 'price-lg' : 'price-md'}>{formatPrice(cents)}</span>
    </span>
  );
}

/** Card de pacote: nome, preço, o que está incluso e o botão Agendar. */
export function PackageCard({ p, compact = false }: { p: ServicePackage; compact?: boolean }) {
  return (
    <article className="pkg" data-testid="package-card" data-slug={p.slug}>
      <div className="flex items-start gap-3">
        <CategoryIcon slug={p.category.slug} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-snug text-stone-900">{p.name}</h3>
          <p className="text-sm text-stone-500">{p.service.name} · <Glyph d={CLOCK} size={13} /> {durationLabel(p.duration_min)}</p>
        </div>
        <Price cents={p.price_cents} from={p.price_from} />
      </div>
      {!compact && p.includes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-stone-700" aria-label="O que está incluso">
          {p.includes.slice(0, 3).map((i) => <li key={i} className="flex gap-2"><span className="text-brand-700"><Glyph d={CHECK} size={16} /></span>{i}</li>)}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Link href={`/agendar/${p.slug}`} className="btn-hoje min-h-11 flex-1 px-4" data-testid="agendar">Agendar</Link>
        {!compact && <Link href={`/agendar/${p.slug}#detalhes`} className="btn-ghost min-h-11 px-3 text-sm">Detalhes</Link>}
      </div>
    </article>
  );
}

/** Bloco "Garantia": aparece na tela inicial e no agendamento. */
export function Guarantee({ compact = false }: { compact?: boolean }) {
  const items = [
    ['Preço combinado é preço pago', 'O valor do pacote não muda na hora.'],
    ['O profissional não apareceu?', 'Reagendamos com prioridade.'],
    ['Problema no serviço?', 'Nossa equipe responde em até 24 horas.'],
  ];
  return (
    <section className="guarantee" aria-labelledby="garantia-t" data-testid="guarantee">
      <h2 id="garantia-t" className="flex items-center gap-2 font-bold text-brand-900">
        <span className="text-brand-700"><Glyph d={SHIELD} size={22} /></span> Garantia {APP_NAME}
      </h2>
      <ul className={compact ? 'mt-2 space-y-1 text-sm' : 'mt-3 grid gap-3 sm:grid-cols-3'}>
        {items.map(([t, h]) => (
          <li key={t} className="flex gap-2">
            <span className="mt-0.5 text-brand-700"><Glyph d={CHECK} size={18} /></span>
            <span><strong className="text-stone-900">{t}</strong>{compact ? ' ' : <br />}<span className="text-stone-600">{h}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    ['Escolha o serviço', 'Veja o preço e o que está incluso antes de agendar.'],
    ['Profissional verificado vai até você', 'No dia e na faixa de horário que você escolher.'],
    ['Pague só depois de pronto', 'Pix ou dinheiro, na entrega.'],
  ];
  return (
    <section aria-labelledby="como-t" data-testid="how-it-works">
      <h2 id="como-t" className="text-lg font-bold text-stone-800">Como funciona</h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {steps.map(([t, h], i) => (
          <li key={t} className="how-step">
            <span className="how-num" aria-hidden="true">{i + 1}</span>
            <span><strong className="block text-stone-900">{t}</strong><span className="text-sm text-stone-600">{h}</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

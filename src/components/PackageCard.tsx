import Link from 'next/link';
import { APP_NAME } from '@/config/brand';
import { CategoryIcon, Glyph } from './CategoryIcon';
import { durationLabel, formatPrice, type ServicePackage } from '@/lib/booking-shared';

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
const CLOCK = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2';
const SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5';

/** O valor é do profissional (sem preço fixo no app): o cartão avisa que ele informa depois de aceitar o pedido. */
export function PriceNote({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`price-note ${size === 'lg' ? 'text-base' : 'text-sm'}`} data-testid="price-note">Valor com o profissional</span>
  );
}

/** Valor informado pelo profissional num pedido. */
export function QuotedPrice({ cents }: { cents: number }) {
  return <span className="price-md" data-testid="quoted-price">{formatPrice(cents)}</span>;
}

/** Card de pacote: nome, o que está incluso e o botão Agendar. O valor é combinado com o profissional. */
export function PackageCard({ p, compact = false }: { p: ServicePackage; compact?: boolean }) {
  return (
    <article className="pkg" data-testid="package-card" data-slug={p.slug}>
      <div className="flex items-start gap-3">
        <CategoryIcon slug={p.category.slug} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-snug text-stone-900">{p.name}</h3>
          <p className="flex flex-wrap items-center gap-x-1 text-sm text-stone-500">{p.service.name} ·<span className="inline-flex items-center gap-1"><Glyph d={CLOCK} size={13} />{durationLabel(p.duration_min)}</span></p>
        </div>
        <PriceNote />
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
    ['Valor combinado é valor pago', 'O profissional informa o valor antes de ir, e ele não muda na hora.'],
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
    ['Escolha o serviço', 'Veja o que está incluso e agende o dia e o horário.'],
    ['O profissional informa o valor', 'Cada profissional define o seu. Se não servir, você cancela sem pagar nada.'],
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

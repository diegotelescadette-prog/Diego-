'use client';
import { useActionState, useMemo, useState } from 'react';
import { createBooking, type BookState } from './actions';
import { bookingDays, PAYMENT_LABEL, SLOT_LABEL, type PackageAddon, type PaymentMethod, type TimeSlot } from '@/lib/booking-shared';

interface Props {
  pkg: { id: number; slug: string; name: string; price_cents: number; price_from: boolean; addons: PackageAddon[] };
  neighborhoods: { id: number; name: string }[];
  todayAvailable: boolean;
  initial: { phone: string; neighborhood: number | null };
}

/** Agendamento em uma tela: quantidade e adicionais, dia e faixa, endereço, pagamento e resumo antes de confirmar. */
export function BookingForm({ pkg, neighborhoods, todayAvailable, initial }: Props) {
  const [state, action, pending] = useActionState<BookState, FormData>(createBooking, undefined);
  const days = useMemo(() => bookingDays(), []);
  const [qty, setQty] = useState(1);
  const [addons, setAddons] = useState<number[]>([]);
  const [date, setDate] = useState(days[0]?.date ?? '');
  const day = days.find((d) => d.date === date) ?? days[0];
  const [slot, setSlot] = useState<TimeSlot | ''>(day?.slots[0] ?? '');
  const [hood, setHood] = useState<string>(initial.neighborhood ? String(initial.neighborhood) : '');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(initial.phone);
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('pix_na_entrega');
  const hoodName = neighborhoods.find((n) => String(n.id) === hood)?.name;

  function pickDay(d: string) {
    setDate(d);
    const next = days.find((x) => x.date === d);
    if (next && (!slot || !next.slots.includes(slot))) setSlot(next.slots[0]);
  }

  return (
    <form action={action} className="space-y-4" data-testid="booking-form">
      <input type="hidden" name="package_id" value={pkg.id} />
      <input type="hidden" name="package_slug" value={pkg.slug} />

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="b1">
        <h2 id="b1" className="font-bold text-stone-800">1. O serviço</h2>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">Quantidade</span>
          <div className="flex items-center gap-2" role="group" aria-label="Quantidade">
            <button type="button" className="btn-outline h-11 w-11 px-0 text-xl" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade" disabled={qty <= 1}>−</button>
            <output className="w-8 text-center text-lg font-bold" aria-live="polite" data-testid="qty">{qty}</output>
            <button type="button" className="btn-outline h-11 w-11 px-0 text-xl" onClick={() => setQty((q) => Math.min(10, q + 1))} aria-label="Aumentar quantidade" disabled={qty >= 10}>+</button>
          </div>
          <input type="hidden" name="qty" value={qty} />
        </div>
        {pkg.addons.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 font-semibold">Adicionais (opcional)</legend>
            {pkg.addons.map((a) => (
              <label key={a.id} className="choice">
                <input type="checkbox" name="addon" value={a.id} checked={addons.includes(a.id)}
                  onChange={(e) => setAddons((s) => e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id))} />
                <span className="flex-1">{a.name}</span>
              </label>
            ))}
          </fieldset>
        )}
      </section>

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="b2">
        <h2 id="b2" className="font-bold text-stone-800">2. Quando</h2>
        <fieldset>
          <legend className="sr-only">Dia</legend>
          <div className="day-row">
            {days.map((d) => (
              <label key={d.date} className={`day${d.today ? ' day-today' : ''}`}>
                <input type="radio" name="date" value={d.date} checked={date === d.date} onChange={() => pickDay(d.date)} />
                <span>{d.today ? 'Hoje' : d.label.split(' · ')[0]}</span>
                {!d.today && <span className="text-xs font-medium text-stone-500">{d.label.split(' · ')[1]}</span>}
                {d.today && <span className="text-xs font-medium">{todayAvailable ? 'tem gente livre' : 'sujeito a vaga'}</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="mb-1 font-semibold">Faixa de horário</legend>
          {(['manha', 'tarde', 'noite'] as TimeSlot[]).map((s) => (
            <label key={s} className="choice">
              <input type="radio" name="slot" value={s} checked={slot === s} disabled={!day?.slots.includes(s)} onChange={() => setSlot(s)} />
              {SLOT_LABEL[s]}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="b3">
        <h2 id="b3" className="font-bold text-stone-800">3. Onde</h2>
        <div>
          <label htmlFor="neighborhood" className="label">Bairro em Campo Grande</label>
          <select id="neighborhood" name="neighborhood" className="input" value={hood} onChange={(e) => setHood(e.target.value)} required>
            <option value="">Escolha o bairro</option>
            {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="address" className="label">Rua, número e complemento</label>
          <input id="address" name="address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} autoComplete="street-address" placeholder="Ex.: Rua das Garças, 120, casa 2" required />
          <p className="hint">O profissional só vê o endereço depois de confirmar o pedido.</p>
        </div>
        <div>
          <label htmlFor="phone" className="label">Seu WhatsApp (com DDD)</label>
          <input id="phone" name="phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} autoComplete="tel" required />
        </div>
        <div>
          <label htmlFor="notes" className="label">Observações (opcional)</label>
          <textarea id="notes" name="notes" rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={600} placeholder="Ex.: o chuveiro já está comprado; portão azul" />
        </div>
      </section>

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="b4">
        <h2 id="b4" className="font-bold text-stone-800">4. Pagamento</h2>
        <p className="text-sm text-stone-600">Você paga só depois do serviço pronto, direto para o profissional.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
            <label key={m} className="choice"><input type="radio" name="payment" value={m} checked={payment === m} onChange={() => setPayment(m)} />{PAYMENT_LABEL[m]}</label>
          ))}
        </div>
      </section>

      <section className="card p-4 sm:p-5" aria-labelledby="b5" data-testid="summary">
        <h2 id="b5" className="font-bold text-stone-800">Resumo</h2>
        <div className="mt-2 divide-y divide-line text-stone-700">
          <div className="summary-row"><span>{pkg.name} × {qty}</span></div>
          {pkg.addons.filter((a) => addons.includes(a.id)).map((a) => (
            <div key={a.id} className="summary-row" data-testid="summary-addon"><span>+ {a.name} × {qty}</span></div>
          ))}
          <div className="summary-row"><span>Quando</span><span className="text-right">{day?.today ? 'Hoje' : day?.label}{slot ? `, ${SLOT_LABEL[slot].split(' (')[0].toLowerCase()}` : ''}</span></div>
          <div className="summary-row"><span>Onde</span><span className="text-right">{hoodName ?? '—'}</span></div>
          <div className="summary-row"><span>Pagamento</span><span>{PAYMENT_LABEL[payment]}</span></div>
          <div className="summary-row items-baseline pt-3">
            <span className="font-bold text-stone-900">Valor</span>
            <span className="text-right text-stone-700" data-testid="total">Combinado com o profissional</span>
          </div>
        </div>
        <p className="mt-1 text-sm text-stone-600" data-testid="valor-explica">Cada profissional define o próprio valor. Ele informa no pedido antes de ir, e você só paga depois do serviço pronto. Se não servir, você cancela sem pagar nada.</p>
        {state?.error && <p role="alert" className="field-error mt-3 rounded-xl bg-red-50 p-3" data-testid="booking-error">{state.error}</p>}
        <button type="submit" className="btn-hoje mt-4 min-h-12 w-full text-lg" disabled={pending || !slot || !date}>
          {pending ? 'Agendando…' : 'Confirmar agendamento'}
        </button>
      </section>
    </form>
  );
}

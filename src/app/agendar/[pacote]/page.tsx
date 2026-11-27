import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookingForm } from './BookingForm';
import { CategoryIcon, Glyph } from '@/components/CategoryIcon';
import { Guarantee, PriceNote } from '@/components/PackageCard';
import { getPackage, packageToday } from '@/lib/booking';
import { durationLabel } from '@/lib/booking-shared';
import { getNeighborhoods, getPilotCity, getUser } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ pacote: string }> }): Promise<Metadata> {
  const p = await getPackage((await params).pacote);
  return { title: p ? `Agendar: ${p.name}` : 'Agendar' };
}

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
const X = 'M6 6l12 12M18 6 6 18';

/** Detalhes do pacote (preço, incluso e não incluso) e o agendamento. Sem conta, pede para entrar e volta aqui. */
export default async function Agendar({ params }: { params: Promise<{ pacote: string }> }) {
  const { pacote } = await params;
  const p = await getPackage(pacote);
  if (!p) notFound();
  const [user, city] = await Promise.all([getUser(), getPilotCity()]);
  const [hoods, today] = await Promise.all([getNeighborhoods(city.id), packageToday(p.id)]);

  // Preenche com os dados do último pedido da pessoa (só ela vê).
  let initial = { phone: '', neighborhood: null as number | null };
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase.from('bookings').select('neighborhood_id, booking_private(contact_phone)')
      .eq('client_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const priv = (data as unknown as { neighborhood_id: number; booking_private: { contact_phone: string } | null } | null);
    if (priv) initial = { phone: priv.booking_private?.contact_phone ?? '', neighborhood: priv.neighborhood_id };
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/servicos/${p.category.slug}`} className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><span aria-hidden="true">←</span> {p.category.name}</Link>
      <section className="card p-4 sm:p-5" id="detalhes" aria-labelledby="pk-t">
        <div className="flex items-start gap-3">
          <CategoryIcon slug={p.category.slug} />
          <div className="min-w-0 flex-1">
            <h1 id="pk-t" className="text-xl font-bold text-stone-900 sm:text-2xl">{p.name}</h1>
            <p className="text-sm text-stone-500">{p.service.name} · {durationLabel(p.duration_min)}</p>
          </div>
          <PriceNote size="lg" />
        </div>
        {p.description && <p className="mt-3 text-stone-700">{p.description}</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">Está incluso</h2>
            <ul className="mt-1 space-y-1 text-stone-800" data-testid="includes">
              {p.includes.map((i) => <li key={i} className="flex gap-2"><span className="mt-0.5 text-brand-700"><Glyph d={CHECK} size={16} /></span>{i}</li>)}
            </ul>
          </div>
          {p.excludes.length > 0 && (
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">Não está incluso</h2>
              <ul className="mt-1 space-y-1 text-stone-700" data-testid="excludes">
                {p.excludes.map((i) => <li key={i} className="flex gap-2"><span className="mt-0.5 text-stone-400"><Glyph d={X} size={16} /></span>{i}</li>)}
              </ul>
            </div>
          )}
        </div>
      </section>

      {user ? (
        <BookingForm pkg={{ id: p.id, slug: p.slug, name: p.name, price_cents: p.price_cents, price_from: p.price_from, addons: p.addons }}
          neighborhoods={hoods.map((n) => ({ id: n.id, name: n.name }))} todayAvailable={today} initial={initial} />
      ) : (
        <section className="card p-5 text-center">
          <p className="text-stone-700">Para agendar, entre ou crie sua conta. Leva um minuto, e você volta direto para cá.</p>
          <Link href={`/entrar?motivo=agendar&next=${encodeURIComponent(`/agendar/${p.slug}`)}`} className="btn-hoje mt-3 min-h-12 w-full text-lg" data-testid="login-to-book">Entrar para agendar</Link>
        </section>
      )}
      <Guarantee compact />
    </div>
  );
}

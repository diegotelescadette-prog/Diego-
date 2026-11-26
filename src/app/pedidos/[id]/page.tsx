import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { BookingItems, BookingTimeline } from '@/components/BookingTimeline';
import { Guarantee } from '@/components/PackageCard';
import { bookingAction, chooseProvider } from '@/app/pedidos/actions';
import { getBooking, getCandidates, getContacts } from '@/lib/booking';
import { dateLabel, SLOT_LABEL } from '@/lib/booking-shared';
import { getIsAdmin, getUser } from '@/lib/data';
import { waLink } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Pedido' };
export const dynamic = 'force-dynamic';

/** Acompanhamento do pedido pelo cliente: status, escolha do profissional, contato depois da confirmação e cancelamento. */
export default async function Pedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; novo?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/pedidos/${id}`)}`);
  const b = await getBooking(id);
  if (!b) notFound();
  if (b.client_id !== user.id) redirect((await getIsAdmin()) ? `/admin/pedidos/${id}` : '/painel/pedidos');

  const open = b.status === 'solicitado';
  const [candidates, contacts] = await Promise.all([open ? getCandidates(id) : Promise.resolve([]), getContacts(id)]);
  const here = `/pedidos/${id}`;
  const confirmed = ['confirmado', 'a_caminho', 'em_andamento', 'concluido'].includes(b.status);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/pedidos" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><span aria-hidden="true">←</span> Meus pedidos</Link>
      {sp.novo && !sp.msg && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900" data-testid="booking-created">Pedido feito! Acompanhe aqui cada etapa.</p>}
      {sp.msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900" data-testid="booking-msg">{sp.msg}</p>}

      <section className="card p-4 sm:p-5" aria-labelledby="ped-t">
        <p className="text-sm font-semibold text-stone-500">Pedido #{b.code}</p>
        <h1 id="ped-t" className="text-xl font-bold text-stone-900">{b.items[0]?.name ?? b.service}</h1>
        <p className="text-stone-700" data-testid="booking-when">{dateLabel(b.scheduled_date)}, {SLOT_LABEL[b.time_slot].toLowerCase()} · {b.neighborhood}</p>
        <div className="mt-4"><BookingTimeline status={b.status} events={b.events} /></div>
      </section>

      {open && !b.provider_id && (
        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="esc-t" data-testid="candidates">
          <h2 id="esc-t" className="font-bold text-stone-800">{candidates.length ? 'Escolha quem vai atender' : 'Procurando um profissional'}</h2>
          {candidates.length ? (
            <>
              <p className="text-sm text-stone-600">Os melhores para o seu pedido: quem atende no dia, comparece e tem as checagens feitas. O preço é o mesmo com qualquer um.</p>
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li key={c.provider_id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3" data-testid="candidate">
                    <Avatar src={c.photo} name={c.display_name} size={52} round />
                    <div className="min-w-0 flex-1">
                      <Link href={`/p/${c.slug}`} className="font-bold text-stone-900 hover:underline">{c.display_name}</Link>
                      <p className="flex flex-wrap gap-x-3 text-sm text-stone-600">
                        {c.available_today && <span className="text-hoje-700">● Atende hoje</span>}
                        {c.identity_checked && <span>✓ Identidade conferida</span>}
                        {c.refs_confirmed > 0 && <span>✓ {c.refs_confirmed} {c.refs_confirmed === 1 ? 'referência' : 'referências'}</span>}
                        <span>{c.completed} {c.completed === 1 ? 'serviço feito' : 'serviços feitos'}</span>
                        {c.show_rate !== null && <span>{c.show_rate}% de comparecimento</span>}
                      </p>
                    </div>
                    <form action={chooseProvider}>
                      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="provider" value={c.provider_id} /><input type="hidden" name="back" value={here} />
                      <button type="submit" className="btn-primary min-h-11 px-4">Escolher</button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-stone-700">Ainda não há profissional livre para esse dia e bairro. Nossa equipe vai encontrar alguém e você vê a confirmação aqui. Se preferir, troque o dia cancelando e agendando de novo.</p>
          )}
        </section>
      )}

      {b.provider_id && contacts?.provider_name && (
        <section className="card p-4 sm:p-5" aria-labelledby="prof-t" data-testid="booking-provider">
          <h2 id="prof-t" className="font-bold text-stone-800">Profissional</h2>
          <p className="mt-1"><Link href={`/p/${contacts.provider_slug}`} className="font-semibold text-stone-900 hover:underline">{contacts.provider_name}</Link></p>
          {confirmed && contacts.provider_whatsapp ? (
            <a className="btn-zap mt-3 w-full" href={waLink(contacts.provider_whatsapp, `Olá! Sobre o pedido #${b.code} pelo Resolve Aqui.`)} target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a>
          ) : open ? (
            <p className="mt-1 text-sm text-stone-600">Aguardando a confirmação. O contato aparece aqui assim que o profissional confirmar.</p>
          ) : null}
        </section>
      )}

      <section className="card p-4 sm:p-5" aria-labelledby="res-t">
        <h2 id="res-t" className="font-bold text-stone-800">Resumo</h2>
        <BookingItems b={b} />
        {contacts?.address_line && <p className="mt-2 text-sm text-stone-600">Endereço: {contacts.address_line}</p>}
        {b.notes && <p className="mt-1 text-sm text-stone-600">Observações: {b.notes}</p>}
        {b.status === 'concluido' && <p className="mt-3 rounded-xl bg-sand p-3 text-sm text-stone-800">Na próxima versão você vai avaliar o serviço aqui (nota, comentário e se o profissional chegou no horário).</p>}
      </section>

      {['solicitado', 'confirmado'].includes(b.status) && (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-stone-700">Cancelar pedido</summary>
          <form action={bookingAction} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={b.id} /><input type="hidden" name="action" value="cancelar" /><input type="hidden" name="back" value={here} />
            <label htmlFor="note" className="label">Motivo (opcional)</label>
            <input id="note" name="note" className="input" maxLength={300} />
            <button type="submit" className="btn-danger min-h-11 px-4">Cancelar pedido</button>
          </form>
        </details>
      )}
      <Guarantee compact />
    </div>
  );
}

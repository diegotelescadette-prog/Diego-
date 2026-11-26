import Link from 'next/link';
import { dayBox } from '@/lib/booking-shared';
import type { AgendaItem } from '@/lib/agenda';

export function AgendaCard({ item, testId }: { item: AgendaItem; testId?: string }) {
  const d = dayBox(item.date);
  return (
    <Link href={item.href} className="card flex items-center gap-4 p-4 hover:border-brand-300" data-testid={testId} data-kind={item.kind}>
      <span className="date-box" aria-hidden="true"><small>{d.weekday}</small><strong>{d.day}</strong><small>{d.month}</small></span>
      <span className="min-w-0 flex-1">
        <span className={`soft-tag ${item.tagClass} text-xs`}>{item.tag}</span>
        <span className="mt-1 block font-bold text-stone-900">{item.title}</span>
        <span className="block text-sm text-stone-600">{item.when}</span>
        <span className="block text-sm font-semibold text-stone-700">{item.status}</span>
      </span>
    </Link>
  );
}

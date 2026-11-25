import Link from 'next/link';
import { Avatar } from './Avatar';
import type { ProviderCardData } from '@/lib/types';
import { photoUrl } from '@/lib/data';

export function ProviderCard({ p, query = '' }: { p: ProviderCardData; query?: string }) {
  return (
    <li className="card flex gap-3 p-4" data-testid="provider-card">
      <Avatar src={photoUrl(p.photo_path)} name={p.display_name} />
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold leading-tight">
          <Link href={`/p/${p.slug}${query}`} className="hover:underline">{p.display_name}</Link>
        </h3>
        {p.main_service && <p className="text-stone-700">{p.main_service}</p>}
        {p.area_label && <p className="text-sm text-stone-600">Atende: {p.area_label}</p>}
        {p.available_today && <p className="mt-1"><span className="badge-hoje">● Atende hoje</span></p>}
        <Link href={`/p/${p.slug}${query}`} className="mt-2 inline-block font-semibold text-brand-700 underline">Ver perfil</Link>
      </div>
    </li>
  );
}

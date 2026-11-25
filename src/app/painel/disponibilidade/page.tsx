import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AvailabilityPanel } from '../AvailabilityPanel';
import { loadPanel } from '../overview';
import { getUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Disponibilidade' };
export const dynamic = 'force-dynamic';

export default async function Disponibilidade() {
  const user = (await getUser())!;
  const d = await loadPanel(user.id);
  if (!d) redirect('/painel/perfil');
  const { p, today, cityName } = d;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Disponibilidade</h1>
        <p className="text-stone-700">Ative o “Atendo hoje”, escolha os serviços e os bairros do dia ou desative. Vale até a meia-noite no horário de {cityName}.</p>
      </div>
      <div className="card border-hoje-500/40 p-5">
        {today.blocked === 'not_published' ? (
          <p>Publique seu perfil para usar o “Atendo hoje”. <Link className="underline" href="/painel">Ver pendências</Link></p>
        ) : today.blocked === 'no_in_person' ? (
          <p>O “Atendo hoje” vale para serviços presenciais. <Link className="underline" href="/painel/servicos">Adicionar serviço</Link></p>
        ) : today.blocked === 'no_area' ? (
          <p>Confirme sua área de atendimento primeiro. <Link className="underline" href="/painel/atendimento">Editar área</Link></p>
        ) : (
          <AvailabilityPanel key={today.active ? 'on' : 'off'} mode="completo" cityName={cityName} services={today.services} areaNeighborhoods={today.areaNeighborhoods}
            servesWholeCity={p.serves_whole_city} active={today.active} />
        )}
      </div>
    </div>
  );
}

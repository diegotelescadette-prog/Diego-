import Link from 'next/link';
import type { Metadata } from 'next';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNeighborhoods, getPilotCity } from '@/lib/data';
import { postedAgo } from '@/lib/jobs';
import { normalizeQuery, purgeOldResumes } from '@/lib/jobs-data';
import { formatPhone } from '@/lib/validation';
import { waLink } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Banco de currículos' };
export const dynamic = 'force-dynamic';

const PAGE = 20;

export default async function Banco({ searchParams }: { searchParams: Promise<{ q?: string; bairro?: string; pagina?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc('can_browse_talent');
  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl card p-6" data-testid="banco-bloqueado">
        <h1 className="text-2xl font-extrabold">Banco de currículos</h1>
        <p className="mt-2 text-stone-700">Para proteger os candidatos, o banco é aberto só para quem tem <strong>uma vaga aberta</strong> publicada aqui. Publique sua vaga (é grátis) e volte para consultar.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/vagas/nova" className="btn-primary">Anunciar uma vaga</Link>
          <Link href="/minhas-vagas" className="btn-outline">Vagas que publiquei</Link>
        </div>
      </div>
    );
  }
  const city = await getPilotCity();
  const neighborhoods = await getNeighborhoods(city.id);
  const page = Math.max(1, Number(sp.pagina) || 1);
  const q = normalizeQuery(sp.q ?? '').slice(0, 80);
  const nb = neighborhoods.find((n) => n.slug === sp.bairro);
  let query = supabase.from('talent_profiles')
    .select('user_id, full_name, desired_role, summary, email, phone, updated_at, neighborhoods(name)', { count: 'exact' })
    .eq('visible', true).gt('expires_at', new Date().toISOString())
    .order('updated_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (q) for (const w of q.split(' ').slice(0, 5)) query = query.ilike('search_norm', `%${w}%`);
  if (nb) query = query.eq('neighborhood_id', nb.id);
  const { data, count, error } = await query;
  const total = count ?? 0;
  after(purgeOldResumes);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/vagas" className="text-sm text-brand-700 underline">← Vagas de emprego</Link>
      <h1 className="text-2xl font-extrabold">Banco de currículos</h1>
      <p className="text-stone-700">Pessoas que autorizaram ser encontradas por quem está contratando. Use os dados só para oferecer trabalho, sem repassar a terceiros.</p>
      <form action="/vagas/banco" method="get" role="search" className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="q" className="label">Cargo ou experiência</label>
          <input id="q" name="q" className="input" defaultValue={sp.q ?? ''} placeholder="Ex.: vendedor, cozinha, motorista" />
        </div>
        <div>
          <label htmlFor="bairro" className="label">Bairro</label>
          <select id="bairro" name="bairro" className="input" defaultValue={nb?.slug ?? ''}>
            <option value="">Todos</option>
            {neighborhoods.map((n) => <option key={n.id} value={n.slug}>{n.name}</option>)}
          </select>
        </div>
        <button className="btn-outline" type="submit">Buscar</button>
      </form>
      {error && <p role="alert" className="card p-4 text-red-800">Não foi possível carregar o banco. Tente novamente.</p>}
      {!error && <p role="status" className="text-stone-700" data-testid="banco-total">{total === 0 ? 'Nenhum currículo encontrado.' : total === 1 ? '1 currículo' : `${total} currículos`}</p>}
      <ul className="grid gap-3">
        {(data ?? []).map((t) => {
          const n = t.neighborhoods as unknown as { name: string } | null;
          return (
            <li key={t.user_id} className="card p-4" data-testid="talento">
              <p className="text-lg font-bold">{t.full_name}</p>
              <p className="text-stone-800">Procura: <strong>{t.desired_role}</strong></p>
              <p className="text-sm text-stone-600">{n ? `${n.name}, ` : ''}{city.name} · atualizado {postedAgo(t.updated_at)}</p>
              {t.summary && <p className="mt-2 whitespace-pre-line text-stone-800">{t.summary}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <a className="btn-primary" href={`/api/vagas/banco/${t.user_id}`}>Baixar currículo</a>
                <a className="underline" href={`mailto:${t.email}`}>{t.email}</a>
                {t.phone && <a className="underline" target="_blank" rel="noopener noreferrer" href={waLink(t.phone, `Olá, ${t.full_name.split(' ')[0]}! Vi seu currículo no banco de currículos e tenho uma vaga que pode te interessar.`)}>WhatsApp {formatPhone(t.phone)}</a>}
              </div>
            </li>
          );
        })}
      </ul>
      {total > PAGE && (
        <nav className="flex justify-between" aria-label="Páginas">
          {page > 1 ? <Link className="btn-outline" href={`/vagas/banco?${new URLSearchParams({ q: sp.q ?? '', bairro: nb?.slug ?? '', pagina: String(page - 1) })}`}>Anteriores</Link> : <span />}
          {page * PAGE < total && <Link className="btn-outline" href={`/vagas/banco?${new URLSearchParams({ q: sp.q ?? '', bairro: nb?.slug ?? '', pagina: String(page + 1) })}`}>Próximos</Link>}
        </nav>
      )}
    </div>
  );
}

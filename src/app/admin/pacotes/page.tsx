import type { Metadata } from 'next';
import Link from 'next/link';
import { saveAddon, saveBookingRules, savePackage } from './actions';
import { Restricted } from '@/components/Restricted';
import { formatPrice } from '@/lib/booking-shared';
import { getCatalog, getIsAdmin, getSetting } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Pacotes e preços' };
export const dynamic = 'force-dynamic';

type Pkg = { id: number; service_id: number; slug: string; name: string; description: string; includes: string[]; excludes: string[];
  duration_min: number; price_cents: number; price_from: boolean; featured: boolean; active: boolean;
  package_addons: { id: number; name: string; price_cents: number; active: boolean }[] };

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: c % 100 ? 2 : 0 });

function PackageFields({ p }: { p?: Pkg }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label" htmlFor={`n-${p?.id ?? 'novo'}`}>Nome</label><input id={`n-${p?.id ?? 'novo'}`} name="name" className="input" defaultValue={p?.name} maxLength={80} required /></div>
      <div><label className="label" htmlFor={`pr-${p?.id ?? 'novo'}`}>Preço (R$)</label><input id={`pr-${p?.id ?? 'novo'}`} name="price" className="input" inputMode="decimal" defaultValue={p ? reais(p.price_cents) : ''} required /></div>
      <div><label className="label" htmlFor={`du-${p?.id ?? 'novo'}`}>Duração (minutos)</label><input id={`du-${p?.id ?? 'novo'}`} name="duration_min" type="number" min={10} max={720} className="input" defaultValue={p?.duration_min ?? 60} required /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor={`de-${p?.id ?? 'novo'}`}>Descrição</label><textarea id={`de-${p?.id ?? 'novo'}`} name="description" rows={2} className="input" defaultValue={p?.description} maxLength={400} /></div>
      <div><label className="label" htmlFor={`in-${p?.id ?? 'novo'}`}>Está incluso (um por linha)</label><textarea id={`in-${p?.id ?? 'novo'}`} name="includes" rows={3} className="input" defaultValue={p?.includes.join('\n')} /></div>
      <div><label className="label" htmlFor={`ex-${p?.id ?? 'novo'}`}>Não está incluso (um por linha)</label><textarea id={`ex-${p?.id ?? 'novo'}`} name="excludes" rows={3} className="input" defaultValue={p?.excludes.join('\n')} /></div>
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="price_from" value="1" defaultChecked={p?.price_from} className="h-5 w-5" /> Preço “a partir de”</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="featured" value="1" defaultChecked={p?.featured} className="h-5 w-5" /> Mostrar em “Mais pedidos”</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="active" value="1" defaultChecked={p ? p.active : true} className="h-5 w-5" /> Ativo</label>
      </div>
    </div>
  );
}

/** Catálogo de pacotes com preço fixo e as regras dos pedidos (comissão e prazo para aceitar). */
export default async function AdminPacotes({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  if (!(await getIsAdmin())) return <Restricted what="Preços e regras dos pedidos" />;
  const { msg } = await searchParams;
  const supabase = await createClient();
  const [cats, { data }, pct, prazo] = await Promise.all([
    getCatalog(true),
    supabase.from('service_packages').select('id, service_id, slug, name, description, includes, excludes, duration_min, price_cents, price_from, featured, active, package_addons(id, name, price_cents, active)').order('sort'),
    getSetting<{ percent: number }>('comissao'), getSetting<{ minutes: number }>('prazo_aceite'),
  ]);
  const pkgs = (data ?? []) as Pkg[];
  const services = cats.flatMap((c) => c.services.map((s) => ({ ...s, cat: c.name })));
  const withPkgs = cats.map((c) => ({ ...c, services: c.services.map((s) => ({ ...s, pkgs: pkgs.filter((p) => p.service_id === s.id) })).filter((s) => s.pkgs.length) }))
    .filter((c) => c.services.length);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-2xl font-bold text-stone-800">Pacotes e preços</h1><p className="text-stone-600">{pkgs.length} pacotes. Mudanças aparecem na hora para os clientes e ficam no histórico.</p></div>
        <Link href="/admin/pedidos" className="btn-outline min-h-11 px-4">Ver pedidos</Link>
      </header>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900" data-testid="pkg-msg">{msg}</p>}

      <form action={saveBookingRules} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid="rules-form">
        <div><label htmlFor="pct" className="label">Comissão sobre serviços concluídos (%)</label><input id="pct" name="percent" inputMode="decimal" className="input" defaultValue={pct?.percent ?? 12} /></div>
        <div><label htmlFor="min" className="label">Prazo para o profissional aceitar (min)</label><input id="min" name="minutes" type="number" min={2} max={120} className="input" defaultValue={prazo?.minutes ?? 10} /></div>
        <button type="submit" className="btn-primary min-h-11 px-4">Salvar regras</button>
        <p className="text-sm text-stone-600 sm:col-span-3">O prazo para aceitar passa a valer quando os profissionais receberem os pedidos em tempo real (fase 2).</p>
      </form>

      <details className="card p-4" data-testid="new-package">
        <summary className="cursor-pointer font-semibold">+ Novo pacote</summary>
        <form action={savePackage} className="mt-3 space-y-3">
          <div><label htmlFor="svc" className="label">Serviço</label>
            <select id="svc" name="service_id" className="input" required>
              {services.map((s) => <option key={s.id} value={s.id}>{s.cat} · {s.name}</option>)}
            </select></div>
          <PackageFields />
          <button type="submit" className="btn-primary min-h-11 px-4">Criar pacote</button>
        </form>
      </details>

      {withPkgs.map((c) => (
        <section key={c.id} className="space-y-2">
          <h2 className="text-lg font-bold">{c.name}{!c.active && <span className="ml-2 text-sm font-normal text-stone-500">(categoria desativada)</span>}</h2>
          {c.services.map((s) => s.pkgs.map((p) => (
            <details key={p.id} className="card p-4" data-testid="admin-package" data-slug={p.slug}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="font-semibold">{p.name}</span><span className="text-sm text-stone-500">{s.name}</span>
                <span className="ml-auto font-bold">{p.price_from ? 'a partir de ' : ''}{formatPrice(p.price_cents)}</span>
                {!p.active && <span className="st-tag st-cancelado">inativo</span>}{p.featured && <span className="st-tag st-concluido">mais pedidos</span>}
              </summary>
              <form action={savePackage} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={p.id} />
                <PackageFields p={p} />
                <button type="submit" className="btn-primary min-h-11 px-4">Salvar</button>
              </form>
              <div className="mt-4 border-t border-line pt-3">
                <h3 className="font-semibold">Adicionais</h3>
                <ul className="mt-2 space-y-2">
                  {p.package_addons.map((a) => (
                    <li key={a.id}><form action={saveAddon} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <input name="name" aria-label="Nome do adicional" className="input min-w-0 flex-1" defaultValue={a.name} />
                      <input name="price" aria-label="Preço do adicional" className="input w-28" defaultValue={reais(a.price_cents)} />
                      <label className="flex min-h-11 items-center gap-1 text-sm"><input type="checkbox" name="active" value="1" defaultChecked={a.active} /> ativo</label>
                      <button type="submit" className="btn-outline min-h-11 px-3">Salvar</button>
                    </form></li>
                  ))}
                  <li><form action={saveAddon} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="package_id" value={p.id} />
                    <input name="name" aria-label="Novo adicional" placeholder="Novo adicional" className="input min-w-0 flex-1" />
                    <input name="price" aria-label="Preço do novo adicional" placeholder="R$" className="input w-28" />
                    <button type="submit" className="btn-outline min-h-11 px-3">Adicionar</button>
                  </form></li>
                </ul>
              </div>
            </details>
          )))}
        </section>
      ))}
    </div>
  );
}

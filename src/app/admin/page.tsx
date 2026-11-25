import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { addSynonym, createService, removeSynonym, resolveReport, resolveSuggestion, saveCpfSetting, setProviderStatus, toggleCategory, toggleService } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { getCatalog, getIsAdmin, getSetting, type CpfSetting } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LABEL, type ProviderStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Administração' };
export const dynamic = 'force-dynamic';

const TABS = [
  ['catalogo', 'Catálogo'], ['sugestoes', 'Sugestões'], ['denuncias', 'Denúncias'], ['perfis', 'Perfis'], ['historico', 'Histórico'], ['config', 'Configurações'],
] as const;
const REASON: Record<string, string> = {
  informacoes_falsas: 'Informações falsas', golpe_ou_cobranca: 'Golpe ou cobrança', comportamento_inadequado: 'Comportamento inadequado',
  conteudo_improprio: 'Conteúdo impróprio', outro: 'Outro',
};

export default async function Admin({ searchParams }: { searchParams: Promise<{ aba?: string; msg?: string; q?: string }> }) {
  if (!(await getIsAdmin())) notFound();
  const sp = await searchParams;
  const aba = sp.aba ?? 'catalogo';
  const sb = await createClient();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Administração</h1>
      <nav aria-label="Seções" className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/admin?aba=${k}`} aria-current={aba === k ? 'page' : undefined}
            className={`whitespace-nowrap rounded-xl px-3 py-2 font-semibold ${aba === k ? 'bg-brand-700 text-white' : 'bg-white text-brand-800 border border-stone-200'}`}>{l}</Link>
        ))}
      </nav>
      {sp.msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-brand-900">{sp.msg}</p>}
      {aba === 'catalogo' && <Catalogo sb={sb} />}
      {aba === 'sugestoes' && <Sugestoes sb={sb} />}
      {aba === 'denuncias' && <Denuncias sb={sb} />}
      {aba === 'perfis' && <Perfis sb={sb} q={sp.q} />}
      {aba === 'historico' && <Historico sb={sb} />}
      {aba === 'config' && <Config />}
    </div>
  );
}

type SB = Awaited<ReturnType<typeof createClient>>;

async function Catalogo({ sb }: { sb: SB }) {
  const catalog = await getCatalog(true);
  const { data: syns } = await sb.from('service_synonyms').select('id, service_id, term').order('term');
  return (
    <div className="space-y-3">
      <form action={createService} className="card grid gap-2 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div><label className="label" htmlFor="ns-cat">Categoria</label>
          <select id="ns-cat" name="category_id" className="input">{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="ns-name">Novo serviço</label><input id="ns-name" name="name" className="input" required /></div>
        <div><label className="label" htmlFor="ns-mode">Modo</label>
          <select id="ns-mode" name="mode" className="input"><option value="presencial">Presencial</option><option value="online">Online</option><option value="ambos">Ambos</option></select></div>
        <SubmitButton>Adicionar</SubmitButton>
      </form>
      {catalog.map((c) => (
        <details key={c.id} className="card p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-2 font-bold">
            <span>{c.name} {!c.active && <span className="text-sm font-normal text-red-700">(desativada)</span>}</span>
            <span className="text-sm font-normal text-stone-600">{c.services.length} serviços</span>
          </summary>
          <form action={toggleCategory} className="mt-2">
            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? '0' : '1'} />
            <SubmitButton className="btn-ghost">{c.active ? 'Desativar categoria' : 'Reativar categoria'}</SubmitButton>
          </form>
          <ul className="mt-2 divide-y divide-stone-100">
            {c.services.map((s) => (
              <li key={s.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${s.active ? '' : 'text-stone-400 line-through'}`}>{s.name}</span>
                  <span className="text-xs text-stone-500">{s.mode}{s.urgent_pilot ? ' · piloto hoje' : ''}</span>
                  <form action={toggleService} className="ml-auto">
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={s.active ? '0' : '1'} />
                    <SubmitButton className="btn-ghost min-h-9 py-1 text-sm">{s.active ? 'Desativar' : 'Reativar'}</SubmitButton>
                  </form>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {(syns ?? []).filter((x) => x.service_id === s.id).map((x) => (
                    <form key={x.id} action={removeSynonym} className="inline">
                      <input type="hidden" name="id" value={x.id} />
                      <button className="chip text-xs" aria-label={`Remover sinônimo ${x.term}`}>{x.term} ✕</button>
                    </form>
                  ))}
                  <form action={addSynonym} className="inline-flex gap-1">
                    <input type="hidden" name="service_id" value={s.id} />
                    <label className="sr-only" htmlFor={`syn-${s.id}`}>Novo sinônimo para {s.name}</label>
                    <input id={`syn-${s.id}`} name="term" placeholder="+ sinônimo" className="w-32 rounded-lg border border-stone-300 px-2 py-1 text-sm" />
                    <button className="rounded-lg bg-stone-100 px-2 text-sm" type="submit">Adicionar</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
      <p className="text-sm text-stone-600">Desativar oculta da seleção e da busca por termo, sem apagar os vínculos dos perfis existentes.</p>
    </div>
  );
}

async function Sugestoes({ sb }: { sb: SB }) {
  const [{ data }, catalog] = await Promise.all([
    sb.from('service_suggestions').select('id, name, note, status, created_at').order('created_at', { ascending: false }).limit(100),
    getCatalog(),
  ]);
  const pend = (data ?? []).filter((s) => s.status === 'pendente');
  return (
    <div className="space-y-3">
      {pend.length === 0 && <p className="card p-4">Nenhuma sugestão pendente.</p>}
      {pend.map((s) => (
        <div key={s.id} className="card space-y-3 p-4">
          <p className="font-bold">{s.name}</p>
          {s.note && <p className="text-stone-700">{s.note}</p>}
          <form action={resolveSuggestion} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="incorporar" />
            <div><label className="label" htmlFor={`n-${s.id}`}>Nome final</label><input id={`n-${s.id}`} name="name" defaultValue={s.name} className="input" /></div>
            <div><label className="label" htmlFor={`c-${s.id}`}>Categoria</label>
              <select id={`c-${s.id}`} name="category_id" className="input">{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <select name="mode" className="input w-auto" aria-label="Modo"><option value="presencial">Presencial</option><option value="online">Online</option><option value="ambos">Ambos</option></select>
            <SubmitButton>Incorporar ao catálogo</SubmitButton>
          </form>
          <form action={resolveSuggestion} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="associar" />
            <div><label className="label" htmlFor={`a-${s.id}`}>Associar como sinônimo de</label>
              <select id={`a-${s.id}`} name="service_id" className="input">
                {catalog.map((c) => <optgroup key={c.id} label={c.name}>{c.services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
              </select></div>
            <SubmitButton className="btn-outline">Associar</SubmitButton>
          </form>
          <form action={resolveSuggestion}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="recusar" />
            <SubmitButton className="btn-ghost">Recusar</SubmitButton></form>
        </div>
      ))}
    </div>
  );
}

async function Denuncias({ sb }: { sb: SB }) {
  const { data } = await sb.from('reports').select('id, reason, details, status, created_at, provider_id, provider_profiles(display_name, slug, status)')
    .order('created_at', { ascending: false }).limit(100);
  return (
    <div className="space-y-3">
      {(data ?? []).length === 0 && <p className="card p-4">Nenhuma denúncia.</p>}
      {(data ?? []).map((r) => {
        const p = r.provider_profiles as unknown as { display_name: string; slug: string; status: ProviderStatus };
        return (
          <div key={r.id} className="card p-4">
            <p className="font-bold">#{r.id} · {REASON[r.reason]} · <span className="font-normal">{r.status}</span></p>
            <p>Perfil: <Link className="underline" href={`/p/${p?.slug}`}>{p?.display_name}</Link> ({STATUS_LABEL[p?.status]})</p>
            {r.details && <p className="mt-1 text-stone-700">{r.details}</p>}
            {r.status === 'aberta' && (
              <form action={resolveReport} className="mt-3 space-y-2">
                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="provider_id" value={r.provider_id} />
                <label className="label" htmlFor={`note-${r.id}`}>Nota da avaliação</label>
                <input id={`note-${r.id}`} name="note" className="input" />
                <label className="flex items-center gap-2"><input type="checkbox" name="suspend" className="h-5 w-5" /> Suspender o perfil</label>
                <div className="flex gap-2">
                  <SubmitButton name="status" value="procedente" className="btn-danger">Procedente</SubmitButton>
                  <SubmitButton name="status" value="improcedente" className="btn-outline">Improcedente</SubmitButton>
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

async function Perfis({ sb, q }: { sb: SB; q?: string }) {
  let query = sb.from('provider_profiles').select('id, display_name, slug, status, updated_at').order('updated_at', { ascending: false }).limit(50);
  if (q) query = query.ilike('display_name', `%${q}%`);
  const { data } = await query;
  return (
    <div className="space-y-3">
      <form className="flex gap-2" action="/admin" method="get">
        <input type="hidden" name="aba" value="perfis" />
        <label htmlFor="pq" className="sr-only">Buscar perfil</label>
        <input id="pq" name="q" defaultValue={q} className="input" placeholder="Nome do prestador" />
        <button className="btn-primary">Buscar</button>
      </form>
      {(data ?? []).map((p) => (
        <div key={p.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Link href={`/p/${p.slug}`} className="font-bold underline">{p.display_name || '(sem nome)'}</Link>
            <p className="text-sm">{STATUS_LABEL[p.status as ProviderStatus]}</p>
          </div>
          <form action={setProviderStatus} className="flex flex-wrap gap-2">
            <input type="hidden" name="provider_id" value={p.id} />
            <label className="sr-only" htmlFor={`m-${p.id}`}>Motivo</label>
            <input id={`m-${p.id}`} name="note" required placeholder="Motivo (obrigatório)" className="input w-56" />
            {p.status === 'suspended'
              ? <SubmitButton name="status" value="published" className="btn-outline">Reativar</SubmitButton>
              : <SubmitButton name="status" value="suspended" className="btn-danger">Suspender</SubmitButton>}
          </form>
        </div>
      ))}
    </div>
  );
}

async function Historico({ sb }: { sb: SB }) {
  const { data } = await sb.from('moderation_log').select('id, action, target_type, target_id, note, created_at').order('id', { ascending: false }).limit(150);
  return (
    <div className="card overflow-x-auto p-2">
      <table className="w-full text-left text-sm">
        <thead><tr><th className="p-2">Quando</th><th className="p-2">Ação</th><th className="p-2">Alvo</th><th className="p-2">Detalhe</th></tr></thead>
        <tbody>
          {(data ?? []).map((l) => (
            <tr key={l.id} className="border-t border-stone-100">
              <td className="whitespace-nowrap p-2">{new Date(l.created_at).toLocaleString('pt-BR', { timeZone: 'America/Campo_Grande' })}</td>
              <td className="p-2">{l.action}</td><td className="p-2">{l.target_type} #{l.target_id.slice(0, 8)}</td><td className="p-2">{l.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Config() {
  const cpf = await getSetting<CpfSetting>('cpf_collection');
  return (
    <form action={saveCpfSetting} className="card max-w-2xl space-y-3 p-5">
      <h2 className="text-lg font-bold">Coleta de CPF dos prestadores</h2>
      <p className="text-stone-700">Desligada por padrão (princípio da necessidade, LGPD art. 6º, III). Para habilitar, o responsável pela operação define a finalidade e confirma a necessidade. O texto da finalidade aparece no aviso ao prestador.</p>
      <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={cpf?.enabled} className="h-5 w-5" /> Coletar CPF no cadastro</label>
      <label htmlFor="purpose" className="label">Finalidade</label>
      <textarea id="purpose" name="purpose" rows={3} defaultValue={cpf?.purpose ?? ''} className="input" />
      <label className="flex items-start gap-2"><input type="checkbox" name="necessity_confirmed" defaultChecked={cpf?.necessity_confirmed} className="mt-1 h-5 w-5" /> Confirmo que o CPF é necessário para essa finalidade e que não há alternativa menos invasiva.</label>
      <SubmitButton>Salvar</SubmitButton>
    </form>
  );
}

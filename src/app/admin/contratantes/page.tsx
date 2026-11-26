import type { Metadata } from 'next';
import { Restricted } from '@/components/Restricted';
import { decryptCpf } from '@/lib/cpf-crypto';
import { getIsAdmin, getNeighborhoods } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { formatCnpj } from '@/lib/validation';
import { reviewEmployer } from './actions';

export const metadata: Metadata = { title: 'Contratantes' };
export const dynamic = 'force-dynamic';

const cpfMask = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
function cpfOf(cipher: string | null): string {
  try { return cipher ? cpfMask(decryptCpf(cipher)) : ''; } catch { return 'não foi possível ler'; }
}

/** Fila de verificação de quem contrata: CNPJ ativo (ou CPF) e endereço real. */
export default async function Contratantes({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  if (!(await getIsAdmin())) return <Restricted what="Dados de quem contrata" />;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data }, hoods] = await Promise.all([
    supabase.from('employer_verifications').select('user_id, kind, cnpj, cpf_ciphertext, legal_name, address_line, neighborhood_id, status, note, created_at, updated_at')
      .order('status', { ascending: false }).order('updated_at', { ascending: true }).limit(200),
    getNeighborhoods(),
  ]);
  const rows = data ?? [];
  const nb = (id: number | null) => hoods.find((h) => h.id === id)?.name ?? '';
  const { data: held } = await supabase.from('jobs').select('poster_id').eq('held', true);
  const heldBy = (u: string) => (held ?? []).filter((j) => j.poster_id === u).length;
  const pending = rows.filter((r) => r.status === 'pendente');
  const done = rows.filter((r) => r.status !== 'pendente');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl text-stone-900">Contratantes</h1>
      <p className="text-stone-600">Confira o CNPJ na Receita (situação ativa) ou o CPF, e se o endereço existe. As vagas de quem está em conferência ficam guardadas.</p>
      {sp.msg && <p role="status" className="rounded-xl bg-sage p-3 text-stone-900" data-testid="employer-msg">{sp.msg}</p>}
      <h2 className="text-lg text-stone-900">Para conferir ({pending.length})</h2>
      {pending.length === 0 && <p className="text-stone-600">Nada na fila.</p>}
      <ul className="space-y-3">
        {pending.map((r) => (
          <li key={r.user_id} className="card space-y-2 p-4" data-testid="employer-row">
            <p className="font-bold text-stone-900">{r.legal_name}</p>
            <p className="text-stone-700">{r.kind === 'cnpj' ? `CNPJ ${formatCnpj(r.cnpj ?? '')}` : `CPF ${cpfOf(r.cpf_ciphertext)}`}</p>
            <p className="text-stone-700">{r.address_line}{r.neighborhood_id ? ` · ${nb(r.neighborhood_id)}` : ''}</p>
            <p className="text-sm text-stone-600">{heldBy(r.user_id)} {heldBy(r.user_id) === 1 ? 'vaga guardada' : 'vagas guardadas'} · enviado em {new Date(r.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Campo_Grande' })}</p>
            <div className="flex flex-wrap items-end gap-2">
              <form action={reviewEmployer}>
                <input type="hidden" name="user" value={r.user_id} /><input type="hidden" name="status" value="verificado" />
                <button type="submit" className="btn-primary min-h-11 px-4">Verificar</button>
              </form>
              <form action={reviewEmployer} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="user" value={r.user_id} /><input type="hidden" name="status" value="recusado" />
                <div><label className="label" htmlFor={`note-${r.user_id}`}>Motivo da recusa</label><input id={`note-${r.user_id}`} name="note" className="input" maxLength={300} placeholder="Ex.: CNPJ inativo na Receita" /></div>
                <button type="submit" className="btn-outline min-h-11 px-4">Recusar</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <h2 className="pt-2 text-lg text-stone-900">Já conferidos</h2>
          <ul className="card divide-y divide-line">
            {done.map((r) => (
              <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>{r.legal_name} · {r.kind === 'cnpj' ? `CNPJ ${formatCnpj(r.cnpj ?? '')}` : 'CPF'}</span>
                <span className={r.status === 'verificado' ? 'verified' : 'soft-tag mod-eventos'}>{r.status === 'verificado' ? 'Verificado' : `Recusado${r.note ? `: ${r.note}` : ''}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

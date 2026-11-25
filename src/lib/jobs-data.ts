import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { hitLimit } from '@/lib/rate-limit';

export const JOB_LIST_FIELDS = 'id, title, company_name, employment_type, work_mode, salary_text, created_at, neighborhoods(name), cities(name, uf)';

type Place = { neighborhoods?: unknown; cities?: unknown };
/** "Centro, Campo Grande–MS" ou "Campo Grande–MS". */
export function placeOf(row: Place): string {
  const n = row.neighborhoods as { name: string } | null;
  const c = row.cities as { name: string; uf: string } | null;
  const city = c ? `${c.name}–${c.uf}` : '';
  return n ? `${n.name}, ${city}` : city;
}

/** Normalização igual à do banco (normalize_text): minúsculas, sem acento, só letras e números. */
export function normalizeQuery(q: string): string {
  return q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Retenção (LGPD): apaga currículos de vagas encerradas há mais de 90 dias.
 *  Roda no máximo uma vez por hora, depois de responder a página. */
export async function purgeOldResumes() {
  try {
    if (!(await hitLimit('limpeza-curriculos', 'global', 1, 3600))) return;
    const admin = createAdminClient();
    const { data } = await admin.rpc('purge_old_applications');
    const paths = ((data ?? []) as { resume_path: string }[]).map((r) => r.resume_path);
    for (let i = 0; i < paths.length; i += 100) await admin.storage.from('curriculos').remove(paths.slice(i, i + 100));
  } catch {
    // tenta de novo na próxima janela
  }
}

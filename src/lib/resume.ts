// Currículo dentro do app: tipos, validação e barra de progresso. Módulo puro (servidor, navegador e testes).

export interface Experience { role: string; company: string; start: string; end: string; current: boolean; description: string }
export interface Education { course: string; school: string; end: string; status: 'completo' | 'cursando' | 'incompleto' }
export interface Reference { name: string; relation: string; phone: string }
export interface ResumeData {
  full_name: string; headline: string; summary: string; email: string; phone: string; neighborhood_id: number | null;
  photo_path: string | null; experiences: Experience[]; education: Education[]; skills: string[]; references_list: Reference[];
}

export const EDUCATION_STATUS: Record<Education['status'], string> = { completo: 'Completo', cursando: 'Cursando', incompleto: 'Incompleto' };
export const RESUME_LIMITS = { experiences: 15, education: 10, skills: 30, references: 5 } as const;

export function emptyResume(name = '', email = ''): ResumeData {
  return { full_name: name, headline: '', summary: '', email, phone: '', neighborhood_id: null, photo_path: null,
    experiences: [], education: [], skills: [], references_list: [] };
}

const t = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ym = (v: unknown) => { const s = String(v ?? '').trim(); return /^\d{4}(-\d{2})?$/.test(s) ? s : ''; };
const digits = (v: unknown) => String(v ?? '').replace(/\D+/g, '');

/** Valida o currículo enviado pelo formulário (listas chegam como JSON). Linhas vazias são descartadas. */
export function parseResume(form: Record<string, unknown>): { data?: ResumeData; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const list = (k: string) => { try { const v = JSON.parse(String(form[k] ?? '[]')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const full_name = t(form.full_name, 100);
  const headline = t(form.headline, 100);
  const summary = String(form.summary ?? '').trim().slice(0, 1500);
  const email = t(form.email, 160);
  const phone = digits(form.phone);
  const nb = String(form.neighborhood_id ?? '');
  const experiences: Experience[] = list('experiences').map((e) => ({
    role: t(e?.role, 80), company: t(e?.company, 80), start: ym(e?.start), end: e?.current ? '' : ym(e?.end), current: !!e?.current,
    description: String(e?.description ?? '').trim().slice(0, 500),
  })).filter((e) => e.role || e.company);
  const education: Education[] = list('education').map((e) => ({
    course: t(e?.course, 80), school: t(e?.school, 80), end: ym(e?.end),
    status: (['completo', 'cursando', 'incompleto'].includes(e?.status) ? e.status : 'completo') as Education['status'],
  })).filter((e) => e.course || e.school);
  const skills = [...new Set(list('skills').map((x) => t(x, 40)).filter(Boolean))];
  const references_list: Reference[] = list('references_list').map((r) => ({ name: t(r?.name, 80), relation: t(r?.relation, 80), phone: digits(r?.phone) }))
    .filter((r) => r.name || r.phone);

  if (full_name.length < 3) errors.full_name = 'Informe seu nome completo';
  if (headline.length < 3) errors.headline = 'Conte o trabalho que você procura, ex.: Auxiliar administrativo';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'E-mail inválido';
  if (phone && (phone.length < 10 || phone.length > 11)) errors.phone = 'Telefone com DDD, ex.: (67) 99999-1234';
  if (nb && !/^\d+$/.test(nb)) errors.neighborhood_id = 'Bairro inválido';
  if (experiences.length > RESUME_LIMITS.experiences) errors.experiences = `Até ${RESUME_LIMITS.experiences} experiências`;
  else if (experiences.some((e) => !e.role || !e.company)) errors.experiences = 'Em cada experiência, informe o cargo e o lugar';
  if (education.length > RESUME_LIMITS.education) errors.education = `Até ${RESUME_LIMITS.education} cursos`;
  else if (education.some((e) => !e.course)) errors.education = 'Em cada formação, informe o curso';
  if (skills.length > RESUME_LIMITS.skills) errors.skills = `Até ${RESUME_LIMITS.skills} habilidades`;
  if (references_list.length > RESUME_LIMITS.references) errors.references_list = `Até ${RESUME_LIMITS.references} referências`;
  else if (references_list.some((r) => !r.name || r.phone.length < 10 || r.phone.length > 11)) errors.references_list = 'Em cada referência, informe o nome e o telefone com DDD';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    data: { full_name, headline, summary, email, phone, neighborhood_id: nb ? Number(nb) : null, photo_path: null, experiences, education, skills, references_list },
  };
}

const PARTS: { key: string; weight: number; done: (r: ResumeData) => boolean; missing: string }[] = [
  { key: 'dados', weight: 20, done: (r) => r.full_name.length >= 3 && r.headline.length >= 3 && !!(r.phone || r.email) && r.neighborhood_id !== null, missing: 'completar seus dados (telefone e bairro)' },
  { key: 'resumo', weight: 10, done: (r) => r.summary.length >= 20, missing: 'escrever um resumo sobre você' },
  { key: 'experiencia', weight: 25, done: (r) => r.experiences.length > 0, missing: 'adicionar uma experiência' },
  { key: 'formacao', weight: 15, done: (r) => r.education.length > 0, missing: 'adicionar sua formação' },
  { key: 'habilidades', weight: 10, done: (r) => r.skills.length >= 3, missing: 'adicionar três habilidades' },
  { key: 'referencia', weight: 15, done: (r) => r.references_list.length > 0, missing: 'adicionar uma referência' },
  { key: 'foto', weight: 5, done: (r) => !!r.photo_path, missing: 'colocar uma foto (opcional)' },
];

/** "80% completo · falta adicionar uma referência". */
export function resumeProgress(r: ResumeData): { percent: number; next: string | null; label: string } {
  const percent = PARTS.reduce((n, p) => n + (p.done(r) ? p.weight : 0), 0);
  const next = PARTS.find((p) => !p.done(r))?.missing ?? null;
  return { percent, next, label: next ? `${percent}% completo · falta ${next}` : '100% completo' };
}

/** "fev. de 2023" a partir de "2023-02"; "2021" fica igual. */
export function monthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const names = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
  return `${names[Number(m[2]) - 1]} de ${m[1]}`;
}
export function periodLabel(e: { start: string; end: string; current: boolean }): string {
  const a = e.start ? monthLabel(e.start) : '';
  const b = e.current ? 'atual' : e.end ? monthLabel(e.end) : '';
  return a && b ? `${a} a ${b}` : a || b;
}

/** Cópia do currículo guardada na candidatura (o que a empresa vê). */
export interface ResumeSnapshot {
  full_name: string; headline: string | null; summary: string | null; neighborhood: string | null; photo_path: string | null;
  experiences: Experience[]; education: Education[]; skills: string[]; references: Reference[]; updated_at?: string;
}

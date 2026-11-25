// Vagas e currículos: rótulos e validações. Módulo puro (sem servidor) para ser testado em unidade.

export const EMPLOYMENT_LABEL = {
  clt: 'CLT (carteira assinada)',
  pj: 'PJ',
  temporario: 'Temporário',
  estagio: 'Estágio',
  freelance: 'Freelance',
  diaria: 'Diária',
} as const;
export type EmploymentType = keyof typeof EMPLOYMENT_LABEL;

export const WORK_MODE_LABEL = { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' } as const;
export type WorkMode = keyof typeof WORK_MODE_LABEL;

export const JOB_STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta', encerrada: 'Encerrada', removida: 'Removida pela moderação', vencida: 'Prazo encerrado',
};

export const APPLICATION_STATUS_LABEL = {
  recebida: 'Recebida',
  vista: 'Currículo visto',
  em_contato: 'Em contato',
  nao_selecionada: 'Não selecionada',
} as const;
export type ApplicationStatus = keyof typeof APPLICATION_STATUS_LABEL;

export const JOB_REPORT_REASON = {
  cobra_taxa: 'Cobra taxa ou pede pagamento',
  vaga_falsa: 'Vaga falsa ou golpe',
  discriminacao: 'Discriminação',
  conteudo_improprio: 'Conteúdo impróprio',
  outro: 'Outro',
} as const;

export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export interface JobInput {
  title: string;
  company_name: string;
  description: string;
  requirements: string | null;
  employment_type: EmploymentType;
  work_mode: WorkMode;
  neighborhood_id: number | null;
  salary_text: string | null;
  openings: number;
}

const clean = (v: unknown) => String(v ?? '').trim();
const oneLine = (v: unknown) => clean(v).replace(/\s+/g, ' ');

/** Valida o formulário da vaga. `values` vem de FormData (strings). */
export function parseJob(values: Record<string, unknown>): { data?: JobInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = oneLine(values.title);
  const company = oneLine(values.company_name);
  const description = clean(values.description).replace(/\r\n/g, '\n');
  const requirements = clean(values.requirements).replace(/\r\n/g, '\n');
  const salary = oneLine(values.salary_text);
  const type = clean(values.employment_type);
  const mode = clean(values.work_mode);
  const nb = clean(values.neighborhood_id);
  const openings = clean(values.openings) === '' ? 1 : Number(values.openings);

  if (title.length < 3) errors.title = 'Informe o cargo, ex.: Auxiliar de cozinha';
  else if (title.length > 100) errors.title = 'Use até 100 caracteres';
  if (company.length < 2) errors.company_name = 'Informe o nome da empresa ou o seu nome';
  else if (company.length > 100) errors.company_name = 'Use até 100 caracteres';
  if (description.length < 20) errors.description = 'Descreva a vaga em pelo menos 20 caracteres: atividades, horário, benefícios';
  else if (description.length > 4000) errors.description = 'Use até 4.000 caracteres';
  if (requirements.length > 2000) errors.requirements = 'Use até 2.000 caracteres';
  if (salary.length > 80) errors.salary_text = 'Use até 80 caracteres';
  if (!(type in EMPLOYMENT_LABEL)) errors.employment_type = 'Escolha o tipo de contratação';
  if (!(mode in WORK_MODE_LABEL)) errors.work_mode = 'Escolha o formato de trabalho';
  if (!Number.isInteger(openings) || openings < 1 || openings > 99) errors.openings = 'Informe de 1 a 99 vagas';
  if (nb && !/^\d+$/.test(nb)) errors.neighborhood_id = 'Bairro inválido';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    data: {
      title, company_name: company, description, requirements: requirements || null,
      employment_type: type as EmploymentType, work_mode: mode as WorkMode,
      neighborhood_id: nb ? Number(nb) : null, salary_text: salary || null, openings,
    },
  };
}

/** Confere a assinatura real do arquivo (não confia na extensão nem no tipo informado pelo navegador). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
}

/** Nome exibido e usado no download: sem caminho, sem caracteres de controle, sempre .pdf. */
export function safeResumeName(name: string | null | undefined): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.normalize('NFC').replace(/[\u0000-\u001f\u007f"<>:|?*]+/g, '').replace(/\s+/g, ' ').trim()
    .replace(/\.pdf$/i, '').slice(0, 100);
  return `${cleaned || 'curriculo'}.pdf`;
}

/** Situação exibida da vaga (uma vaga aberta com prazo vencido aparece como "Prazo encerrado"). */
export function jobState(job: { status: string; expires_at: string }, now = new Date()): 'aberta' | 'encerrada' | 'removida' | 'vencida' {
  if (job.status === 'aberta' && new Date(job.expires_at) <= now) return 'vencida';
  return job.status as 'aberta' | 'encerrada' | 'removida';
}

/** "há 3 dias", "hoje", "ontem". */
export function postedAgo(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'há 1 mês' : `há ${months} meses`;
}

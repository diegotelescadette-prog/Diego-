// Entrevistas: rótulos e datas (horário de Campo Grande). Módulo puro.
export type InterviewStatus = 'proposta' | 'confirmada' | 'recusada' | 'cancelada';
export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  proposta: 'Aguardando sua resposta', confirmada: 'Confirmada', recusada: 'Recusada pelo candidato', cancelada: 'Cancelada',
};
export interface InterviewView {
  id: string; application_id: string; job_id: string; employer_id: string; candidate_id: string; starts_at: string;
  mode: 'presencial' | 'video'; place: string | null; video_url: string | null; note: string | null; status: InterviewStatus;
}
const TZ = 'America/Campo_Grande';
/** "qui., 27 de nov. · 14:00" */
export function interviewWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
  const hour = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  return `${day} · ${hour}`;
}
/** Data local (AAAA-MM-DD) de um horário, em Campo Grande. */
export const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getUpcoming } from '@/lib/booking';
import { dayBox, SLOT_LABEL, STATUS_LABEL } from '@/lib/booking-shared';
import { INTERVIEW_STATUS_LABEL, localDate, type InterviewStatus } from '@/lib/interviews';

/** Um compromisso da agenda unificada: serviço agendado ou entrevista de emprego. */
export interface AgendaItem {
  key: string; kind: 'servico' | 'atendimento' | 'entrevista'; date: string; sort: string; href: string;
  tag: string; tagClass: string; title: string; when: string; status: string;
}

const SLOT_HOUR = { manha: '08:00', tarde: '13:00', noite: '18:00' } as const;
const TZ = 'America/Campo_Grande';

export async function getAgenda(userId: string, limit = 20): Promise<AgendaItem[]> {
  const supabase = await createClient();
  const [bookings, { data: ints }] = await Promise.all([
    getUpcoming(userId, limit),
    supabase.from('interviews')
      .select('id, application_id, job_id, employer_id, candidate_id, starts_at, mode, place, status, jobs(title, company_name), job_applications(full_name)')
      .or(`employer_id.eq.${userId},candidate_id.eq.${userId}`)
      .in('status', ['proposta', 'confirmada']).gte('starts_at', new Date().toISOString())
      .order('starts_at').limit(limit),
  ]);
  const items: AgendaItem[] = bookings.map((b) => {
    const d = dayBox(b.scheduled_date);
    const mine = b.client_id === userId;
    return {
      key: `b-${b.id}`, kind: mine ? 'servico' : 'atendimento', date: b.scheduled_date, sort: `${b.scheduled_date}T${SLOT_HOUR[b.time_slot]}`,
      href: mine ? `/pedidos/${b.id}` : '/painel/pedidos', tag: mine ? 'Serviço' : 'Atendimento', tagClass: 'mod-servicos',
      title: b.items[0]?.name ?? b.service,
      when: `${d.weekday}, ${d.day} de ${d.month} · ${SLOT_LABEL[b.time_slot].toLowerCase()} · ${b.neighborhood}`,
      status: STATUS_LABEL[b.status],
    };
  });
  for (const i of (ints ?? []) as unknown as {
    id: string; application_id: string; job_id: string; employer_id: string; starts_at: string; mode: string; place: string | null; status: InterviewStatus;
    jobs: { title: string; company_name: string } | null; job_applications: { full_name: string } | null;
  }[]) {
    const date = localDate(i.starts_at);
    const d = dayBox(date);
    const employer = i.employer_id === userId;
    const hour = new Date(i.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    const where = i.mode === 'video' ? 'chamada de vídeo' : i.place ?? 'presencial';
    items.push({
      key: `i-${i.id}`, kind: 'entrevista', date, sort: `${date}T${hour}`,
      href: employer ? `/minhas-vagas/${i.job_id}/c/${i.application_id}` : '/minhas-candidaturas',
      tag: 'Entrevista', tagClass: 'mod-trabalho',
      title: employer ? `${i.job_applications?.full_name ?? 'Candidato'} · ${i.jobs?.title ?? 'vaga'}` : `${i.jobs?.title ?? 'Vaga'} · ${i.jobs?.company_name ?? ''}`.replace(/ · $/, ''),
      when: `${d.weekday}, ${d.day} de ${d.month} · ${hour} · ${where}`,
      status: employer && i.status === 'proposta' ? 'Aguardando o candidato' : INTERVIEW_STATUS_LABEL[i.status],
    });
  }
  return items.sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, limit);
}

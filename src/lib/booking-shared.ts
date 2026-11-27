// Agendamento: tipos, rótulos e regras puras (sem servidor), para telas e testes de unidade.

export type BookingStatus = 'solicitado' | 'confirmado' | 'a_caminho' | 'em_andamento' | 'concluido' | 'cancelado';
export type TimeSlot = 'manha' | 'tarde' | 'noite';
export type PaymentMethod = 'pix_na_entrega' | 'dinheiro_na_entrega';

export interface PackageAddon { id: number; name: string; price_cents: number }
export interface ServicePackage {
  id: number; slug: string; name: string; description: string; includes: string[]; excludes: string[];
  duration_min: number; price_cents: number; price_from: boolean; featured: boolean;
  service: { id: number; name: string; slug: string };
  category: { id: number; name: string; slug: string };
  addons: PackageAddon[];
}

/** Ordem do acompanhamento, sem o cancelado. */
export const STATUS_STEPS: { key: Exclude<BookingStatus, 'cancelado'>; label: string; hint: string }[] = [
  { key: 'solicitado', label: 'Solicitado', hint: 'Recebemos o seu pedido.' },
  { key: 'confirmado', label: 'Confirmado', hint: 'O profissional aceitou e vai no dia combinado.' },
  { key: 'a_caminho', label: 'A caminho', hint: 'O profissional saiu para o seu endereço.' },
  { key: 'em_andamento', label: 'Em andamento', hint: 'O serviço está sendo feito.' },
  { key: 'concluido', label: 'Concluído', hint: 'Serviço terminado. Pague só agora, na entrega.' },
];

export const STATUS_LABEL: Record<BookingStatus, string> = {
  solicitado: 'Solicitado', confirmado: 'Confirmado', a_caminho: 'A caminho',
  em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado',
};

export const SLOT_LABEL: Record<TimeSlot, string> = { manha: 'Manhã (8h às 12h)', tarde: 'Tarde (12h às 18h)', noite: 'Noite (18h às 21h)' };
export const SLOTS: TimeSlot[] = ['manha', 'tarde', 'noite'];
/** Última hora (em Campo Grande) para pedir cada faixa no mesmo dia: 1 hora antes do fim. Igual ao banco. */
const SLOT_LAST_HOUR: Record<TimeSlot, number> = { manha: 11, tarde: 17, noite: 20 };

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { pix_na_entrega: 'Pix na entrega', dinheiro_na_entrega: 'Dinheiro na entrega' };

export const EVENT_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  profissional_escolhido: 'Profissional escolhido',
  profissional_trocado: 'Profissional trocado pela equipe',
  recusado: 'Profissional não pôde atender',
  pago: 'Pagamento registrado',
  avaliado: 'Avaliação enviada',
};

export const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
export const RATING_LABEL = ['', 'Ruim', 'Regular', 'Bom', 'Muito bom', 'Excelente'];
/** "4,8" */
export const ratingText = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Data em destaque na agenda: dia, mês curto e dia da semana (horário de Campo Grande). */
export function dayBox(date: string): { day: string; month: string; weekday: string } {
  const d = new Date(`${date}T12:00:00-04:00`);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('pt-BR', { ...o, timeZone: TZ }).replace('.', '');
  return { day: f({ day: 'numeric' }), month: f({ month: 'short' }), weekday: f({ weekday: 'short' }) };
}

export const TZ = 'America/Campo_Grande';

/** Preço em reais: 9000 → "R$ 90"; 1550 → "R$ 15,50". */
export function formatPrice(cents: number): string {
  const v = cents / 100;
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
export function priceLabel(p: { price_cents: number; price_from: boolean }): string {
  return `${p.price_from ? 'a partir de ' : ''}${formatPrice(p.price_cents)}`;
}
export function durationLabel(min: number): string {
  if (min < 60) return `cerca de ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `cerca de ${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

/** Total no cliente (o banco recalcula na hora de criar o pedido). */
export function bookingTotal(unitCents: number, addons: PackageAddon[], chosen: number[], qty: number): number {
  const extra = addons.filter((a) => chosen.includes(a.id)).reduce((n, a) => n + a.price_cents, 0);
  return (unitCents + extra) * Math.max(1, Math.min(10, qty));
}

/** Data (AAAA-MM-DD) e hora em Campo Grande. */
export function cgNow(now = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function slotOpen(date: string, slot: TimeSlot, now = new Date()): boolean {
  const { date: today, hour } = cgNow(now);
  if (date < today || date > addDays(today, 14)) return false;
  return date > today || hour < SLOT_LAST_HOUR[slot];
}

/** Próximos dias para escolher: hoje (se ainda houver faixa) e os 6 seguintes. */
export function bookingDays(now = new Date()): { date: string; label: string; today: boolean; slots: TimeSlot[] }[] {
  const { date: today } = cgNow(now);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const slots = SLOTS.filter((s) => slotOpen(date, s, now));
    if (!slots.length) continue;
    const d = new Date(`${date}T12:00:00Z`);
    const wd = d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
    const dm = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    out.push({ date, today: i === 0, slots, label: i === 0 ? 'Hoje' : i === 1 ? `Amanhã · ${dm}` : `${wd} · ${dm}` });
  }
  return out;
}

export function dateLabel(date: string, now = new Date()): string {
  const { date: today } = cgNow(now);
  if (date === today) return 'Hoje';
  if (date === addDays(today, 1)) return 'Amanhã';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

/** Mensagens das funções do banco, em português. */
export function bookingError(code: string | undefined): string {
  const map: Record<string, string> = {
    login_required: 'Entre na sua conta para agendar.',
    rate_limited: 'Muitos pedidos em pouco tempo. Aguarde um pouco e tente de novo.',
    package_unavailable: 'Este serviço não está disponível agora.',
    invalid_qty: 'Escolha uma quantidade entre 1 e 10.',
    invalid_slot: 'Esse horário não está mais disponível. Escolha outro dia ou faixa.',
    invalid_neighborhood: 'Escolha o seu bairro.',
    invalid_address: 'Informe rua, número e complemento.',
    invalid_phone: 'Informe um WhatsApp com DDD.',
    invalid_notes: 'As observações podem ter até 600 caracteres.',
    invalid_payment: 'Escolha como vai pagar.',
    invalid_addons: 'Um dos adicionais não está mais disponível.',
    invalid_status: 'Este pedido mudou. Atualize a página.',
    invalid_rating: 'Escolha de 1 a 5 estrelas.',
    invalid_comment: 'O comentário pode ter até 500 caracteres.',
    already_reviewed: 'Você já avaliou este serviço.',
    invalid_provider: 'Este profissional não está mais disponível para o pedido.',
    not_allowed: 'Você não tem acesso a este pedido.',
    no_provider: 'Escolha um profissional primeiro.',
    invalid_value: 'Informe um valor entre R$ 1 e R$ 100.000.',
    quote_required: 'Informe o valor do serviço antes de concluir.',
  };
  const key = Object.keys(map).find((k) => code?.includes(k));
  return key ? map[key] : 'Não foi possível concluir. Tente de novo.';
}

/** Máscara do telefone antes da confirmação: (67) 9••••-••12. */
export function maskPhone(digits: string | null | undefined): string {
  const d = (digits ?? '').replace(/\D/g, '');
  if (d.length < 10) return '••••';
  return `(${d.slice(0, 2)}) ${d[2]}••••-••${d.slice(-2)}`;
}

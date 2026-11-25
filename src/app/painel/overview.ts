import 'server-only';
import { getNeighborhoods } from '@/lib/data';
import { loadProfile, type ProfileView } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import type { TodayActive, TodaySvc } from './AvailabilityPanel';
import type { Neighborhood } from '@/lib/types';

export type Coverage = 'cidade' | 'bairros' | 'online' | 'pendente';
export type TodayBlocked = 'not_published' | 'no_in_person' | 'no_area' | null;

export interface PanelData {
  p: ProfileView;
  missing: string[];
  coverage: Coverage;
  areaNames: string[];
  cityName: string;
  today: { blocked: TodayBlocked; services: TodaySvc[]; areaNeighborhoods: Neighborhood[]; active: TodayActive | null };
}

/** Estado do painel confirmado pelo servidor (mesmas regras da busca e do contato). */
export async function loadPanel(userId: string): Promise<PanelData | null> {
  const p = await loadProfile({ id: userId });
  if (!p) return null;
  const supabase = await createClient();
  // Revalida antes de mostrar: a disponibilidade exibida é a mesma usada na busca.
  if (p.status === 'published') await supabase.rpc('revalidate_my_available_today');
  const [{ data: missing }, { data: coverage }, { data: avail }, { data: areas }, { data: city }] = await Promise.all([
    supabase.rpc('profile_missing_fields', { p_provider: userId }),
    supabase.rpc('provider_coverage', { p_provider: userId }),
    supabase.from('availability_today').select('*').eq('provider_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle(),
    supabase.from('provider_areas').select('neighborhood_id').eq('provider_id', userId),
    p.city ? supabase.from('cities').select('timezone, name').eq('id', p.city.id).single() : Promise.resolve({ data: null }),
  ]);
  const cityNbs = p.city ? await getNeighborhoods(p.city.id) : [];
  const areaIds = new Set((areas ?? []).map((a) => a.neighborhood_id as number));
  const areaNbs = p.serves_whole_city ? cityNbs : cityNbs.filter((n) => areaIds.has(n.id));
  const inPerson = p.services.filter((s) => s.active && (s.mode === 'presencial' || s.mode === 'ambos'))
    .map((s) => ({ id: s.id, name: s.name, urgent_pilot: s.urgent_pilot }));
  const tz = city?.timezone ?? 'America/Campo_Grande';
  const cityName = city?.name ?? p.city?.name ?? 'Campo Grande';
  const until = (iso: string) => {
    const end = new Date(new Date(iso).getTime() - 60_000);
    return `${new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(end)} de hoje (horário de ${cityName})`;
  };
  const blocked: TodayBlocked = p.status !== 'published' ? 'not_published'
    : inPerson.length === 0 ? 'no_in_person'
    : !p.serves_whole_city && areaNbs.length === 0 ? 'no_area' : null;
  return {
    p,
    missing: (missing ?? []) as string[],
    coverage: ((coverage as string) ?? 'pendente') as Coverage,
    areaNames: p.serves_whole_city ? [] : areaNbs.map((n) => n.name),
    cityName,
    today: {
      blocked, services: inPerson, areaNeighborhoods: areaNbs,
      active: avail && !blocked ? {
        until: until(avail.expires_at), whole_city: avail.whole_city,
        services: inPerson.filter((s) => avail.service_ids.includes(s.id)),
        neighborhoods: cityNbs.filter((n) => avail.neighborhood_ids.includes(n.id)).map((n) => n.name),
        neighborhood_ids: avail.neighborhood_ids,
      } : null,
    },
  };
}

/** Uma pendência real que impede o uso, com o destino e o campo certo. */
export function nextStep(d: Pick<PanelData, 'p' | 'missing' | 'coverage'>): { text: string; href: string; cta: string } | null {
  const { p, missing, coverage } = d;
  if (p.status === 'suspended') return null;
  if (p.status !== 'draft' && coverage === 'pendente') {
    return { text: 'Confirme sua área de atendimento para voltar a aparecer na busca.', href: '/painel/atendimento#area-title', cta: 'Confirmar área' };
  }
  if (p.status === 'draft') {
    const order: [string, string, string][] = [
      ['display_name', '/painel/perfil#display_name', 'Informe seu nome profissional'],
      ['phone', '/painel/perfil#phone', 'Informe o telefone com DDD'],
      ['whatsapp', '/painel/perfil#phone', 'Informe o WhatsApp para contato'],
      ['cpf', '/painel/perfil#cpf', 'Informe o CPF'],
      ['photo', '/painel/servicos#photo-label', 'Envie a foto do perfil'],
      ['services', '/painel/servicos#svc-filter', 'Escolha seus serviços'],
      ['main_service', '/painel/servicos#main_service', 'Indique o serviço principal'],
      ['area', '/painel/atendimento#area-title', 'Diga onde você atende'],
      ['city', '/painel/atendimento#city_id', 'Escolha a cidade onde você atende'],
      ['address', '/painel/atendimento#cep', 'Informe o endereço de referência (privado)'],
    ];
    const first = order.find(([k]) => missing.includes(k));
    if (first) return { text: `${first[2]} para poder publicar.`, href: first[1], cta: 'Continuar cadastro' };
    return { text: 'Cadastro completo. Confira a prévia e publique seu perfil.', href: '/painel/previa', cta: 'Ver prévia e publicar' };
  }
  return null;
}

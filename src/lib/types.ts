export type ProviderStatus = 'draft' | 'published' | 'paused' | 'suspended';

export const STATUS_LABEL: Record<ProviderStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  paused: 'Pausado',
  suspended: 'Suspenso',
};

export const STATUS_HELP: Record<ProviderStatus, string> = {
  draft: 'Seu perfil ainda não aparece na busca. Complete as etapas e publique.',
  published: 'Seu perfil aparece na busca.',
  paused: 'Seu perfil está oculto da busca até você reativar.',
  suspended: 'Seu perfil foi suspenso pela moderação e não aparece na busca.',
};

export interface Service { id: number; name: string; slug: string; mode: 'presencial' | 'online' | 'ambos'; urgent_pilot: boolean; active: boolean; category_id: number; sort: number }
export interface Category { id: number; name: string; slug: string; active: boolean; sort: number; services: Service[] }
export interface Neighborhood { id: number; name: string; slug: string; city_id: number }
export interface City { id: number; name: string; uf: string; slug: string; timezone: string; is_pilot: boolean }

export interface ProviderCardData {
  id: string; slug: string; display_name: string; photo_path: string | null;
  main_service: string | null; area_label: string | null; serves_online: boolean; available_today: boolean;
}

export const MISSING_LABEL: Record<string, string> = {
  display_name: 'Nome profissional', photo: 'Foto de perfil', phone: 'Telefone', whatsapp: 'WhatsApp', cpf: 'CPF',
  services: 'Serviços oferecidos', main_service: 'Serviço principal', address: 'Endereço de referência',
  city: 'Cidade de atendimento', area: 'Área de atendimento', perfil: 'Perfil',
};

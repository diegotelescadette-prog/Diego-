import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Category, City, Neighborhood, Service } from '@/lib/types';
import { PILOT_CITY_SLUG } from '@/config/brand';

export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/profile-photos/${path}`;
}

export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export const getIsAdmin = cache(async () => {
  const user = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
  return data?.role === 'admin';
});

export const getCatalog = cache(async (includeInactive = false): Promise<Category[]> => {
  const supabase = await createClient();
  const [{ data: cats }, { data: svcs }] = await Promise.all([
    supabase.from('service_categories').select('id,name,slug,active,sort,official_channel').order('sort'),
    supabase.from('services').select('id,name,slug,mode,urgent_pilot,active,category_id,sort').order('sort'),
  ]);
  return (cats ?? [])
    .filter((c) => includeInactive || c.active)
    .map((c) => ({ ...c, services: (svcs ?? []).filter((s) => s.category_id === c.id && (includeInactive || s.active)) as Service[] }));
});

export const getAllServices = cache(async (): Promise<Service[]> => (await getCatalog()).flatMap((c) => c.services));

export const getUrgentServices = cache(async (): Promise<Service[]> =>
  (await getAllServices()).filter((s) => s.urgent_pilot));

/** Catálogo do "Preciso para hoje": todos os serviços feitos no local, por categoria. */
export const getUrgentCatalog = cache(async (): Promise<Category[]> =>
  (await getCatalog()).map((c) => ({ ...c, services: c.services.filter((s) => s.urgent_pilot) })).filter((c) => c.services.length > 0));

/** Sinônimos por serviço (ajudam o filtro da lista: "vazamento" acha Encanador). */
export const getSynonymsByService = cache(async (): Promise<Record<number, string[]>> => {
  const supabase = await createClient();
  const { data } = await supabase.from('service_synonyms').select('service_id,term');
  const out: Record<number, string[]> = {};
  for (const r of data ?? []) (out[r.service_id] ??= []).push(r.term);
  return out;
});

export const getCities = cache(async (): Promise<City[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('cities').select('id,name,uf,slug,timezone,is_pilot').eq('active', true).order('name');
  return (data ?? []) as City[];
});

export const getPilotCity = cache(async (): Promise<City> => {
  const cities = await getCities();
  return cities.find((c) => c.slug === PILOT_CITY_SLUG) ?? cities[0];
});

export const getNeighborhoods = cache(async (cityId?: number): Promise<Neighborhood[]> => {
  const supabase = await createClient();
  let q = supabase.from('neighborhoods').select('id,name,slug,city_id').eq('active', true).order('name');
  if (cityId) q = q.eq('city_id', cityId);
  const { data } = await q;
  return (data ?? []) as Neighborhood[];
});

export const getSetting = cache(async <T,>(key: string): Promise<T | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? null;
});

export interface CpfSetting { enabled: boolean; purpose: string | null; necessity_confirmed: boolean }

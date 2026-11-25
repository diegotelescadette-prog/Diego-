// Ícone e cor por categoria do catálogo (traço simples, 24×24).
const CATS: Record<string, { d: string; tint: string }> = {
  'construcao-e-reformas': { d: 'M3 6h18v12H3zM3 12h18M9 6v6M15 12v6', tint: '#b45309' },
  'marcenaria-carpintaria-e-mobiliario': { d: 'M15 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9M14 4l6 6-2.5 2.5-6-6z', tint: '#92400e' },
  'pintura-e-acabamentos': { d: 'M4 4h13v5H4zM17 6.5h3v5.5h-8v3M11 15h2v6h-2z', tint: '#be185d' },
  'hidraulica-e-manutencao': { d: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z', tint: '#0369a1' },
  'eletrica-e-climatizacao': { d: 'M13 2 4 14h7l-1 8 9-12h-7z', tint: '#ca8a04' },
  'portas-janelas-e-seguranca': { d: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4', tint: '#475569' },
  'piscina-jardim-e-area-externa': { d: 'M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7', tint: '#15803d' },
  'limpeza-e-conservacao': { d: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z', tint: '#7c3aed' },
  'tecnologia-e-eletronicos': { d: 'M5 5h14v10H5zM2 19h20', tint: '#4f46e5' },
  'eletrodomesticos': { d: 'M7 3h10v18H7zM7 10h10M10 6v2M10 13v3', tint: '#0e7490' },
  'automotivo': { d: 'M3 13l2-6h14l2 6v5H3zM3 13h18M7 18v2M17 18v2', tint: '#b91c1c' },
  'transporte-e-entregas': { d: 'M2 6h12v10H2zM14 10h4l3 3v3h-7M6 17.5a1.5 1.5 0 1 0 .01 0M17 17.5a1.5 1.5 0 1 0 .01 0', tint: '#c2410c' },
  'beleza-e-cuidados-pessoais': { d: 'M6 6a3 3 0 1 0 .01 0M6 15a3 3 0 1 0 .01 0M8.5 7.5 20 19M8.5 16.5 20 5', tint: '#db2777' },
  'pets': { d: 'M12 14c-3 0-5 3-5 5h10c0-2-2-5-5-5zM5 10.5a1.5 1.5 0 1 0 .01 0M19 10.5a1.5 1.5 0 1 0 .01 0M9 6a1.5 1.5 0 1 0 .01 0M15 6a1.5 1.5 0 1 0 .01 0', tint: '#a16207' },
  'eventos-e-alimentacao': { d: 'M3 8h4l2-3h6l2 3h4v12H3zM12 10.5a3.5 3.5 0 1 0 .01 0', tint: '#9333ea' },
  'aulas-e-servicos-profissionais': { d: 'M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z', tint: '#2563eb' },
  'confeccao-e-consertos': { d: 'M5 19 19 5M15 5h4v4M8 8c4-2 7 2 3 5s-5 6-1 6', tint: '#0f766e' },
};
const FALLBACK = { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', tint: '#0f5f73' };

export function categoryTint(slug?: string | null) { return (slug && CATS[slug]?.tint) || FALLBACK.tint; }

export function Glyph({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}

/** Ícone da categoria num quadradinho colorido. size: sm (24px), md (44px), lg (56px). */
export function CategoryIcon({ slug, size = 'md' }: { slug?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const c = (slug && CATS[slug]) || FALLBACK;
  return (
    <span className={`ic ic-${size}`} style={{ ['--t' as string]: c.tint }}>
      <Glyph d={c.d} size={size === 'sm' ? 14 : size === 'lg' ? 28 : 22} />
    </span>
  );
}

export const WA_PATH = 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2s.2-1.1.1-1.2-.2-.2-.5-.3z';
export function WhatsAppIcon({ size = 22 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor"><path d={WA_PATH} /></svg>;
}
export const PIN_PATH = 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 .01 0';

export function Avatar({ src, name, size = 64, round = false }: { src: string | null; name: string; size?: number; round?: boolean }) {
  const shape = round ? 'rounded-full' : 'rounded-2xl';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const style = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={`Foto de ${name}`} style={style} className={`shrink-0 ${shape} object-cover bg-stone-200`} loading="lazy" />;
  }
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ${shape} bg-brand-100 font-bold text-brand-800`} style={{ ...style, fontSize: Math.max(14, Math.round(size * 0.34)) }}>
      {initials}
    </span>
  );
}

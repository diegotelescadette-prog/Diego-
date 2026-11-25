export function Avatar({ src, name, size = 64 }: { src: string | null; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const style = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={`Foto de ${name}`} style={style} className="shrink-0 rounded-2xl object-cover bg-stone-200" loading="lazy" />;
  }
  return (
    <span style={style} aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-xl font-bold text-brand-800">
      {initials}
    </span>
  );
}

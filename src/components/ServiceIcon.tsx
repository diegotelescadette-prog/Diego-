const paths: Record<string, React.ReactNode> = {
  encanador: <path d="M4 10h8V6h4v4h0a4 4 0 0 1 4 4v2h-4v-2h-4v2H4zM18 19a1.5 1.5 0 1 1-3 0c0-1 1.5-2.5 1.5-2.5S18 18 18 19z" />,
  eletricista: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  chaveiro: <path d="M8 14a5 5 0 1 1 4.6-7H22v3h-2v3h-3v-3h-4.4A5 5 0 0 1 8 14zm0-3.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />,
  'tecnico-de-ar-condicionado': <path d="M3 5h18v7H3zM6 9h12M7 15c0 1.5-1 2-1 3.5M12 15c0 1.5-1 2-1 3.5M17 15c0 1.5-1 2-1 3.5" />,
};

export function ServiceIcon({ slug, className = 'h-8 w-8' }: { slug: string; className?: string }) {
  const filled = slug !== 'tecnico-de-ar-condicionado';
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={2} strokeLinecap="round">
      {paths[slug] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

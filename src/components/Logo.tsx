import { APP_NAME } from '@/config/brand';

/** Sol nascendo: meio círculo dourado com três raios sobre uma linha. */
export function SunMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={className} fill="none" strokeLinecap="round">
      <path d="M8.5 22a7.5 7.5 0 0 1 15 0z" fill="#ef9614" />
      <path d="M16 6.5v3.5M7.2 11.2l2.4 2.4M24.8 11.2l-2.4 2.4" stroke="#ef9614" strokeWidth="2.4" />
      <path d="M3.5 22.5h25" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-brand-700">
      <SunMark />
      <span className="serif text-[22px] leading-none">{APP_NAME.toLocaleLowerCase('pt-BR')}</span>
    </span>
  );
}

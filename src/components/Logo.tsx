import { APP_NAME } from '@/config/brand';

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-lg font-extrabold tracking-tight text-brand-800">
      <svg aria-hidden="true" viewBox="0 0 64 64" className="h-8 w-8">
        <rect width="64" height="64" rx="14" fill="#5f8d80" />
        <path d="M32 12c-8.3 0-15 6.5-15 14.6C17 37.5 32 52 32 52s15-14.5 15-25.4C47 18.5 40.3 12 32 12z" fill="#fff" />
        <path d="m25 27 5 5 9-10" stroke="#d9925f" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {APP_NAME}
    </span>
  );
}

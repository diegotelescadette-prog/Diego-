import { APP_NAME } from '@/config/brand';

/** "próximo" em minúsculas, com um ponto laranja no lugar do acento do "ó" (o ponto de encontro). */
export function Logo() {
  const name = APP_NAME.toLocaleLowerCase('pt-BR');
  const i = name.indexOf('ó');
  return (
    <span className="serif inline-flex items-baseline whitespace-nowrap text-[24px] font-bold leading-none tracking-tight text-ink" aria-label={name}>
      {i < 0 ? name : (
        <span aria-hidden="true">
          {name.slice(0, i)}
          <span className="relative inline-block">o<span className="absolute left-1/2 top-[-0.12em] h-[0.22em] w-[0.22em] -translate-x-1/2 rounded-full bg-brand-500" /></span>
          {name.slice(i + 1)}
        </span>
      )}
    </span>
  );
}

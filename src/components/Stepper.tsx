import Link from 'next/link';

const STEPS = [
  { n: 1, label: 'Seu perfil', href: '/painel/perfil' },
  { n: 2, label: 'Onde você atende', href: '/painel/atendimento' },
  { n: 3, label: 'Prévia e publicação', href: '/painel/previa' },
];

export function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="Etapas do cadastro" className="mb-5">
      <ol className="flex gap-2 text-sm">
        {STEPS.map((s) => (
          <li key={s.n} className="flex-1">
            <Link href={s.href} aria-current={s.n === current ? 'step' : undefined}
              className={`block rounded-xl border-2 px-2 py-2 text-center font-semibold ${s.n === current ? 'border-brand-700 bg-brand-700 text-white' : 'border-stone-200 bg-surface text-stone-700'}`}>
              <span className="block text-xs font-normal">{s.n === 3 ? 'Final' : `Etapa ${s.n}`}</span>{s.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

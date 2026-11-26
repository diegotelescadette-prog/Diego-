'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** Volta ao feed com os filtros e a posição de antes (histórico); sem histórico, abre a comunidade. */
export function BackToFeed() {
  const router = useRouter();
  return (
    <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline"
      onClick={(e) => {
        if (typeof window !== 'undefined' && window.history.length > 1 && document.referrer.startsWith(window.location.origin)) {
          e.preventDefault();
          router.back();
        }
      }}>
      ← Voltar à comunidade
    </Link>
  );
}

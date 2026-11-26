import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/AuthForms';
import { getUser } from '@/lib/data';
import { safeNext } from '@/lib/validation';

export const metadata: Metadata = { title: 'Entrar' };

const REASONS: Record<string, string> = {
  contato: 'Entre para chamar o prestador no WhatsApp.',
  favorito: 'Entre para salvar nos favoritos.',
  denuncia: 'Entre para denunciar um perfil.',
  comentar: 'Entre para comentar a publicação.',
  util: 'Entre para marcar a publicação como útil.',
  publicar: 'Entre para publicar na comunidade.',
  salvar: 'Entre para salvar a publicação.',
  agendar: 'Entre ou crie sua conta para agendar. Você volta para o agendamento logo depois.',
};

export default async function Entrar({ searchParams }: { searchParams: Promise<{ next?: string; motivo?: string; erro?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next, '/');
  if (await getUser()) redirect(next);
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">Entrar</h1>
      {sp.motivo && REASONS[sp.motivo] && <p className="mt-2 rounded-xl bg-brand-50 p-3 text-brand-900">{REASONS[sp.motivo]}</p>}
      {sp.erro && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-red-900">O link é inválido ou expirou. Entre ou peça um novo link.</p>}
      <div className="card mt-4 p-5"><LoginForm next={next} /></div>
    </div>
  );
}

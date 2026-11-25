import { redirect } from 'next/navigation';
import { NewPasswordForm } from '@/components/AuthForms';
import { getUser } from '@/lib/data';
export const metadata = { title: 'Nova senha' };
export default async function Redefinir() {
  if (!(await getUser())) redirect('/entrar?erro=link');
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">Criar nova senha</h1>
      <div className="card mt-4 p-5"><NewPasswordForm /></div>
    </div>
  );
}

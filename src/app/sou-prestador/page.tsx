import { redirect } from 'next/navigation';
import { getUser } from '@/lib/data';

// "Sou prestador": após o acesso, vai direto ao formulário do perfil.
export default async function SouPrestador() {
  if (!(await getUser())) redirect(`/cadastrar?next=${encodeURIComponent('/painel/perfil')}`);
  redirect('/painel/perfil');
}

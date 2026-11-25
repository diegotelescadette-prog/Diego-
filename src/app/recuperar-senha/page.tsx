import { ResetRequestForm } from '@/components/AuthForms';
export const metadata = { title: 'Recuperar senha' };
export default function Recuperar() {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">Recuperar senha</h1>
      <p className="mt-2 text-stone-700">Informe o e-mail da conta. Enviaremos um link para criar uma nova senha.</p>
      <div className="card mt-4 p-5"><ResetRequestForm /></div>
    </div>
  );
}

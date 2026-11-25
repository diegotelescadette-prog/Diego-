import { APP_NAME } from '@/config/brand';
export const metadata = { title: 'Aviso de privacidade' };

export default function Privacidade() {
  return (
    <article className="prose mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-extrabold">Aviso de privacidade</h1>
      <p className="text-sm text-stone-600">Versão do piloto — revisar com o responsável jurídico antes do lançamento.</p>
      <section>
        <h2 className="text-lg font-bold">O que coletamos e por quê</h2>
        <ul className="list-inside list-disc space-y-1">
          <li><strong>E-mail e senha</strong>: para entrar na conta, confirmar o e-mail e recuperar a senha. O e-mail não aparece em perfis.</li>
          <li><strong>Prestadores — dados públicos</strong>: nome profissional, foto, serviços, descrição, fotos de trabalhos e região atendida.</li>
          <li><strong>Prestadores — dados privados</strong>: telefone/WhatsApp (usado só para gerar o link “Chamar no WhatsApp”, sem exibir o número), endereço de referência (não exibido) e, quando a coleta estiver habilitada pela operação, CPF guardado cifrado, usado apenas para a finalidade informada no formulário.</li>
          <li><strong>Denúncias</strong>: motivo e detalhes, para moderação.</li>
          <li><strong>Segurança</strong>: um código derivado do IP (não o IP em si) para limitar abusos no contato.</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-bold">Necessidade</h2>
        <p>Seguimos o princípio da necessidade da LGPD (art. 6º, III): coletamos o mínimo para o serviço funcionar. A coleta do CPF fica desligada até que a operação defina e registre a finalidade.</p>
      </section>
      <section>
        <h2 className="text-lg font-bold">Seus direitos</h2>
        <p>Você pode editar seus dados no painel e excluir sua conta e todos os dados em <a className="underline" href="/conta">Minha conta</a>.</p>
      </section>
      <p className="text-sm text-stone-600">{APP_NAME} · Piloto Campo Grande–MS</p>
    </article>
  );
}

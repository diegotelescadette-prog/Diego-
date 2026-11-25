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
          <li><strong>Vagas de emprego</strong>: cargo, empresa ou nome de quem contrata e a descrição da vaga ficam públicos enquanto a vaga está aberta (30 dias, renováveis).</li>
          <li><strong>Denúncias</strong>: motivo e detalhes, para moderação.</li>
          <li><strong>Segurança</strong>: um código derivado do IP (não o IP em si) para limitar abusos no contato.</li>
        </ul>
      </section>
      <section id="curriculos">
        <h2 className="text-lg font-bold">Currículos e candidaturas</h2>
        <ul className="list-inside list-disc space-y-1">
          <li><strong>O que enviamos</strong>: ao se candidatar, seu nome, e-mail, WhatsApp (se informar), mensagem e currículo em PDF vão <strong>somente para quem publicou a vaga</strong>, com a sua autorização (consentimento, LGPD art. 7º, I). Nada disso aparece em páginas públicas e a moderação também não tem acesso aos currículos.</li>
          <li><strong>Onde fica</strong>: o PDF é guardado em área privada de armazenamento, e o download só é liberado para você e para quem publicou a vaga.</li>
          <li><strong>Por quanto tempo</strong>: até você retirar a candidatura (o arquivo é apagado na hora), até quem publicou excluir a vaga, ou no máximo 90 dias depois que a vaga encerra, quando apagamos automaticamente.</li>
          <li><strong>Banco de currículos</strong>: se você deixar o currículo sem escolher uma vaga, ele fica visível só para contas com vaga aberta publicada aqui (a administração não consulta). Você pode ocultar ou apagar quando quiser; ele vence em 6 meses (salvar de novo renova) e, vencido há mais de 30 dias, é apagado.</li>
          <li><strong>Quem publica a vaga</strong> se compromete a usar os currículos só para aquela seleção, sem repassar a terceiros, e a não cobrar nada dos candidatos.</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-bold">Necessidade</h2>
        <p>Seguimos o princípio da necessidade da LGPD (art. 6º, III): coletamos o mínimo para o serviço funcionar. A coleta do CPF fica desligada até que a operação defina e registre a finalidade.</p>
      </section>
      <section>
        <h2 className="text-lg font-bold">Seus direitos</h2>
        <p>Você pode editar seus dados no painel, retirar candidaturas em <a className="underline" href="/minhas-candidaturas">Minhas candidaturas</a> e excluir sua conta e todos os dados (inclusive currículos enviados e recebidos) em <a className="underline" href="/conta">Minha conta</a>.</p>
      </section>
      <p className="text-sm text-stone-600">{APP_NAME} · Piloto Campo Grande–MS</p>
    </article>
  );
}

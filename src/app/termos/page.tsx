import Link from 'next/link';
import { APP_NAME } from '@/config/brand';
export const metadata = { title: 'Termos de uso' };

export default function Termos() {
  return (
    <article className="prose mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-extrabold">Termos de uso</h1>
      <p className="text-sm text-stone-600">Versão do piloto. Revisar com o responsável jurídico antes do lançamento.</p>
      <section>
        <h2 className="text-lg font-bold">Para que serve o {APP_NAME}</h2>
        <p>Uma rede local de confiança de Campo Grande (MS) para contratar serviços, oferecer o seu trabalho, procurar emprego, anunciar vagas, vender e conversar com a comunidade. Para usar qualquer área é preciso ter conta.</p>
      </section>
      <section>
        <h2 className="text-lg font-bold">Sua conta</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>A conta é pessoal e para maiores de 18 anos. Use seu nome verdadeiro no cadastro; o nome público pode ser um apelido.</li>
          <li>Mantenha o celular e o bairro atualizados. Eles ajudam a mostrar o que está perto e a confirmar quem é quem.</li>
          <li>Você pode excluir a conta quando quiser em <Link className="underline" href="/conta">Minha conta</Link>.</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-bold">Convivência</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>Trate todo mundo com respeito. Textos com ofensas não são publicados.</li>
          <li>Nada de golpe, propaganda enganosa ou cobrança para alguém conseguir emprego.</li>
          <li>Publique só fotos e informações que você tem direito de usar.</li>
          <li>Denúncias são analisadas pela equipe, que pode ocultar conteúdo e suspender contas.</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-bold">Contato e telefone</h2>
        <p>Seu telefone nunca aparece em páginas do app. Ele só é mostrado para outra pessoa depois que vocês dois aceitarem o contato.</p>
      </section>
      <p>Como tratamos os seus dados está no <Link className="underline" href="/privacidade">Aviso de privacidade</Link>.</p>
      <p className="text-sm text-stone-600">{APP_NAME} · Piloto Campo Grande–MS</p>
    </article>
  );
}

# Testes

## Como rodar

Precisa de um Supabase local. Com Docker: `supabase start` e aplique as migrações.
Sem Docker (como foi feito aqui): `sudo dev/local-stack/start.sh` sobe Postgres 16 + GoTrue + PostgREST + um gateway
em `http://localhost:54321` (storage simplificado e caixa de e-mails em `/_mail`). Coloque as chaves impressas no `.env.local`.

```bash
npm run seed:demo                  # dados fictícios
npm run build && npm start         # app em :3000
npm run test:unit                  # validações e mensagens
npm run test:integration           # RLS, regras do banco e APIs (precisa do app rodando)
npx playwright test                # E2E no navegador, computador e celular (Pixel 7)
```

## Rodada 11 (26/11/2026): fase 3, parte 2 (dia a dia, Momentos e modo escuro) — passando

Unitários (24), banco/API (59) e E2E (56 cenários × computador e celular = 112; 111 passaram, 1 falhou, a mesma instabilidade da busca registrada na rodada 10).

- Dia a dia: qualquer conta com nome público conta do dia (texto, fotos ou vídeo); serviço e preço são ignorados; aparece na aba Dia a dia; se o autor é prestador na comunidade, o post leva ao perfil dele; conta sem nome público não posta.
- Momentos: foto ou vídeo de até 30 s na pasta da própria conta; fica no ar 24 horas e não se edita; anel coral até a pessoa ver; o autor vê quantas pessoas viram e ninguém mais vê a lista; uma denúncia por pessoa; só a administração tira do ar (aparece em Publicações › Denúncias de momentos); vencido some para todos e o arquivo é apagado na próxima vez que o autor publica.
- Modo escuro: Automático (segue o aparelho), Claro ou Escuro no rodapé, guardado num cookie; textos em índigo, vermelho e verde ganham tons claros no escuro; ícones de categoria clareados.

## Rodada 10 (26/11/2026): fase 3, parte 1 (rede social) — passando

Unitários (24), banco/API (57) e E2E (51 cenários × computador e celular = 102; 100 passaram, 2 falharam, ver abaixo).

- Reações: Valeu, Inspirou, Tô junto e Indico, uma por pessoa; o "Útil" de antes vira Valeu; trocar o tipo não soma outra reação; tipo fora da lista é recusado; ninguém troca a reação de outra pessoa; o botão principal marca Valeu e tocar de novo tira.
- Feito pelo Próximo: só pedido concluído do próprio prestador, só em Trabalho e um post por pedido; mostra a nota do cliente (sem nome nem comentário); editar o post não muda o pedido ligado; "Mostrar este trabalho no feed" em Pedidos para mim abre o formulário já ligado ao pedido.
- Seguir: só conta logada segue prestador publicado, ninguém segue a si mesmo; a contagem de seguidores é pública e a lista é privada; a aba "Quem eu sigo" mostra só esses perfis e explica o que fazer quando está vazia.
- Fim do feed: "Você está em dia. Vai lá viver o seu dia." quando não há mais publicações.
- Corrigido antes de subir: o feed falhava para visitantes porque faltava a permissão de leitura na tabela de quem segue.
- Instável, fora desta mudança: "busca sem resultados sugere retirar filtro" às vezes falha no computador (a página de busca não foi alterada; passa ao repetir).

## Rodada 9 (26/11/2026): preparação do lançamento — todos passando

Unitários (16), banco/API (46) e E2E (41 cenários × computador e celular = 82).

- Cobertura por serviço: perfil com quatro serviços soma nas quatro linhas e uma vez no total; pausado, suspenso e verificação pendente ficam fora da oferta apta; "Em análise" conta quem está em análise ou com pendência; só administrador consulta.
- Verificação: envio exige nome completo, WhatsApp, ao menos uma referência válida, aviso às referências e aceite do aviso de privacidade; aprovação exige identidade e WhatsApp conferidos e uma referência confirmada; alterar uma referência confirmada ou trocar o WhatsApp volta o cadastro para análise; pendência mostra o motivo ao prestador; histórico registra a ação sem contatos.
- Dados privados: outra conta, outro prestador e visitante não leem referências nem a verificação; o dono não vê a nota interna, não confirma a própria referência nem se aprova; detalhe da verificação só para a equipe (tela mostra "Acesso restrito").
- Regra do piloto (desligada por padrão): ligada, quem não foi aprovado sai da busca, do feed, do perfil público e do contato, e volta quando a regra desliga (nada é apagado).
- Crédito imobiliário: categoria e dois serviços criados desligados; fora da busca e do "Preciso para hoje" (nem forçando); habilitada pela equipe, aparece só para o perfil com canal oficial conferido; "Acessar canal oficial" redireciona ao endereço conferido.
- Busca de serviço sem prestador mostra "Estamos cadastrando profissionais para este serviço".
- Corrigido: salvar configurações na administração (coleta de CPF e a nova regra) falhava porque o histórico não tinha alvo.

## Rodada 8 (25/11/2026): Comunidade de Campo Grande — todos passando

Unitários (16), banco/API (40) e E2E (34 cenários × computador e celular = 68).

- Trabalho e divulgação: só prestador publicado com área confirmada e serviço do próprio perfil (Zé, sem área, é barrado); divulgação exige texto.
- Pedido de indicação: qualquer conta com nome público; categoria ou serviço; sem preço; só o autor marca "Indicação encontrada"; comentário indica perfil público (pausado não).
- Filtros: tipo, categoria e bairro pela área de atendimento (cidade inteira entra em qualquer bairro; pedido para a cidade toda também); paginação por data + id sem repetir nem pular.
- Salvos privados; respostas de um nível; só quem escreveu edita o comentário; ocultar pelo autor do post fica no histórico.
- Mídia privada: endereço público recusado, link assinado só para posts visíveis; perfil suspenso tira post e mídia e eles voltam quando o perfil volta; ocultação pela moderação idem.
- Envio repetido com o mesmo token não duplica; após falha, o formulário mantém o texto e reaproveita as fotos já enviadas.
- Telas: visitante filtra (com filtros ativos e "Tirar os filtros"), abre o post, salva, entra e volta ao post; galeria com Antes/Depois, setas e teclado;
  prestador publica antes e depois reordenando, edita (texto e fotos) e outra conta vê "Acesso restrito"; vídeo curto; morador pede indicação,
  recebe indicação de perfil, responde e marca encontrada; denúncia → moderação oculta → link mostra "Publicação indisponível"; autor apaga em Minhas publicações.

## Rodada 7 (25/11/2026): publicações com foto, vídeo e comentários — todos passando

Unitários (15), banco/API (33) e E2E (31 cenários × computador e celular = 62).

- Só prestador com perfil publicado publica, e só no próprio perfil; estado e data não vêm do cliente; perfil pausado ou suspenso some do feed.
- Mídia: arquivo só na própria pasta; um vídeo OU até 6 fotos; tipo proibido recusado; vídeo acima de 60 s é barrado na tela.
- Comentário: nome vem do perfil ou do cadastro (nunca do formulário de outra pessoa); quem não tem nome informa uma vez; autor da publicação oculta; denúncia sem duplicar e não pública.
- Moderação: só admin remove, com motivo e histórico; removida some e o autor não reativa.
- Telas: visitante vê publicações e é levado ao login para Útil e comentar; prestador publica fotos e vídeo; perfil mostra as publicações; autor apaga.

## Rodada 6 (25/11/2026): nova tela inicial com feed e menu por assunto — todos passando

Unitários (15), banco/API (27) e E2E (27 cenários × computador e celular = 54).

## Rodada 5 (25/11/2026): Oferecer trabalho / Enviar currículo e banco de currículos — todos passando

Unitários (15), banco/API (27) e E2E (26 cenários × computador e celular = 52).

- Banco: só quem tem vaga aberta consulta; encerrar todas as vagas tira o acesso; visitante, usuário comum e administração não veem.
- Dono cria, oculta, mostra e apaga; não usa arquivo de outra pessoa nem define o prazo; salvar renova 6 meses. Vencido some e é apagado após 30 dias.
- Quem contrata busca por cargo, baixa o PDF e abre o WhatsApp; conta sem vaga vê o banco fechado e o download dá 404.

## Rodada 4 (25/11/2026): vagas de emprego e currículos — todos passando

Unitários (15), banco/API (24) e E2E (22 cenários × computador e celular = 44). O cenário antigo “busca sem resultados” oscilou uma vez
(mesmo problema já registrado na rodada 3) e passou na repetição.

- Visitante vê só vagas abertas; encerrar tira da lista; reabrir renova 30 dias. Ninguém publica em nome de outro nem muda status/prazo direto.
- Currículo: só o candidato e quem publicou leem a candidatura; outro usuário, a administração e visitantes não. Download por outra conta dá 404, sem login 401.
- Candidatura barrada na própria vaga, com arquivo na pasta de outra pessoa, em vaga encerrada e em duplicidade. Arquivo que não é PDF é recusado.
- Quem publicou baixa o PDF (anexo, `application/pdf`) e a situação vira “Currículo visto”; atualiza para “Em contato”.
- Candidato retira a candidatura: linha e arquivo apagados. Retenção de 90 dias apaga candidaturas antigas (só o servidor chama).
- Moderação remove vaga com motivo (histórico), quem publicou não reabre; usuário comum não modera.

## Rodada 3 (25/11/2026): navegação lateral e painéis — todos passando

Unitários (11), banco/API (18) e E2E (17 cenários × computador e celular = 34). Antes da mudança: 8, 13 e 26, todos passando
(o cenário “busca sem resultados” oscilava; a espera foi trocada por uma asserção de URL e ficou estável em 8 repetições).

- Menu: opção atual com `aria-current` e texto “atual”; navegação por teclado; gaveta do celular fecha com Escape, devolve o foco e fecha ao navegar.
- Acesso: visitante em `/painel/*` vai ao login com retorno; usuário comum vê “Acesso restrito” no admin e as funções do banco recusam (prestador e visitante).
- Indicadores: publicados, disponíveis hoje e sem área conferem com as listas abertas (Campo Grande); cobertura por categoria conta cada profissional uma vez.
- Revalidação do “Atendo hoje”: tirar um bairro do dia da área habitual ajusta; tirar todos desativa.
- Busca urgente: cidade inteira inclui as duas coberturas; Centro inclui Hidro Cidade e exclui Marcos (só Carandá Bosque); diarista (fora dos quatro iniciais) aparece.
- Prestador ajusta o dia (só Centro, só Encanador), confere na busca do visitante, “Ver perfil” abre só o perfil e volta aos resultados, pausa e reativa com o estado mantido após recarregar.
- Admin suspende e reativa com confirmação e motivo; o histórico mostra o responsável e o perfil.

## Rodada 2 (25/11/2026): bairro opcional, área de atendimento e novo visual — todos passando

Unitários (9), banco/API (13) e E2E (13 cenários × computador e celular = 26). Novos cenários verificados:

- Encanador que atende toda a cidade (Hidro Cidade, demo) aparece no Carandá Bosque, no Centro e em “Todos os bairros”.
- Encanador que atende só o Carandá Bosque (Marcos, demo) aparece em “Todos os bairros” e no Carandá Bosque, e fica fora do Centro.
  Vale para a busca geral e para o “Preciso para hoje”.
- “Preciso para hoje” sem bairro: o visitante abre o WhatsApp sem conta, com a mensagem “… hoje em Campo Grande.”
- Área do dia menor que a habitual (Carlos: atende Carlota, mas hoje só Centro e Amambaí).
- Busca por bairro vazia: “Buscar em toda Campo Grande” (mantém o serviço) e “Ver todos os prestadores desse serviço”.
- Busca geral: tocar no card pede login na primeira vez e abre o WhatsApp direto ao voltar; já logado, abre direto.
- Cadastro: é preciso escolher “Atendo em toda Campo Grande” ou “Atendo em bairros selecionados”.
- Perfil antigo só com endereço (Zé Reformas, demo) fica fora da busca e vê o aviso “Confirme sua área de atendimento”.
- Serviço presencial entra no “Preciso para hoje”; serviço só online não entra; o administrador pode tirar um serviço da lista.

## Cenários executados na primeira versão (25/11/2026) — todos passando

Unitários (7): CPF (dígitos), telefone/WhatsApp com DDD, redirecionamento seguro, mensagens do WhatsApp.

Banco/API (13): visitante só vê publicados; pausado e suspenso fora da busca; dados privados restritos ao dono; número só por
função de servidor; cada prestador só edita o próprio perfil; status não editável direto; suspenso não se reativa; papel de admin
só pelo servidor; expiração à meia-noite de America/Campo_Grande (23:59, 00:01); “Atendo hoje” padrão, restrição e rejeição de bairro/serviço fora do perfil;
busca urgente (bairro, cidade inteira, fora do bairro, fora do piloto, sem disponibilidade); busca geral (área declarada x endereço de referência, cidade inteira,
sinônimos “vazamento”, “limpar piscina”, “formatar computador”, “T.I.”, sem acento, online, “Atende hoje”); contato urgente válido, desativado, vencido, fora do bairro,
fora do piloto e pausado; limite de frequência (20 por 10 min); contato geral exige login; denúncia autenticada sem duplicar.

E2E (10 cenários × computador e celular = 20): visita sem conta do início ao WhatsApp; cidade inteira; especialidade fora do piloto;
clique com resultado vencido (aviso, lista atualizada, serviço e bairro mantidos, “Ver todos nesse bairro”); busca geral com sinônimo,
filtro de bairro, login antes do contato, retorno ao mesmo perfil e mensagem editável; favoritos (salvar, listar, remover, pedir login);
busca vazia com “Procurar em toda Campo Grande” mantendo a consulta; prestador cria conta, confirma e-mail, vê erros de validação ao lado do campo,
envia foto com GPS (verificado: publicada sem EXIF), cadastra endereço e área, publica, ativa “Atendo hoje”, aparece para visitante,
desativa em um toque, pausa (sai da busca) e reativa; recuperação de senha por e-mail; admin suspende (sai da busca) e reativa com histórico;
admin adiciona sinônimo e desativa serviço mantendo vínculos.

## Não executado / depende de configuração

- Supabase real (Storage oficial, envio real de e-mail por SMTP, limites de autenticação da plataforma): testado com a stack local equivalente.
- Consulta de CEP (ViaCEP): o ambiente de teste não tinha internet para esse serviço; o caminho de preenchimento manual foi testado.
- Abertura real do WhatsApp: o teste intercepta o link `wa.me` e confere número e texto.
- Expiração à meia-noite foi testada pela função de cálculo e simulando o vencimento, não esperando o relógio virar.

## Rodada 10: visual suave (início limpo, barra lateral, perfil)

- Unidade 16/16, integração 46/46, e2e 82/82 (computador e Pixel 7).
- Início sem abas e sem caixa de filtros; links antigos com ?tipo= e ?bairro= continuam filtrando e mostram "Ver tudo".
- Perfil com capa, números (publicações, acharam útil, salvaram) e abas Trabalhos, Sobre e Publicações.

## Rodada 11: Próximo, fase 1 (identidade "Amanhecer", navegação, nova tela inicial e serviços com preço fechado)

- Unidade 16/16, integração 49/49, e2e 90/90 (computador e Pixel 7).
- Tela inicial: saudação sobre o amanhecer, "Preciso de um serviço", "Procuro trabalho", "Quero contratar", próximo encontro só com pedido marcado, nenhuma seção vazia, menu sem links repetidos.
- Barra inferior: Início · Serviços · Trabalho · Agenda · Perfil.
- "Trocar chuveiro" por R$ 90: agendar para hoje, acompanhar Solicitado → Confirmado → A caminho → Em andamento → Concluído → Avaliação, pagamento na entrega e avaliação de 1 a 5.
- Mais de um profissional: o cliente escolhe entre até 3 (nota, comparecimento, bairro, referências); outro cliente não abre o pedido; a equipe troca o profissional; o cliente cancela.
- Equipe muda o preço do pacote e o cliente vê o novo valor. O contato só aparece depois da confirmação.

## Rodada 12: Próximo, fase 2 (Trabalho e Oferecer trabalho) e paleta "Luz da Manhã"

- Unidade 23/23, integração 54/54, e2e 104/104 (computador e Pixel 7).
- Paleta "Luz da Manhã" (prompt v2) no lugar da "Amanhecer": índigo, coral e lima por tokens; Bricolage Grotesque e Inter; botões em pílula; logo com ponto índigo no "ó". Verde confiança só no selo Verificado e em segurança.
- Vagas: filtros por área, bairro, tipo, faixa salarial e formato; selo "Empresa verificada"; bloco "Por que é seguro se candidatar"; botão fixo "Enviar meu currículo" no celular.
- Currículo no app (/curriculo): barra "80% completo · falta adicionar uma referência", foto opcional, PDF.
- Candidatura em um toque com o currículo do app; telefone só se a pessoa marcar. O PDF enviado continua como opção.
- Minhas candidaturas: Enviado → Visualizado → Entrevista marcada → Aprovado/Não selecionado; confirmar ou recusar entrevista.
- Quem contrata: primeira vaga fica guardada até a equipe conferir CNPJ/CPF e endereço (/admin/contratantes); depois entra na hora com o selo.
- Painel da vaga: comparar 2 ou 3 currículos, abrir o candidato (vira "Visualizado"), convidar para entrevista (aparece na Agenda e em "Seu próximo encontro").
- Prestador: "Pacotes que eu faço" (/painel/pacotes); pedidos de pacotes desmarcados não chegam a ele; comissão só em serviço concluído.

## Rodada 13 (26/11/2026): fase 3, complemento (filtro de ofensas e notificações)

- Pacote "Fase 3 partes 1 e 2" aplicado como veio, sobre a fase 2 publicada: e2e 116/116, integração 59/59, unidade 24/24 num banco refeito do zero.
- Filtro de ofensas: post, comentário, legenda de Momento e nome público com palavra da lista não são salvos ("Quer reescrever com mais carinho?"). Acento, maiúscula e espaço duplo não enganam; palavra inteira, sem falso positivo ("mexerica" passa). O texto continua no campo.
- Administração → Palavras bloqueadas: a equipe adiciona e remove; ninguém mais vê a lista.
- Notificações (sino no topo e /notificacoes): reação, comentário, resposta e novo seguidor. Só a própria pessoa vê; ninguém cria aviso na mão; reagir de novo no mesmo post não repete o aviso; ao abrir a lista, tudo fica como lido.
- As três atualizações do banco (`2026-11-26-rede-social.sql`, `2026-11-26-dia-a-dia-momentos.sql`, `2026-11-26-moderacao-notificacoes.sql`) aplicam sem erro, nessa ordem, num banco igual ao de produção.

## Rodada 14 (26/11/2026): prompt v3, itens 1 e 2 (paleta Canteiro e navegação sem menu lateral)

- Unidade 26/26, e2e 122/122 (computador e celular).
- Paleta "Canteiro" no claro e no escuro: laranja #F47B20 sempre com texto grafite, nunca branco; nova ilustração do início (sol, prédios e guindaste).
- Sem menu lateral e sem botão "Menu". Celular: barra inferior Início · Comunidade · (+) Criar · Agenda · Perfil. Computador: os mesmos cinco no topo, com o sino.
- Criar (/criar): post do dia a dia, Momento, trabalho feito (ou "Ofereço meus serviços"), pedido de indicação e vaga.
- Perfil (/perfil): conta, pedidos, currículo, candidaturas, vagas, painel de prestador, publicações, favoritos, Administração (só para a equipe), aparência e Sair.
- Painel do prestador e Administração: abas no topo do conteúdo, com a atual destacada.

## Rodada 15 (26/11/2026): prompt v3, item 3 (cadastro obrigatório)

- Unidade 26/26, integração 65/65, e2e 128/128 (computador e celular).
- Sem conta, só abrem a página de entrada, entrar, criar conta, senha, confirmação de e-mail, Privacidade e Termos. Qualquer outro link (perfil, publicação, vaga) leva ao login com `next=` seguro e volta para o link depois de entrar ou criar a conta. As APIs respondem 401.
- No banco, o visitante deixou de ler feed, perfis, vagas, Momentos, busca e "Preciso para hoje"; catálogo, cidades e bairros continuam abertos para o cadastro e a página de entrada.
- Criar conta (uma tela): nome completo, nome público, celular com WhatsApp, bairro, e-mail, senha e aceite dos Termos e do Aviso de privacidade, com o resumo de como os dados são usados. Erro ao lado do campo, ofensa no nome pede carinho, o que foi escrito continua no formulário.
- Depois de confirmar o e-mail: "O que você quer fazer primeiro?" com as seis áreas (opcional, só define o primeiro destino).
- Conta antiga sem esses dados completa o cadastro uma vez (/completar-cadastro) e segue para onde ia; Minha conta (excluir a conta) continua aberta.
- Celular guardado só para a própria pessoa e a equipe; nunca aparece no app. Campo pronto para a confirmação por código no WhatsApp (fase 7).
- Atualização do banco `2026-11-26-cadastro-obrigatorio.sql` aplica sem erro num banco igual ao de produção, depois das três da fase 3.

## Rodada 16 (26/11/2026): fotos reais do céu no topo da Início

- Pedido do Diego: trocar a ilustração por fotos reais do céu de Campo Grande. Manhã (5h às 12h): céu azul sobre os prédios; tarde (12h às 18h): pôr do sol no lago; noite: anoitecer na Praça Nazareth. O período segue o horário de Campo Grande.
- Fotos do Wikimedia Commons, em WebP e sem metadados: Rodrigo Santos (CC BY 3.0), Camilo Carromeu (domínio público) e bigfield767 (CC BY-SA 3.0). O crédito com link para a página da foto fica no canto, como a licença pede.
- Camada escura por cima da foto para o texto branco ficar legível; conferido no computador e no celular nos três períodos.
- Arquivos estáticos (fotos e ícones) abrem sem conta, para a página de entrada poder usar.
- e2e: a foto carrega e o crédito aponta para o Commons.

## Rodada 17 (26/11/2026): prompt v3, item 4 (página de entrada)

- Integração 66/66, e2e 130/130 (computador e celular).
- Sem conta, `/` é a página de entrada: foto do céu com "Gente de confiança, perto de você.", Criar conta grátis e Entrar; as seis áreas com uma frase cada (cada uma leva ao cadastro e depois à área); sem a barra do app.
- Vitrine de vagas: "Qual vaga você procura?" mostra quantas vagas abertas combinam e até 5 (cargo, bairro e tipo). Empresa, salário e contato nunca aparecem; a consulta é uma função do banco que só devolve esses campos.
- Números de confiança só quando não são zero (hoje: profissionais verificados e vagas abertas). Bloco "Como mantemos você seguro".
- Atualização do banco `2026-11-26-pagina-entrada.sql` aplica sem erro depois de `2026-11-26-cadastro-obrigatorio.sql`.

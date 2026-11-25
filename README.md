# Resolve Aqui (nome provisório)

App web para encontrar prestadores de serviço por especialidade e bairro. Piloto em **Campo Grande–MS**:
*“Encontre quem atende no seu bairro e confirmou disponibilidade para hoje.”*

Stack: **Next.js 15 (App Router) + TypeScript + Tailwind 4 + Supabase** (Auth, Postgres com RLS, Storage).

> O nome do app fica em `NEXT_PUBLIC_APP_NAME` / `src/config/brand.ts`.

## Telas e navegação

No computador, **menu lateral esquerdo** com ícone, rótulo e a opção atual destacada (barra, negrito e o texto “atual”).
O cabeçalho mostra o nome da tela e as ações de conta. No celular, o botão **Menu** abre a mesma lista como gaveta
(Escape fecha e devolve o foco); na área de busca ficam também os atalhos inferiores. O menu muda conforme a área em uso.

| Área | Botões laterais |
| --- | --- |
| Para quem busca | Início (`/`), Preciso para hoje (`/#preciso-para-hoje` → `/hoje`), Buscar serviços (`/buscar`), Categorias (`/#categorias`), Favoritos (`/favoritos`), Sou prestador (`/sou-prestador`) ou Painel do prestador (`/painel`) |
| Prestador | Visão geral (`/painel`), Meu perfil (`/painel/perfil`), Serviços e fotos (`/painel/servicos`), Onde atendo (`/painel/atendimento`), Disponibilidade (`/painel/disponibilidade`), Prévia do perfil (`/painel/previa`), Minha conta (`/conta`), Buscar serviços |
| Administração | Visão geral, Prestadores, Catálogo, Sugestões, Denúncias, Histórico, Configurações (`/admin?aba=…`), Voltar à busca |

| Rota | O que faz |
| --- | --- |
| `/` | “Encontre prestadores em Campo Grande”: “Preciso para hoje” em destaque (bairro opcional), busca geral e categorias |
| `/hoje?servico=&bairro=` | Quem confirmou “Atende hoje”, com “Chamar no WhatsApp” sem login |
| `/buscar` | Busca por serviço, profissional ou problema. Filtros à direita no computador e em gaveta no celular; contagem e filtros ativos removíveis; endereço compartilhável |
| `/p/[slug]` | Perfil público; “Voltar aos resultados” mantém os filtros |
| `/painel` | Visão geral: Próximo passo, Meu perfil (estado e visibilidade), Atendo hoje, Área de atendimento, Perfil público (ver e copiar link) |
| `/painel/perfil` | Rascunho: etapa 1 do pré-cadastro. Publicado: nome, apresentação e contato |
| `/painel/servicos` | Especialidades, serviço principal, foto do perfil e fotos de trabalhos (mesmas validações) |
| `/painel/atendimento` → `/painel/previa` | Etapa 2 e prévia com “Publicar meu perfil” |
| `/painel/disponibilidade` | Ativar, ajustar serviços e bairros do dia, desativar |
| `/admin` | Indicadores reais por cidade, cobertura por categoria, listas filtráveis, moderação com confirmação e histórico com responsável |
| `/entrar`, `/cadastrar`, `/recuperar-senha`, `/redefinir-senha`, `/favoritos`, `/conta`, `/privacidade`, `/sugerir-servico` | Sem mudança |

### Regras da evolução dos painéis (migração `20261125000600_paineis.sql`, aditiva)

- Cobertura do perfil: cidade inteira, bairros, só online ou **pendente**. “Perfis sem área confirmada” = fora do rascunho, com endereço de referência e cobertura pendente.
- Mudou a área habitual ou os serviços com “Atendo hoje” ativo: o dia é **revalidado** (mantém o que continua válido; desativa se nada sobrar). O “Preciso para hoje” pela cidade inteira também exige cobertura confirmada.
- Indicadores e listas do admin usam a mesma função (`admin_providers`), então cada número abre a lista com os mesmos critérios. Todas as funções do admin recusam quem não é administrador.

## Configuração com um projeto Supabase

1. Crie um projeto em supabase.com.
2. Aplique as migrações (`supabase/migrations`, em ordem): `supabase link --project-ref <ref>` e `supabase db push`
   (ou cole os arquivos no SQL Editor). Elas criam tabelas, funções, RLS, bucket `profile-photos` com políticas
   e o **catálogo de lançamento** (17 categorias, 125 serviços, sinônimos, Campo Grande com 68 bairros — revise a lista de bairros com a operação).
3. Copie `.env.example` para `.env.local` e preencha URL, chave anon, **service_role (somente servidor)**,
   `NEXT_PUBLIC_SITE_URL`, `CPF_ENCRYPTION_KEY` (`openssl rand -base64 32`) e `RATE_LIMIT_SALT`.
4. Em Authentication → URL Configuration: Site URL = sua URL; Redirect URLs inclua `https://SEU-SITE/auth/confirm**`.
   Configure um SMTP próprio (o SMTP padrão do Supabase tem limite baixo).
   Opcional (recomendado, funciona em outro aparelho): nos templates de e-mail use
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}` — a rota aceita os dois formatos.
5. Defina o primeiro administrador pelo SQL (não existe tela para isso, de propósito):
   `insert into public.user_roles(user_id, role) values ('<uuid do usuário>', 'admin');`
6. `npm install && npm run build && npm start` (ou `npm run dev`).
7. Dados de demonstração (fictícios, separados do lançamento): `npm run seed:demo`. **Não rode em produção.**
   Contas: `admin@demo.resolveaqui.test`, `cliente@…`, `prestador-<chave>@…` com senha `demo-senha-123`.

## Privacidade e segurança (resumo)

- Dados públicos (`provider_profiles`, serviços, área) separados dos privados (`provider_private`: telefone, WhatsApp,
  CPF cifrado com AES-256-GCM no servidor, endereço de referência). RLS: só o dono lê/escreve os privados.
- Telefone nunca vai para busca, perfil ou HTML. O link `wa.me` é gerado no servidor (`/api/contact/*`) com limite de frequência:
  - urgente (visitante): só se o perfil está publicado e tem “Atendo hoje” vigente para o serviço, bairro e cidade;
  - busca geral: rota autenticada.
- Status do perfil só muda por funções do banco (pausar/publicar pelo dono; suspender/reativar só admin, com histórico).
- Coleta de CPF desligada por padrão; o admin só liga informando a finalidade e confirmando a necessidade.
- Fotos: só JPG/PNG/WebP até 8 MB, reprocessadas para WebP sem EXIF/GPS, gravadas na pasta do próprio usuário.
- Exclusão de conta remove perfil, dados privados, fotos e favoritos.
- O limite por IP usa `x-forwarded-for`; em produção rode atrás de um proxy que sobrescreva esse cabeçalho (ex.: Vercel).

## Testes

Veja [docs/TESTES.md](docs/TESTES.md).

## Próxima versão (proposta)

- **Avaliações** vinculadas a um atendimento confirmado pelos dois lados (cliente marca “fui atendido”, prestador confirma), uma por atendimento, com resposta do prestador e moderação.
- **Pedido de orçamento**: a pessoa descreve o serviço, bairro e fotos e envia para até 3 profissionais da mesma região; cada um responde com valor e prazo pelo painel; limite por dia para evitar spam.
- Selo de identidade apenas com processo real de verificação (documento + biometria por provedor), nunca pela checagem de dígitos do CPF.

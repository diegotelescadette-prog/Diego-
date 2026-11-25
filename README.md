# Resolve Aqui (nome provisório)

App web para encontrar prestadores de serviço por especialidade e bairro. Piloto em **Campo Grande–MS**:
*“Encontre quem atende no seu bairro e confirmou disponibilidade para hoje.”*

Stack: **Next.js 15 (App Router) + TypeScript + Tailwind 4 + Supabase** (Auth, Postgres com RLS, Storage).

> O nome do app fica em `NEXT_PUBLIC_APP_NAME` / `src/config/brand.ts`.

## Telas

| Rota | O que faz |
| --- | --- |
| `/` | Início: “Preciso para hoje” com as 4 especialidades do piloto, busca geral e “Sou prestador” |
| `/hoje?servico=&bairro=` | Resultados de quem confirmou “Atende hoje”, com “Chamar no WhatsApp” sem login |
| `/buscar` | Busca geral por nome, serviço ou problema; filtros (painel lateral / botão “Filtros” no celular) |
| `/p/[slug]` | Perfil público: serviços, área, descrição, fotos, WhatsApp, favoritos, denúncia |
| `/entrar`, `/cadastrar`, `/recuperar-senha`, `/redefinir-senha` | Conta com e-mail e senha, confirmação de e-mail e retorno à página de origem |
| `/sou-prestador` → `/painel/perfil` → `/painel/atendimento` → `/painel/previa` | Pré-cadastro em 2 etapas + prévia + “Publicar meu perfil” |
| `/painel` | Estado (Rascunho/Publicado/Pausado/Suspenso), editar, pausar/reativar, **Atendo hoje** |
| `/favoritos`, `/conta` | Favoritos; ativar perfil profissional; excluir conta e dados |
| `/admin` | Catálogo e sinônimos, sugestões, denúncias, suspensão/reativação, histórico, coleta de CPF |
| `/privacidade`, `/sugerir-servico` | Aviso de privacidade; “Sugerir um serviço” |

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

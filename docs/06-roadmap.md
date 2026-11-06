# 06 · Roadmap e Plano de Execução (v3)

Time, prazo e orçamento **não estão definidos**, então as fases não têm estimativa de duração. Cada fase tem um **critério de saída** objetivo.

| Fase | Entrega |
|---|---|
| 0 | Descoberta, design e fundação técnica |
| 1 | **MVP:** Descoberta + Aluguel (com dividir conta e mensalista) + Super básico — piloto nos 3 espaços parceiros |
| 2 | **Aulas e planos** (turmas fixas, listas de presença, mensalidades) |
| 3 | **Torneios** (categorias, duplas, chaveamento) |
| 4 | Crescimento (backlog, inclui a cobrança do SaaS) |

**Por que essa ordem:** o aluguel valida o fluxo inteiro (descoberta → agenda → reserva → gestão) e é o que leva os jogadores para o app. As aulas são o maior ganho operacional para os espaços e o que justifica a mensalidade do SaaS. Os torneios são os mais complexos e reaproveitam a agenda e os registros de pagamento.
> Se os espaços piloto priorizarem a gestão de alunos, inverter as Fases 1 e 2 (a fundação continua a mesma).

---

## Fase 0 — Descoberta e Fundação

### Produto/Design
- [ ] Fechar as perguntas pendentes (`07-perguntas-em-aberto.md`)
- [ ] Levantar os dados dos 3 espaços parceiros (`08-espacos-parceiros.md`)
- [ ] Entrevistar os donos/recepção/professores dos 3 espaços (rotina atual, regras de aula, mensalistas, torneios)
- [ ] Entrevistar 10+ jogadores/alunos dos espaços
- [x] Definir nome/marca, identidade visual e tokens
  - [x] Tokens do design system: paleta clara/escura, variante Super, tipografia, espaçamento e raios (`packages/ui-tokens`, `05-design-system.md`)
  - [x] Nome, marca e logo _(nome **Space Sports** e logo definidos; versão vetorial com o nome em contorno, ícones e PNGs em `packages/ui-tokens/brand/` (tarefa 2.27); aplicada no web (2.28, 2.33) e no app, com ícone e splash (2.29, 2.32); falta conferir o app num aparelho, nos temas claro e escuro)_
- [ ] Wireframes → protótipo no Figma das telas do MVP (app, painel do espaço, Super)
- [ ] Termos de uso, política de privacidade (LGPD) e contrato SaaS

### Contas e serviços
- [ ] Apple Developer, Google Play Console, Expo/EAS
- [x] AWS _(conta criada; é a hospedagem dos ambientes, decisão 55; serviços e região na decisão 56; estado da conta em `09-infra-aws.md`)_
- [ ] Google Maps Platform, Cloudflare R2, Resend, Sentry, PostHog
- [ ] Domínio e e-mail _(domínio `spacesports.com.br` registrado, decisão 54; DNS no Route 53 e domínio no Resend; falta confirmar o envio de e-mail)_

### Engenharia
- [ ] Monorepo pnpm + Turborepo com `apps/{mobile,web,api}` e `packages/{shared,api-client,ui-tokens,config}`
- [x] TypeScript strict, Biome/ESLint, Husky + lint-staged, Conventional Commits
- [x] Docker Compose local: Postgres+PostGIS, Redis, Mailpit
- [x] API NestJS: config por env, logger (pino), healthcheck, Swagger, tratamento de erro padrão
- [x] Drizzle + migrações + seed (esportes, amenities, BH, **3 espaços parceiros**, usuário Super)
- [x] Auth (Better Auth): e-mail/senha, Google, Apple, OTP por telefone; sessão no app e na web _(API em `/v1/auth`: e-mail/senha com verificação e reset via SMTP, cookie no web e bearer no app; Google e Apple ligam quando as credenciais estiverem no env; OTP por telefone loga o código em dev, provedor de SMS a escolher; **web (0.8b)**: entrar, cadastro, esqueci/redefinir senha e verificação de e-mail com o client do Better Auth, `/v1` por rewrite do Next; **app (0.8c)**: token no SecureStore + `Authorization: Bearer`, entrar/cadastro/esqueci a senha/verificação de e-mail/OTP/nome no primeiro acesso, rotas protegidas e logout)_
- [x] Autorização: `platform_role` (Super) + guard por espaço/papel _(`@SuperOnly()`, `@SpaceRoles()`/`@SpacePermission()` com a matriz em `packages/shared`; `GET /v1/me` com vínculos)_
- [x] Geração do cliente (orval) + hooks TanStack Query _(`packages/api-client`: funções fetch + hooks v5 gerados do OpenAPI exportado sem servidor e versionados; `ApiError` tipado, `configureApiClient` com baseUrl/headers/credentials; `pnpm generate:api-client` e check na CI)_
- [x] App Expo com Expo Router, NativeWind, RN Reusables, tema claro/escuro
- [x] Web Next.js com shadcn/ui: layouts `/painel` (com seletor de espaço) e `/super`, middleware de acesso _(tema claro/escuro e variante Super integrados a `@space-sports/ui-tokens`; **0.8b**: `proxy.ts` real valida a sessão por `GET /v1/me` — sem sessão → `/entrar`, `/super` só com `access.super`, `/painel` só com `access.management`, redirecionamento por perfil — e o seletor de espaço vem de `/v1/me`; sair no menu da conta)_
- [ ] CI GitHub Actions (lint, typecheck, test, build) — parcial: workflow criado e validado localmente, com job de E2E real do web (Playwright + Postgres/Redis; verde no runner desde o PR #1, tarefa S.1 de `docs/tarefas/staging.md`); deploy de staging (API e web) feito pela tarefa S.3, com `infra/`; EAS: `eas.json` (perfis `preview` APK/staging e `production`) e workflow manual `eas-build.yml` prontos (M.1, `docs/tarefas/mobile-lancamento.md`); projeto EAS `@lucasjorge94/space-sports` criado, variáveis do Maps e do Firebase no EAS e primeiro APK interno (perfil `preview`) gerado em 2026-11-03. O APK abre e foi conferido no emulador contra o staging (2026-11-03): cadastro, vitrine, mapa do Google, Agenda, Perfil, temas claro e escuro e o link `spacesports://espacos/<slug>`. Falta testar o push num aparelho físico (o app não registra push no emulador) e a vitrine com dados: nenhum espaço do staging tem preço e quadra. Lojas (Apple/Google Play) adiadas: por ora só APK de teste
- [ ] Sentry + PostHog nos três apps

**Critério de saída:** login funcionando no app, no painel e no Super contra a API em staging; pipeline verde.

---

## Fase 1 — MVP: Descoberta + Aluguel + Super básico

### Backend
- [x] Spaces: CRUD, endereço → geocodificação, fotos (upload pré-assinado), amenities, horário de funcionamento, formas de pagamento aceitas _(painel em `/v1/manage/spaces/:spaceId`: leitura para toda a equipe, edição Dono/Admin; geocoder Google atrás de interface (`GOOGLE_MAPS_API_KEY`); fotos no R2 por URL pré-assinada SigV4 (`R2_*`), capa = posição 0, reordenação, até 20 fotos; guard de espaço respeita `spaces.status` (suspenso/encerrado = só leitura, `SPACE_READ_ONLY`). Criar, suspender e encerrar espaço ficam no Super)_
- [x] `space_settings` (preço/hora, valor geral do mensalista + vencimento, durações, antecedência, janela, prazo de cancelamento) _(PATCH parcial validado inteiro com Zod de `packages/shared`: múltiplos de 30 min, mínimo ≤ máximo, padrões da seção 2.1 do doc 02)_
- [x] Courts: CRUD, esportes por quadra, capacidade _(até 20 jogadores, também em CHECK no banco; quadra com reserva não é excluída: usar INACTIVE)_
- [x] Busca geográfica com filtros + paginação por cursor _(`GET /v1/spaces`: raio PostGIS, esporte, serviço, infraestrutura, nome; cursor keyset por distância ou nome; só espaços visíveis pela RN-SPACE-01; `GET /v1/spaces/:slug`; favoritos em `PUT/DELETE /v1/spaces/:spaceId/favorite` e `GET /v1/me/favorites`; catálogos públicos `/v1/sports`, `/v1/amenities`, `/v1/cities`)_
- [x] Cálculo de preço proporcional em frações de 30 min em `packages/shared` (com testes: 1h, 1h30, 2h, 3h, arredondamento)
- [x] `court_occupations` com constraint de exclusão + bloqueios manuais _(bloqueios em `/v1/manage/spaces/:spaceId/court-blocks`, kind `BLOCK`; conflito → 409 `SLOT_UNAVAILABLE`)_
- [x] Disponibilidade: slots livres de 30 em 30 min por quadra/data/duração, respeitando o funcionamento _(`GET /v1/spaces/:spaceId/availability`, pública; regras puras em `packages/shared/src/availability.ts`, também com duração mín./máx., antecedência e janela)_
- [x] Booking: criar (confirmada na hora, sem aprovação), cancelar com prazo, reserva de balcão, concluir, no-show _(jogador em `/v1/bookings`, gestão em `/v1/manage/spaces/:spaceId/bookings`; minhas reservas e reservas do espaço com filtros e cursor)_
- [x] Dividir conta: convites (link/deep link), aceite, parte de cada um, pagamento por participante _(deep link `spacesports://convite/<token>`; aceite/recusa em `/v1/invites/:token`)_
- [x] Mensalista: solicitação, aprovação, geração semanal das ocorrências (job), pausa/retomada/encerramento, conflitos; sem cobrança na plataforma (decisão 27) _(jogador em `/v1/recurring-bookings`, gestão em `/v1/manage/spaces/:spaceId/recurring-bookings` + `recurring-conflicts`; aprovar/retomar com horário ocupado por reserva ou aula → 409 `SLOT_UNAVAILABLE`, bloqueio/torneio é sinalizado em `recurring-conflicts`; inativar a conta não mexe nos mensalistas (decisão 29); código em `apps/api/src/recurring/`)_
- [x] PaymentRecords: registrar/estornar pagamento de reserva e de participante, "a receber hoje" _(`POST …/payments` e `…/payments/:id/reverse`, `GET …/receivables/today`; pagamentos antigos do mensalista seguem no extrato e ainda podem ser estornados, sem registro novo)_
- [x] Equipe: convites, papéis múltiplos por espaço _(API feita na 1.4: convite por e-mail com token de 7 dias, aceite, reenvio/revogação, troca de papéis, remoção, regras do Dono/Admin; falta o web)_
- [x] Jobs: gerar ocorrências de mensalistas, lembretes _(fila BullMQ `recurring` com `generate-occurrences` às 03:00 de America/Sao_Paulo; falha parcial (um mensalista) faz o job falhar no fim para o BullMQ tentar de novo (3 tentativas), sem duplicar ocorrências. Mensalidade de mensalista removida (decisão 27, tarefa 6.1): sem `generate-charges` (o agendamento antigo é apagado do Redis na subida e um job dele ainda na fila é descartado), sem dispensa nem `charge.waive`, sem `recurringMonthlyPriceCents`/`recurringBillingDay` nas configurações; tabelas `recurring_booking_charges` e pagamentos antigos ficam (extrato e estorno), sem migração; retomada reativa só as ocorrências marcadas em `bookings.cancelled_by_pause` (migração 0010). Lembrete de reserva (1.6): fila `notification-schedules` (concorrência 1, separada dos pushes) a cada minuto, `bookings.reminder_sent_at` garante um lembrete por reserva; antecedência em `BOOKING_REMINDER_LEAD_MIN`, padrão 120 min, tudo ligado por `JOBS_ENABLED`)_
- [ ] Notificações push (Expo) + e-mail transacional _(feito na 1.6: `devices` + `notifications` + `notification_preferences`; `PUT/DELETE /v1/me/devices`, `GET /v1/me/notifications` (cursor, `unread`), `POST …/:id/read` e `…/read-all`, `GET/PATCH /v1/me/notification-preferences` (push e central por tipo). Eventos de domínio (`DomainEvents`) → `NotificationsService`; envio pela fila BullMQ `notifications` (concorrência 10, 5 tentativas, backoff exponencial) com `PushSender` (Expo; fake nos testes); sem push duplicado: cada push tem uma chave de idempotência gravada em `push_deliveries` antes do envio (migração 0010), e falhas depois do envio (Redis fora do ar ao agendar os recibos) só são logadas; tokens `DeviceNotRegistered` apagados no ticket e no recibo (consultado 15 min depois). Cobre reserva confirmada/cancelada e lembrete, mensalista aprovado/recusado (`recurring.approved|rejected`) e convite direto para dividir a conta (`booking.invite_created`, com `userIds` em `POST /v1/bookings/:id/invites`). E-mail: boas-vindas feito; o convite de equipe (1.4) sai por e-mail em segundo plano)_
- [x] Super: CRUD de espaços (já nasce ativo), suspender/reativar, convite do Dono, checklist de implantação, catálogos, usuários, modo suporte auditado, financeiro consolidado (leitura dos registros de pagamento) _(tarefa 1.5, tudo sob `/v1/super/...` com `@SuperOnly()`: espaços (lista/filtros, criar já `ACTIVE`, editar, suspender/reativar/encerrar, checklist calculado), modo suporte (`POST /v1/super/spaces/:id/support-sessions` + header `X-Support-Session` nas rotas `/v1/manage/spaces/:id/...`, valendo como Dono só naquele espaço, 2 h, cada requisição em `audit_logs`, respostas com `X-Support-Mode`), financeiro (`summary` + `payments.csv`), catálogos (esportes, infraestrutura, cidades; níveis só leitura), usuários (busca, vínculos, bloquear = encerra sessões, desbloquear também reativa a conta `INACTIVE`, pedidos de exclusão LGPD que só anonimizam), usuários Super (promover exige e-mail verificado), métricas por espaço e log de auditoria global com cursor. Convite do Dono: interface `OwnerInviter` com implementação provisória até a 1.4 (`LINKED`/`AWAITING_SIGNUP`/`AWAITING_VERIFICATION`: só e-mail verificado vira Dono). Pendências: níveis editáveis exigem trocar o enum por tabela; métricas de alunos/presenças/torneios valem 0 até a Fase 2; checklist sem turmas/planos até a Fase 2)_

### App
- [x] Onboarding + login + permissão de localização _(login feito na 0.8c; onboarding da permissão em `localizacao` (uma vez, depois do primeiro login) com `expo-location`; negar mantém a vitrine por nome, e o banner "Ativar" leva ao pedido ou às Configurações)_
- [x] Vitrine (FlashList) + filtros + busca + mapa _(Explorar e Mapa dividem busca e filtros (raio, esporte, serviço, infraestrutura); lista com cursor e pull-to-refresh; mapa com `react-native-maps`. Falta: filtro por disponibilidade em data/hora (RF-SPACE-06). Chave do Maps no Android criada no projeto Google Cloud `space-sports-513612` (só Maps SDK for Android, restrita ao pacote `br.com.spacesports.app` com o SHA-1 do EAS) e lida de `GOOGLE_MAPS_ANDROID_API_KEY` no `app.config.ts` (M.1))_
- [x] Página do espaço (galeria, infra, localização, contatos, formas de pagamento, aba Alugar) _(`espaco/[slug]`; abas Aulas e Torneios mostram "em breve" até as Fases 2 e 3)_
- [x] Fluxo de reserva completo com preço calculado e forma de pagamento no local _(`espaco/[slug]/reservar`: esporte → data → duração → horário → quadra → pessoas → forma de pagamento; `SLOT_UNAVAILABLE` volta à escolha com a grade atualizada; detalhe em `reserva/[id]` com cancelamento até `cancellableUntil`)_
- [x] Convidar jogadores / dividir conta; aceitar convite via deep link _(convites por nome, compartilhar/copiar/revogar em `reserva/[id]`; `convite/[token]` aceita/recusa; deslogado guarda o token e volta ao convite depois do login)_
- [x] Solicitar mensalista e acompanhar o status _(`espaco/[slug]/mensalista`, lista em `mensalistas` (atalho no Perfil) e detalhe com mensalidades e encerrar/retirar)_
- [x] Minhas reservas (próximas/passadas, cancelar dentro do prazo, adicionar ao calendário, como chegar) _(aba Agenda lista próximas/passadas com cursor e abre `reserva/[id]`; ali entram "Adicionar ao calendário" (tela de evento do sistema, sem permissão de leitura/escrita: iOS `writeOnlyAccess`, Android `blockedPermissions`) e "Como chegar" (só com coordenadas cadastradas))_
- [x] Favoritos, perfil, notificações _(`/favoritos`, `/editar-perfil`, central em `/notificacoes` (lida/não lida, filtro, marcar todas) e preferências por tipo em `/preferencias-notificacoes`, com atalhos no Perfil; o registro do token push e o toque na notificação são da 2.4)_
- [x] Inativação de conta (RF-AUTH-03, decisão 29 revisada) _(API (tarefa 6.5), web e app (6.6 e 6.7): `POST /v1/me/deactivate` (204) marca a conta `INACTIVE` (enum `user_status`, migração `0011_user_status_inactive`) e encerra todas as sessões, numa transação auditada (`user.deactivate`); não anonimiza nem cancela nada (reservas, mensalistas, pagamentos e vínculos ficam; valores em aberto não barram). Travas: 409 `LAST_OWNER` (único Dono com conta ativa de um espaço; Dono inativo/bloqueado não conta) e 409 `SUPER_ACCOUNT`. Conta inativa: login responde 403 `ACCOUNT_INACTIVE` e sessão que sobrar recebe 403 `ACCOUNT_INACTIVE` nas rotas. `POST /v1/auth/delete-user` desligado (404; `deprecated` no OpenAPI); a exclusão definitiva (anonimização/LGPD, exigência das lojas) fica para uma feature futura (pergunta 10). Reativação só pelo Super (`POST /v1/super/users/:id/unblock`, auditado como `super.user.reactivate`). Web: status `INACTIVE`, filtro «Inativas» e «Reativar conta» no Super; app: tela «Inativar conta» e `ACCOUNT_INACTIVE` no login)_
- [x] Exclusão de conta por pedido validado pela equipe (RF-AUTH-03, decisão 40) _(tarefas 2.20 API, 2.21 web com a página pública `/excluir-conta`, 2.22 mobile. **API pronta (2.20):** `POST /v1/me/deletion-request` (senha ou sessão de até 10 min; 201 com `dueAt` = pedido + 15 dias) e `POST /v1/public/deletion-request` (e-mail e senha, 202 genérico, rate limit por IP e por e-mail) criam o pedido `USER` e inativam a conta; 409 `DELETION_REQUEST_PENDING`, `LAST_OWNER`, `SUPER_ACCOUNT`. Super: lista com prazo (`overdue`, pendentes do mais antigo), origem, motivo e pendências por espaço; atender cancela reservas futuras, mensalistas, assinaturas e presenças futuras (promovendo a espera) antes de anonimizar, sem avisar a gestão dos espaços (a exclusão é só do Super; o tipo `CUSTOMER_ACCOUNT_DELETED` saiu na 2.23, migração `0017`); recusar mantém inativa; novo `POST /v1/super/deletion-requests/:id/cancel` reativa. E-mails de recebido, concluído e recusado; auditoria `user.deletion_request` e `super.deletion_request.*`; migração `0016`. Pendentes: web e mobile **Web (2.21/2.25) e mobile (2.22/2.24) prontos:** `/super` com origem, prazo, pendências e as ações atender/recusar/cancelar; página pública `/excluir-conta` com link no rodapé; "Excluir minha conta" no Perfil do app. Decisão 40, item 6 (2.23): a exclusão é só do Super, sem aviso aos espaços (`CUSTOMER_ACCOUNT_DELETED` removida, migração 0017); o pedido e a inativação apagam os dispositivos de push (2.23, 2.26). Pendente: canal de atendimento na página (pergunta 42).)_
- [x] Visão de equipe (somente leitura): reservas e aulas de hoje e informações do espaço para quem tem vínculo (RN-AUTH-04); a gestão fica no painel web _(aba Meu Espaço usa `GET /v1/me/staff-spaces` (agenda do dia com as reservas e as aulas de hoje, papéis, status) e `GET /v1/spaces/:slug` (endereço, telefone, horários); sem ações de escrita)_

### Painel do espaço
- [x] Dados, fotos, quadras e configurações
- [x] Agenda por quadra (dia/semana), reserva de balcão, bloqueios
- [x] Mensalistas: solicitações, aprovar/recusar, pausar/retomar/encerrar, cadastro de balcão e conflitos de agenda _(sem mensalidades: o mensalista só ocupa horário e o pagamento é direto no espaço; decisões 27 a 30. Tarefa 6.2 removeu do painel as abas Mensalidades e Inadimplentes, o valor mensal e o dia de vencimento das Configurações, a dispensa e as mensalidades em aberto do financeiro do Super; o extrato ainda lista pagamentos antigos de mensalidade)_
- [x] Reservas com filtros; detalhe com participantes e pagamentos
- [x] Recebimentos: a receber hoje, extrato por período/forma, CSV _(feito: a receber hoje e CSV dele, registro/estorno; API do extrato pronta na tarefa 3.1: `GET /v1/manage/spaces/:spaceId/statement` (`from`/`to` em UTC, `[from, to)`; `method`; `service` = `RENTAL`/`RECURRING`; cursor; `totals` e `byMethod` em centavos sem estornos, `totals.reversedCents`) e `GET …/statement.csv`, com a permissão `payment.record` (Dono, Admin, Recepção; ver pergunta 12 em `docs/07`); tela do extrato no web em `/painel/recebimentos` → aba Extrato: período em America/Sao_Paulo enviado em UTC `[from, to)`, forma, serviço, cursor, totais e por forma, estornos separados, CSV; a permissão fica em `STATEMENT_PERMISSION` (`apps/web/src/lib/painel/statement.ts`), único ponto a trocar se a pergunta 12 mudar)_
- [x] Equipe: convidar Admin/Recepção/Professor
- [x] Página pública do espaço (SEO + "abrir no app") _(`/espacos/[slug]`; "abrir no app" `spacesports://espacos/<slug>` abre o espaço no app, inclusive deslogado (M.1); o `SITE_URL` espera o domínio)_

### Painel Super
- [x] Dashboard simples (espaços, usuários, reservas) _(`/super`: totais + uso por espaço do período, RF-SUPER-09)_
- [x] Espaços: lista, criação, detalhe, ativar/suspender, modo suporte _(`/super/espacos[/novo|/:id|/:id/editar]`: filtros por nome/status/cidade/esporte, criar, editar, suspender/reativar/encerrar com motivo, convidar Dono; modo suporte com motivo obrigatório, header `X-Support-Session` só nas rotas `/v1/manage/spaces/:id/...` do espaço da sessão, faixa fixa com "Sair do modo suporte", cookie de roteamento `space-sports.support` para o `proxy.ts` liberar o `/painel` ao Super)_
- [x] Implantação: checklist por espaço _(`/super/implantacoes` + checklist no detalhe do espaço)_
- [x] Financeiro consolidado (recebido por espaço/serviço/forma, em aberto, CSV) _(`/super/financeiro`)_
- [x] Usuários e catálogos _(`/super/usuarios`: busca, vínculos, bloquear/desbloquear, pedidos LGPD, equipe Super; `/super/catalogos`: esportes, infraestrutura e cidades editáveis, níveis só leitura; `/super/auditoria`: log global com cursor)_

### Qualidade e lançamento
- [x] Testes: preço proporcional, disponibilidade, concorrência (dois usuários no mesmo slot), prazo de cancelamento, geração de mensalistas e mensalidades, permissões por papel _(feitos na API: `apps/api/test/bookings/` e `apps/api/test/recurring/`)_
- [ ] E2E: fluxo de reserva (Maestro) e agenda (Playwright) _(Playwright contra a API real em `apps/web/e2e/real`: agenda de aluguel (9 testes) e **Aulas** (`aulas.spec.ts`, 10 testes em sequência, tarefa 2.17): turma e plano criados pelo painel com as sessões geradas na hora (RF-CLASS-02/03), pedidos dos jogadores pela API do aluno e aprovação no painel (RF-CLASS-04/05, RN-CLASS-01), turma lotada recusa o terceiro com `CLASS_GROUP_FULL` (RN-CLASS-02), lista manual fechada até a gestão abrir (RN-CLASS-04), sessão lotada com espera e posição, desistência com promoção (RN-CLASS-03/05, RF-CLASS-10), presença real recusada antes do início e marcada numa aula em andamento (RF-CLASS-09) e o Professor só com as próprias turmas e aulas, sem Alunos/Mensalidades no menu; lacunas: prazo de desistência vencido, modo automático da lista e bloqueio por mensalidade atrasada (RN-CLASS-06) e pausa (RN-CLASS-07) sem teste real; Maestro escrito em `apps/mobile/.maestro` com `testID` nas telas do fluxo, ainda não executado)_
- [x] Identidade visual do kit de marca (2026-10-29, `docs/brand/kit/` v1.1, claro e escuro) _(Onda 6: **2.27** tokens dos dois temas pela prancha 07 (Sol como ação principal no escuro; `info`, `link`, `ring-offset`, `-subtle` de status; primitivas `mar`/`sol`/`neutral`), Space Grotesk + Inter, raios 6/12/16/24, logos SVG/PNG por `pnpm brand`; **2.28** web: `Logo` na sidebar de `/painel` e `/super`, telas de entrada e páginas públicas, favicon/apple-icon/Open Graph, badges `-subtle`, chip de esporte, anel de foco com offset; **2.29** app: ícone, adaptive icon e splash da marca, `Logo` no AuthLayout e na Vitrine, botões/chips/badges/campos/cards do kit. Pendentes: capturas e conferência visual do app no aparelho (claro e escuro) e Maestro não executado; `metadataBase` global do Open Graph depende do domínio (pergunta 9). Onda 7: **2.34** auditoria do web contra o kit (`docs/brand/auditoria-web.md`, com capturas) e tokens das peças do kit (`inverse`, `disabled`, `link-hover`, `eyebrow`, `input-*`, `chip*`, `scrim`; correção do vazamento do claro no Super escuro); **2.35** web aplica a auditoria nos componentes e telas, nos dois temas e no Super; **Onda 9:** **2.37** tokens de contorno, campo desabilitado e aba ativa, **2.38** ajustes finais, Inter aplicada de fato e capturas em `docs/brand/auditoria-web/depois/`)_
- [x] Logo do espaço (RF-SPACE-11, decisão 44) e parceiros atualizados no seed (decisão 43) _(**2.30/2.31** API: `spaces.logo_url` (migração 0018), upload por URL pré-assinada com imagem quadrada até 2 MB, cópia publicada em chave própria, `logoUrl` nas respostas do espaço; seed com Duna Sports no lugar da Arena 7 e as quadras dos parceiros; `pnpm db:seed:demo` com Dono e professores. **2.28** web: upload na aba Espaço e `SpaceAvatar` no seletor, no Super e na página pública; **2.29** app: logo na vitrine, mapa, página do espaço, favoritos e Meu Espaço. No modo suporte o seletor mostra as iniciais (a sessão de suporte não traz `logoUrl`))_
- [ ] Implantação assistida dos 3 espaços parceiros (Astral Beach Sports, Arena Errejota e Duna Sports) _(a expiração de `uploads/` agora vem do CDK, decisão 72; confirmar a cidade da Duna Sports e os nomes dos professores de Errejota e Duna)_
- [ ] Pendências de segurança (`10-seguranca.md`)
- [ ] Beta fechado (TestFlight / teste interno do Play) com os jogadores dos espaços
- [ ] Publicação nas lojas (assets, política de privacidade, conta demo para revisão)

**Critério de saída:** os 3 espaços parceiros com a agenda de aluguel 100% na plataforma; zero dupla reserva.

---

## Fase 2 — Aulas e Planos

### Backend
- [x] Professores (vínculo `TEACHER`) _(tarefa 2.1: convite/remoção pelo fluxo de equipe com `role: TEACHER`; `GET /v1/manage/spaces/:spaceId/teachers`; tirar o papel de quem dá turma ativa → 409 `TEACHER_HAS_CLASS_GROUPS`; um usuário pode ser professor em vários espaços, decisão 26)_
- [x] Turmas fixas + job de geração de sessões + ocupação da quadra _(tarefa 2.1: CRUD em `/v1/manage/spaces/:spaceId/class-groups`, conflito de agenda com turmas/mensalistas (horário semanal) e reservas/bloqueios (próximas 4 semanas) → 409 `CLASS_SCHEDULE_CONFLICT`; fila BullMQ `class-sessions` com `generate-sessions` às 03:15 de America/Sao_Paulo, idempotente, 3 tentativas, conflitos sinalizados em `class-session-conflicts`; editar regenera só sessões futuras sem confirmações; capacidade da sessão ajustável; migração 0012 com todas as tabelas de Aulas; código em `apps/api/src/classes/`)_
- [x] Planos (Nx/semana = N turmas fixas; ilimitado = sem limite nas turmas matriculadas) e assinaturas: solicitação, aprovação, matrícula nas turmas fixas, troca de turma, pausa, cancelamento _(planos feitos na 2.1: CRUD em `/v1/manage/spaces/:spaceId/plans` e leitura pública de planos e turmas com vagas em `/v1/spaces/:slug/classes`; assinaturas na 2.2: aluno em `/v1/me/subscriptions` (pedir escolhendo as turmas, forma de pagamento, pausar/retomar, cancelar no fim do ciclo, trocar de turma, mensalidades), gestão em `/v1/manage/spaces/:spaceId/subscriptions` (aprovar/recusar, pausar/retomar/cancelar, trocar, matricular/desmatricular); preço em snapshot; uma assinatura em aberto por plano; migração 0013; contrato na seção 2.2 de `docs/tarefas/fase-2.md`)_
- [x] Validação de capacidade da turma (matrículas) e da sessão (confirmações) _(2.1: a capacidade da turma não desce abaixo das matrículas ativas nem a da sessão abaixo dos confirmados; 2.3: confirmação sob trava da linha da sessão (`FOR UPDATE`), excedentes na espera; 2.2: aprovação, troca de turma e nova matrícula travam as turmas (`FOR UPDATE`, em ordem de id) e conferem as matrículas ativas (RN-CLASS-02, teste de duas aprovações simultâneas na última vaga); 2.5: `PRESENT` e `ABSENT` também ocupam vaga na inclusão, na promoção e no ajuste da capacidade)_
- [x] Lista de presença: modo automático (job 1/min) e manual; abrir/fechar/reabrir; auditoria _(tarefa 2.3: fila BullMQ `class-attendance`, job `attendance-tick` a cada minuto (abre/fecha no AUTOMATIC, `DONE` depois do fim, idempotente, 3 tentativas); `POST …/class-sessions/:id/open|close` para Dono/Admin/Professor (só as dele); reabrir depois do fechamento automático segura a lista aberta; `class_session.open|reopen|close` em `audit_logs`, as do job sem ator; 2.5: `class_session.done` auditado em lote)_
- [x] Confirmar/desistir com prazo; lista de espera com promoção automática _(tarefa 2.3: `/v1/me/class-sessions` (semana/dia, detalhe, `POST|DELETE …/:id/attendance`); só nas turmas com matrícula ativa (decisão 24); bloqueio por pausa e por atraso (RN-CLASS-06/07); desistência até `attendance_cancel_deadline_min`; espera com `waitlist_position` sob trava e promoção automática)_
- [x] Marcar presença real (presente/faltou); cancelar sessão com aviso; substituir professor _(tarefa 2.3: `PUT …/presence`, `POST …/cancel` (libera a quadra), `PATCH …/class-sessions/:id` com `teacherMemberId`; adicionar/remover aluno; histórico `GET …/class-attendances` e frequência `GET …/class-groups/:id/frequency`)_
- [x] Mensalidades: geração por ciclo, vencimento, atraso → `PAST_DUE` → bloqueio de confirmação (configurável) _(2.2 feito: fila BullMQ `subscriptions` (`process-billing` de hora em hora, cada assinatura uma vez por dia depois da meia-noite do fuso do espaço (2.7), e `send-charge-reminders` às 09:00 de America/Sao_Paulo, idempotentes, 3 tentativas) gera a mensalidade do mês (ciclo = mês do calendário, vencimento no `billing_day`, sem pró-rata), marca `OVERDUE`, leva a `PAST_DUE` com mais de `past_due_block_days` de atraso (regra ligada) e volta a `ACTIVE` ao pagar/dispensar; pagamento por `POST …/payments` com `payableType: SUBSCRIPTION_CHARGE`, estorno, dispensa (`charge.waive`, Dono/Admin), listas `…/subscription-charges` e `…/subscription-charges/delinquents`, extrato com o serviço `CLASS`; 2.7: pausa mínima de 7 dias pelo aluno (`min_pause_days`, decisão 33) e avisos com o valor em aberto. 2.3: o bloqueio na confirmação de presença pelo status `PAST_DUE` está feito, com a regra configurável)_
- [x] Notificações: lista aberta, promovido da espera, aula cancelada, mensalidade próxima/vencida _(2.2: `SUBSCRIPTION_APPROVED`, `SUBSCRIPTION_REJECTED`, `SUBSCRIPTION_CHARGE_DUE_SOON` (até 3 dias antes) e `SUBSCRIPTION_CHARGE_OVERDUE`, por eventos de domínio; 2.3: `CLASS_LIST_OPEN`, `CLASS_WAITLIST_PROMOTED`, `CLASS_SESSION_CANCELLED`)_
- [x] Choque de horário entre aulas do mesmo aluno em qualquer esporte, plano ou espaço (decisão 37) e pausa por mês inteiro (decisão 41) _(tarefa 2.19 API; 2.21 web; 2.22 mobile. **API feita (2.19):** matrícula (pedido, aprovação, troca, matrícula pela gestão) recusa turma com horário semanal coincidente em qualquer assinatura em aberto, pendente e outro espaço inclusive, no fuso de cada espaço (409 `CLASS_SCHEDULE_OVERLAP`); confirmação e inclusão pela gestão recusam aula sobreposta a outra em que o aluno está confirmado, na espera ou presente (409 `CLASS_SESSION_OVERLAP`, `blockedReason` `SCHEDULE_OVERLAP`), serializado por aluno com advisory lock; pausa em meses inteiros (`startMonth` + `months`, `max_pause_months_per_year` no espaço e no plano, saldo por ano em `subscription_pause_months`, pausa agendada que o job inicia no dia 1, retomada que devolve os meses não iniciados e cobra o mês em andamento, cancelamento da agendada), fim de `min_pause_days`/`PAUSE_TOO_SHORT`; migração 0015. Falta web e mobile **Web (2.21/2.25) e mobile (2.22/2.24) prontos:** mensagens dos choques com a turma que conflita (fuso quando fora de Brasília), pausa por mês no painel (pausar, retomar, cancelar a pausa agendada e cancelar a assinatura) e no app ("Trancar o plano" com saldo por ano). Ajustes da API nas 2.23 e 2.26 (retomada no dia 1, cancelamento com pausa agendada ou em curso, payload do choque sem o status).)_

### App
- [x] Aba Aulas na página do espaço: planos e turmas com vagas; contratar escolhendo as turmas _(tarefa 2.13: aba "Aulas" em `espaco/[slug]` com planos (preço, vencimento, regra de pausa) e turmas com vagas (`GET /v1/spaces/:slug/classes`); `espaco/[slug]/contratar` pede o plano com Nx/semana = exatamente N turmas e ilimitado = as turmas escolhidas, trava turma lotada e turmas no mesmo horário, e envia a forma de pagamento preferida; sem reposição, decisão 24; código em `apps/mobile/src/features/classes/`)_
- [x] Meu plano: turmas, mensalidades (pagas/pendentes), pausar/cancelar/trocar turma, forma de pagamento preferida _(tarefa 2.13: `planos` (lista, também no Perfil) e `planos/[id]`: assinatura e estado, turmas, próxima mensalidade, histórico pago/pendente, pausar de hoje por N dias (mínimo do espaço `pauseMinDays` e saldo do ano, erros `PAUSE_TOO_SHORT`/`PAUSE_LIMIT_EXCEEDED` em português), retomar, cancelar (termina no fim do mês, RN-CLASS-08), trocar turma e preferência de pagamento; o pagamento é direto no espaço; 2.14: retomar a pausa pede confirmação e, antes de `pauseMinDays` dias usados, avisa que a mensalidade da pausa volta a ser cobrada; trocar de turma seleciona e depois confirma; a folha de pausa fecha se o saldo deixa de permitir)_
- [x] Aulas da semana/dia; detalhe com lista de presença; confirmar/desistir; posição na espera _(tarefa 2.13: Agenda ganhou a seção "Aulas" (semana a semana, por dia) e `aulas/[id]` com professor, horário no fuso do espaço, quadra, status da lista, confirmados e posição na espera; confirmar/desistir pelo `canConfirm`/`canWithdraw` e `blockedReason`, e os códigos `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_PAST_DUE`, `ATTENDANCE_LIST_NOT_OPEN` e `CANCEL_DEADLINE_PASSED` tratados; push de aula e de assinatura abre a tela certa; 2.14: aula cancelada mostra "Aula cancelada" em vez de presença confirmada e o bloqueio de lista não aberta segue o status da aula)_
- [x] Visão de equipe (Professor/Admin, somente leitura): aulas de hoje, horários, listas de presença e presenças; abrir/fechar lista e marcar presença ficam no painel web _(tarefa 2.13: card "Aulas de hoje" na aba Meu Espaço com horário, quadra, professor, status, vagas e espera, e a lista de presença expansível (presente/faltou/confirmado/espera); sem valores e sem ações de gestão)_

### Painel do espaço
- [x] CRUD de turmas, planos e professores _(tarefa 2.10: `/painel/aulas/turmas` (lista com vagas e matrículas; criar/editar/desativar/reativar/excluir; esporte restrito aos da quadra; aviso das aulas que o job não gerou por conflito), `/painel/aulas/planos` (frequência 1x a 5x ou ilimitado, valor em centavos, vencimento 1 a 28, pausa e limite próprio) e `/painel/aulas/professores` (listar, convidar com papel `TEACHER`, remover: quem só é professor sai da equipe, quem tem outro papel perde só o de professor; convites em aberto). Dono/Admin gerem, Recepção lê e o Professor vê só as próprias turmas; erros por código (`CLASS_SCHEDULE_CONFLICT` com o que conflita, `SPORT_CHANGE_NOT_ALLOWED`, `COURT_HAS_CLASS_GROUPS` também em Quadras, `TEACHER_HAS_CLASS_GROUPS` etc.)_
- [x] Configuração da lista de presença (automática: abre/fecha X antes; ou manual) _(tarefa 2.10, em Espaço → Configurações: modo, abre/fecha, prazo de desistência, bloqueio por atraso (liga/desliga e dias), limite de pausa por ano e mínimo por pedido)_
- [x] Calendário de sessões; detalhe com lista, abrir/fechar, adicionar/remover aluno, presença _(tarefa 2.11: `/painel/aulas/sessoes` (semana/dia, filtros de turma/professor/situação; o Professor só vê as próprias), `/painel/aulas/sessoes/:id` (lista de presença com espera e posição, abrir/fechar/reabrir, adicionar aluno por busca, remover com tratamento do 409 `PRESENCE_ALREADY_MARKED`, presente/faltou a partir do início da aula, `confirmedCount` lido como vagas ocupadas; cancelar com motivo e trocar o professor só para Dono/Admin, decisão 32) e `/painel/aulas/sessoes/presencas` (frequência por turma e histórico por aluno); código em `components/painel/aulas/sessoes/` e `lib/painel/sessions*.ts`; e2e com API simulada em `e2e/aulas-sessoes.spec.ts`. Pendência de API: não há busca de usuários, então "adicionar aluno" busca entre os matriculados da turma e, para Dono/Admin/Recepção, entre os alunos com assinatura do espaço; a frequência por turma já existe aqui, mas o item de relatórios fica para a 2.12)_
- [x] Alunos: matrículas, aprovações, status, histórico de presença _(tarefa 2.12: `/painel/aulas/alunos` (`enrollment.manage`: Dono, Admin e Recepção; o Professor vê «Sem permissão») com abas por situação e destaque dos pedidos aguardando; filtros por plano e turma; aprovar (confirma ou troca as turmas pedidas: Nx = exatamente N, ilimitado = 1+; `CLASS_GROUP_FULL` e demais erros por código) e recusar com motivo; ficha com turmas (trocar, matricular em outra, desmatricular), mensalidades e histórico de presença (30/90/180 dias, «Sem marcação» em aula dada sem marcação))_
- [x] Mensalidades: a receber, registrar pagamento, inadimplentes _(tarefa 2.12: `/painel/aulas/mensalidades` (`payment.record`) com «A receber» (em aberto, vencidas, pagas, dispensadas, por vencimento, total em aberto e CSV), «Inadimplentes» (total, dias de atraso, atalho para as mensalidades do aluno e CSV) e «Extrato» já filtrado em «Mensalidade de aula»; registrar pagamento reutiliza o `PaymentDialog` com `SUBSCRIPTION_CHARGE` e agora aceita a data do pagamento (`paidAt` só quando é dia passado); estornar pelos pagamentos da mensalidade; dispensar só com `charge.waive` (Dono/Admin) e sem pagamento registrado)_
- [x] Relatórios: ocupação das turmas, frequência, receita de mensalidades _(tarefa 2.12: `/painel/aulas/relatorios` (`classes.view`; novo item no menu) com ocupação das turmas (matriculados × capacidade e CSV), frequência por turma e período (de `class-groups/:id/frequency`, até 366 dias, CSV; o Professor vê só as turmas dele) e receita das mensalidades (recebido e estornado no período pelo extrato `service=CLASS`, a receber no período, vencido hoje, por forma de pagamento, CSV da API; só com `payment.record`). A API não tem relatório próprio de ocupação nem de receita: usam `class-groups` e o extrato)_

**Critério de saída:** os 3 espaços gerindo 100% das turmas e mensalidades de ao menos uma modalidade pela plataforma.

---

## Ajustes pós-piloto (2026-10-30)

Briefing: `docs/tarefas/ajustes-1.md`. Decisões 45 a 52 de `docs/07-perguntas-em-aberto.md`.

- [x] Busca por CEP no cadastro de endereços (A.1, A.7)
- [x] Máscaras em todos os inputs (A.7, A.8)
- [x] Erros e dicas de campo com boa UI/UX (A.2, A.7, A.8)
- [x] Ocultar torneios no mobile (A.8)
- [x] Rótulos humanos na caixa de implantação do Super (A.9)
- [x] Remover capacidade do cadastro de quadras (A.1, A.9)
- [x] UI/UX da configuração da lista de presença e do tempo (A.9)
- [x] Remover pausa de plano; cancelamento com acesso até o fim do mês pago (A.3, A.9, A.10)
- [x] Remover o papel Recepção (A.1, A.9, A.10)
- [x] E-mail do convite de equipe travado no onboarding (A.1, A.9)
- [x] Mais de um professor por aula e conflito entre espaços (A.5, A.9, A.10)
- [x] Mobile: detalhes em Aulas de Hoje e Reservas (A.10)
- [x] Web: scroll da Agenda não passa sobre o menu (A.9)
- [x] Datas em dd/mm/aaaa (A.7, A.8)
- [x] Web: seletores de data do shadcn (A.7)
- [x] Mobile: tirar "grátis" do cancelamento na tela do espaço (A.8)
- [x] UI/UX da tela de visualização do espaço (A.8)
- [x] Cor dos chips/badges (A.2)
- [x] Mobile: editar pessoas, horário e duração da reserva (A.4, A.10)
- [x] Web: sheet da reserva na Agenda com badges claros (A.9)
- [x] Remover recebimento por participante (A.1, A.9, A.10)
- [x] Mobile: notificações fixas no cabeçalho (A.8)
- [x] Base de contatos capturada nos convites, com vínculo ao cadastro (A.6, A.11, A.12)

## Conta e perfil (2026-11-03)

Briefing: `docs/tarefas/conta-1.md`. Decisões 64 a 72 de `docs/07-perguntas-em-aberto.md`.

- [ ] Cliente OAuth do Google e variáveis na API, no web e no EAS (C.0, sessão principal com o usuário) _(staging e dev: tela de consentimento e cliente Web criados em 2026-11-03; falta gravar as chaves no Parameter Store e ligar `AUTH_PROVIDERS`/EAS)_
- [ ] **Google Auth de production** ao subir o ambiente: cliente próprio, chaves, publicação da tela de consentimento (exige política de privacidade) e Apple no iOS — checklist em `docs/09-infra-aws.md`, seção 7
- [x] Fotos no S3 com CloudFront e foto de perfil na API (C.1, C.3) _(no `main` em 2026-11-03: `S3PhotoStorage` com o SDK v3, `/v1/me/avatar…`, chave publicada nova a cada registro, exclusão por prefixo `users/<id>/`; bucket e CloudFront pelo CDK com papel de mídia assumido pela instância. Falta o `cdk deploy` da stack do staging)_
- [x] Telefone obrigatório no cadastro, sem verificação; login por telefone desligado (C.2) _(no `main` em 2026-11-03; migração 0023 com unicidade só entre verificados)_
- [x] Perfil completo na API: nascimento, gênero, esportes com nível, completar cadastro, proteção do Google (C.2) _(`PATCH /v1/me/profile`, `profile.missing`; RN-AUTH-06: login Google em conta de e-mail não verificado revoga senha, sessões, aparelhos e dados de perfil numa transação e trata a conta como nova)_
- [x] Web: cadastro em duas etapas, completar cadastro e Meu perfil com foto (C.4) _(no `main` em 2026-11-03: `/cadastro/sobre-voce`, `/completar-cadastro`, `/painel/perfil` e `/super/perfil`, recorte acessível no navegador, telefone com selo no Super; specs reais do e2e ficam para a C.6)_
- [x] Mobile: cadastro em duas etapas, completar perfil e editar perfil com foto (C.5) _(no `main` em 2026-11-03: foto com `expo-image-picker`/`expo-image-manipulator` (JPEG 512 px), Alterar senha, limpeza local da foto e do cache ao sair; login por telefone removido; exige APK novo)_
- [x] Testes de cadastro, perfil, fotos e Google (C.6) _(2026-11-03: API 1107 testes, mobile 508, web E2E real `conta-perfil.spec.ts` (9) e pós-piloto (20), sem bugs encontrados. Lacunas: upload real de foto sem storage no ambiente de teste (cobrir com o MinIO), Maestro não executado, Google só nos testes de integração da API)_
- [x] Deploy no staging (bucket pelo CDK), APK novo e conferência no emulador _(bucket e CloudFront pelo `cdk deploy` de 2026-11-03; o código de conta e perfil foi junto nos deploys seguintes (anúncios, pagamentos e avaliações) e nos APKs `56ea3be` e `ab8b133e`)_

## Anúncios e novo Explorar (2026-11-03)

Briefing: `docs/tarefas/anuncios-1.md`. Decisões 73 a 79 de `docs/07-perguntas-em-aberto.md`; especificação em `docs/12-anuncios.md`.

- [x] Especificação visual do carrossel, do card patrocinado, dos recentes e dos atalhos, claro e escuro (AD.1) _(no `main` em 2026-11-03: seção "Explorar e anúncios" do docs/05, tokens `sponsored`/`media-*`, `exploreLayout` e `sportIcons`; atalhos ficam visíveis com filtro e o raio não conta como filtro)_
- [x] API: anunciantes, campanhas, peças, entrega, eventos e relatório; espaços recentes; seed com anúncios de teste (AD.2) _(no `main` em 2026-11-03; coberta pelos testes da AD.5 e no staging com o seed dos 9 anúncios)_
- [x] Infra: CloudFront servindo `ads/*` do bucket de mídia (AD.2) _(`cdk deploy` e `ADS_DELIVERY_SECRET` no staging em 2026-11-03; CloudFront `d26ys0hec58i3c.cloudfront.net`: `ads/` 200, `uploads/` 403)_
- [x] Web `/super`: anunciantes, campanhas, peças com pré-visualização e relatório (AD.3) _(no `main` em 2026-11-03; sem gráfico no relatório; seletores de anunciante limitados a 100)_
- [x] Mobile: Explorar com atalhos, carrossel, espaços recentes e card patrocinado; impressões e cliques (AD.4) _(no `main` em 2026-11-03; anúncios buscados de novo a cada abertura do Explorar; não testado em aparelho)_
- [x] Testes de anúncios e do Explorar (AD.5) _(no `main` em 2026-11-03: permissões das 18 rotas, entrega, eventos, relatório, recentes, e2e real do `/super` e seed e2e com anúncios; o bug do token de peça inexistente (500) foi corrigido na sessão principal. Lacunas: upload real de imagem no e2e e Maestro não executado)_
- [x] Deploy no staging, APK novo e conferência no emulador _(2026-11-03: seed com os 9 anúncios; no emulador (Expo Go apontando para o staging) conferidos carrossel, selo, troca automática, recentes, atalhos e filtro, destino URL e contagem de impressões e clique. Achados: card patrocinado não aparece com menos de 3 espaços na lista; Astral sem coordenadas no staging some com a localização ligada)_

## Pagamento online, carteira e taxa (2026-11-04)
Decisões 80 a 98; especificação em `13-pagamentos-online.md`; RF-ONPAY/RN-ONPAY; briefing `tarefas/pagamentos-1.md` (plano `forte`). Gateway fake por enquanto.
- [x] PG.1 Design: checkout no app (Pix, cartão), carteira e configurações no painel, taxas e simulador no Super _(docs/05, seção "Pagamento online"; mockups em docs/pagamentos/; tokens sandbox, amount-positive, qr-plate/qr-module e paymentLayout; revisada, com as decisões 93 a 96)_
- [x] PG.2 API: gateway desacoplado (fake), cadastro do espaço, taxas, cobranças de reservas e mensalidades, webhooks, estornos, chargeback, livro-razão e repasses, Super e simulador _(migração 0025; rotas na seção 13 de docs/13; revisada e corrigida, decisões 93 a 97; antes do deploy no staging: criar `/space-sports/staging/api/PAYMENTS_DATA_KEY` no Parameter Store)_
- [x] PG.3 Web: cadastro no gateway, modos de pagamento, carteira, estorno, Super (taxas, receita, cadastros, simulador) _(`/painel/recebimentos-online` e `/super/pagamentos`; revisada; PG.2b ajustou o contrato e a PG.3c usa os campos novos)_
- [x] PG.4 Mobile: escolha da forma de pagamento, Pix e cartão, reserva aguardando pagamento, pagar mensalidade, Meus pagamentos
- [x] PG.5 QA: integração, E2E web e fluxos Maestro _(70 testes novos: 63 de integração da API (invariantes do livro-razão, matriz de permissões, casos de borda) e 7 E2E reais do web; fluxos Maestro do pagamento escritos, não executados (sem emulador); 1 bug baixo corrigido: webhook ilegível → 400 `INVALID_WEBHOOK_PAYLOAD`)_
- [x] Deploy no staging _(2026-11-04: `PAYMENTS_DATA_KEY` no Parameter Store da conta do staging, migrações 0025–0028, `PAYMENTS_PROVIDER=fake`; CI e deploy verdes no `1e72e52`; APK preview do EAS (`56ea3be`) aberto no emulador Pixel_9 sem crash, com "Meus pagamentos" no Perfil. Fluxos Maestro de pagamento ainda não executados)_
- [ ] Escolher o gateway real e escrever o adaptador (decisão 80)

---

## Avaliações de espaços (2026-11-04)
Decisões 99 a 106; RF-REVIEW/RN-REVIEW (seção 12 de `02-requisitos-funcionais.md`); briefing `tarefas/avaliacoes-1.md` (plano `forte`). Item 4 do backlog da Fase 4, antecipado.
- [x] AV.1 Design: tela de avaliar, resumo e lista, selo no card, painel e moderação, claro e escuro _(no `main` em 2026-11-04: seção "Avaliações" do docs/05, mockups em docs/avaliacoes/, tokens de estrela em `packages/ui-tokens` com teste de contraste; catálogo de 8 pares de chips; revisada: notificações sem texto do usuário, estado só leitura, modo só-criar no toque do card)_
- [x] AV.2 API: avaliações, elegibilidade, média, pedidos por push, respostas, denúncias e moderação, LGPD _(no `main` em 2026-11-04: migração 0029, 18 rotas, `rating` nos cards, `canEdit` e `?createOnly=true`, job de pedidos com `REVIEW_REQUEST_DELAY_MIN`; revisada: corrida bloqueio × criação, avisos `REVIEW_CREATED`/`REVIEW_REPLIED` só na primeira vez; avaliações fictícias só no seed do e2e, nenhuma no staging)_
- [x] AV.3 Web: página pública com resumo e JSON-LD, `/painel/avaliacoes`, moderação no `/super` _(no `main` em 2026-11-04: 371 testes do web e 13 do Playwright de avaliações; revisada, com "Carregar mais" e a página de cursor vazia corrigidos. Pendências para a AV.6: chips "Elogios"/"Críticas" (a API devolve só 3 no total), média de 90 dias a partir de médias arredondadas, cache diferente entre cabeçalho e bloco (até 5 min), resumo próprio e nota no detalhe do espaço no Super, motivo ao descartar denúncia)_
- [x] AV.4 Mobile: avaliar, pedidos (push, reserva/aula passada, página do espaço), resumo e lista, nota no card e no mapa, Minhas avaliações _(no `main` em 2026-11-04: 819 testes do app passando; revisada sem bloqueios. Pendências: seed do e2e sem reserva passada para o Maestro (AV.5), visual não conferido em tela (depois do deploy), menu → Alert/sheet no iOS, rolagem até o item em Minhas avaliações, selo dos cards só atualiza com o cache, "bairro · cidade" ausente em Minhas avaliações (contrato))_
- [x] AV.5 QA: integração, E2E web e fluxos Maestro _(no `main` em 2026-11-04: 7 arquivos de integração (permissões, bordas, invariantes da média com sequências aleatórias, privacidade, job com relógio, notificações, nota no anúncio), E2E real do web e reserva passada no seed do e2e; revisada. Bug BUG-AV5-2 (baixo) aberto, teste em `it.fails`. Maestro não executado)_
- [x] AV.6 Acabamento _(no `main` em 2026-11-05, AV.6a/6b/6c revisadas: BUG-AV5-2 corrigido (`review_prompts.answered_at`, migração 0030); destaques por grupo e agregado de 90 dias no painel; resumo próprio e nota no Super; motivo ao descartar denúncia; "bairro · cidade" em Minhas avaliações; cabeçalho da página pública alinhado ao bloco; menus do app que agem depois de fechar (iOS); Maestro sem ambiguidade. Ficaram de fora: "faltam N" no Super para espaço fora da vitrine, mock do e2e sem esse caso, "(0)" no link do Super, "Ver todas as 1 avaliação", selo nos Espaços recentes (não existe) e o mesmo bug de folha do iOS em "Foto do perfil")_
- [x] Deploy no staging e conferência no emulador _(2026-11-05: AV.1–AV.6 no staging (`cb82291`, migrações 0029 e 0030), CI e deploy verdes; rotas de avaliações conferidas; no emulador Pixel_9 (Expo Go contra o staging), claro e escuro: selo "Novo" no card, bloco "Avaliações" na página do espaço, Minhas avaliações vazia e a tela de avaliar para quem não pode avaliar. Fluxo de avaliar de ponta a ponta não testado no staging (nenhuma reserva passada lá; coberto pelos testes de integração, E2E real e Maestro). APK EAS `ab8b133e` gerado do `a3fbfe0`, sem a AV.6c)_

## Avaliações 2 (2026-11-05)
Decisões 106 e 109; briefing `tarefas/avaliacoes-2.md` (plano `forte`).
- [ ] AV2.1 API: filtro `minRating` e ordenação `sort=rating` em `GET /v1/spaces`
- [ ] AV2.2 Web: ajustes do Super ("faltam N" fora da vitrine, "(0)" no link) e o caso no mock do e2e
- [ ] AV2.3 Mobile: "4+ estrelas" e "Melhor avaliados" nos filtros do Explorar; "Ver todas as N avaliações"; folha "Foto do perfil" no iOS
- [ ] AV2.4 QA: integração do filtro e da ordenação e fluxo Maestro
- [ ] Fluxos Maestro das avaliações executados contra a API local com o seed de teste
- [ ] Deploy no staging, APK novo do `main` e conferência no emulador

---

## Fase 3 — Torneios

### Backend
- [ ] Torneios, categorias (gênero/nível/limite/valor), formatos e regras de partida
- [ ] Inscrição em dupla: convite ao parceiro, aceite, validação de categoria, lista de espera, confirmação após pagamento no local
- [ ] Geração de chave com brackets-manager (eliminatória simples/dupla, todos contra todos, grupos + mata-mata), seed auditável
- [ ] Agendamento de partidas nas quadras (ocupação da agenda) com detecção de conflitos
- [ ] Placar e avanço automático; classificação de grupos com desempate
- [ ] Atualização em tempo real (SSE/WebSocket) da chave

### App
- [ ] Aba Torneios (geral e por espaço), detalhe, regulamento
- [ ] Inscrição em dupla (convidar parceiro), minhas inscrições
- [ ] Chave/grupos ao vivo, meus próximos jogos
- [ ] Visão de equipe: consultar jogos e placares (lançar placar fica no painel web)

### Painel do espaço
- [ ] Assistente de criação de torneio e categorias
- [ ] Inscrições: confirmar pagamento, cabeças de chave, espera
- [ ] Sorteio + editor da chave + publicação
- [ ] Grade de jogos por quadra; lançamento de placares
- [ ] Página pública do torneio com a chave

**Critério de saída:** 1 torneio real executado de ponta a ponta em um espaço parceiro.

---

## Fase 4 — Crescimento (backlog priorizado)
1. Preço diferenciado por quadra/horário nobre
2. Controle de no-show (bloqueio após N faltas)
3. Aula experimental / reposição
4. ~~Avaliações de espaços~~ antecipado para a seção "Avaliações de espaços" (decisões 99 a 106)
5. Lembretes por WhatsApp
6. Check-in por QR Code
7. ~~Pagamento online integrado~~ antecipado para a seção "Pagamento online, carteira e taxa" (decisões 80 a 92); falta o gateway real
8. Feed de novidades dos espaços / seguir espaços
9. Ranking de atletas e "procura-se jogador"
10. Integração Wellhub/Gympass e TotalPass
11. Expansão: novos esportes e cidades
12. Cobrança do SaaS na plataforma: planos, contratos, implantação + mensalidade via gateway (Asaas), NFS-e, régua de cobrança, módulos por plano

13. **IA e agentes** (proposta, `11-ia-agentes.md`): fases IA-0 a IA-4, começando pelos relatórios conversacionais no painel. Aguarda as perguntas 57 a 63.

---

## Rituais sugeridos
- Sprints de 2 semanas; demo para os espaços parceiros ao fim de cada sprint.
- Cada tarefa vira uma issue referenciando os IDs de `02-requisitos-funcionais.md`.
- Definição de pronto: testes passando, revisado, em staging, eventos do PostHog instrumentados.

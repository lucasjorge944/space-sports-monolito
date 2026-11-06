# Fase 2 — Briefings para o Orca (Aulas e Planos)

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`.

**Plano padrão:** `equilibrado`

**Estado do `main`:** Fase 1 concluída na API, no web e no mobile (reservas, mensalista só como horário fixo sem cobrança, equipe, Super, notificações, inativação de conta). O schema de Aulas ainda **não existe** no código (só em `docs/04-modelo-de-dados.md`, seção Aulas). Regras: `docs/02-requisitos-funcionais.md` seção 4 (RF-CLASS-01..11, RN-CLASS-01..08) e configurações de presença na seção 2.1.

**Decisões de produto (docs/07):** 24 sem reposição (falta é falta; só confirma nas sessões das próprias turmas); 25 mensalidade vence em **dia fixo do mês definido pelo espaço**, sem pró-rata; 26 o professor pode atuar em **vários espaços** (vínculo `TEACHER` por espaço, `space_members`); 6 lista de presença configurável (automática/manual) com lista de espera; 12 plano ilimitado = quantas vezes quiser nas turmas matriculadas; 21 gestão só no web, no app a equipe só visualiza. Pagamento sempre direto no espaço: a plataforma só registra (`payments`, sem gateway). Dinheiro em centavos; datas em UTC, exibidas em `America/Sao_Paulo`.

**Regras transversais:** guard de espaço respeita `spaces.status` (suspenso = só leitura); permissões pela matriz do doc 02 (Professor só vê/opera as próprias turmas e sessões); contrato OpenAPI muda só pelo `api-engineer` e o cliente é regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo PR; testes de integração cobrem as RN citadas; ocupação da quadra pela constraint de exclusão do banco (`court_occupations`, kind `CLASS`), nunca só na aplicação; migrações paralelas colidem, por isso cada tarefa de API recebe o número da migração no briefing; após merges rodar `pnpm --filter @space-sports/shared build` e `pnpm --filter @space-sports/api build`.

## Estado em 2026-10-28 (retomar daqui)

**Fase 2 — tudo integrado no `main` (`1628e51`, sem remoto/push):** API (2.1 a 2.5, 2.7, 2.15), web (2.8, 2.10, 2.11, 2.12, 2.16) e mobile (2.6, 2.9, 2.13, 2.14). Todas as tarefas desta fase terminaram e foram mergeadas; não há tarefa rodando nem worktree pendente de merge (os worktrees do Orca em `~/orca/workspaces/space-sports/` podem ser removidos).

**Revisão:** o `code-reviewer` revisou a 2.1, a 2.2 e a 2.3 por tarefa, e o web (2.8 a 2.12) e o mobile/API (2.5, 2.7, 2.13) em bloco; os bloqueios foram corrigidos nas tarefas 2.4, 2.5, 2.7, 2.14, 2.15 e 2.16. As correções 2.4 a 2.7 e 2.14 a 2.16 **não tiveram nova revisão**.

**Últimas verificações (nos worktrees, depois de trazer o `main`):** API 685 testes de integração e 78 unitários; web 165 unitários e 129 e2e com API simulada; mobile 254 testes; lint e typecheck passando; e2e real da agenda de aluguel (9) passou antes das correções da Fase 2. **Não rodado no `main` final:** suíte completa da API, e2e do web, e2e real e Maestro.

**Verificação final no `main` (2026-10-29, `2c77222`): tudo passou.** Build de `shared` e da API; `pnpm lint` e `pnpm typecheck`; `generate:api-client:check`; API com 685 testes de integração e 81 unitários; unitários de web (165), mobile (254), shared (79), ui-tokens (205) e api-client (23); e2e do web com API simulada (129); e2e real da agenda de aluguel (9), com as migrações aplicadas no `space_sports_e2e`. Maestro não rodou porque precisa de emulador.

**Para amanhã, nesta ordem:**
1. ~~**Verificação final no `main`:**~~ _(feita em 2026-10-29, ver acima)_ `pnpm --filter @space-sports/shared build`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @space-sports/api test:integration`, `pnpm --filter @space-sports/web test:e2e` e o e2e real (`docker compose up -d postgres redis`; banco `space_sports_e2e`; `pnpm --filter @space-sports/api build`; `DATABASE_URL=postgres://space_sports:space_sports@localhost:5432/space_sports_e2e pnpm --filter @space-sports/api db:migrate`; `pnpm --filter @space-sports/web test:e2e:real`). Os contêineres de Postgres e Redis ficaram no ar na máquina.
2. ~~**E2E real de Aulas**~~ _(feita na tarefa 2.17, branch `test-web-aulas-real-e2e`, mergeada no `main` em `f7e20ae`)_ `apps/web/e2e/real/aulas.spec.ts`: 10 testes em sequência contra a API real, com `agenda.spec.ts` (9) verde; `pnpm lint` e typecheck do web passam. O seed (`apps/api/test/e2e-seed/seed.ts`) ganhou jogador2/3, um segundo professor, modo de presença `MANUAL`, o jogador 3 como aluno ativo (candidato a reposição) e a "Aula em andamento" (sessão que começou há 10 min, inserida pelo seed porque o servidor não gera sessão de hoje que já passou do horário). Achados, sem bug de produção: (a) quem não está matriculado recebe 404 `CLASS_SESSION_NOT_FOUND` ao confirmar (não 403 `NOT_ENROLLED_IN_CLASS`, que só ocorre com linha de presença sem matrícula); (b) `GET …/teachers` não filtra por professor: o Professor vê todos os professores do espaço, com a contagem de turmas (o filtro vale para turmas e sessões); (c) o painel só oferece como "outro aluno" para reposição quem tem assinatura ativa/pausada/inadimplente. Não coberto: prazo de desistência vencido (exige controlar o relógio do servidor), modo automático da lista, RN-CLASS-06/07. Maestro de aulas e o fluxo de reserva (nunca executados) dependem de emulador.
   - **Ajustes da revisão (tarefa 2.18, branch `test-web-aulas-real-e2e-review`, mergeada no `main`; revisada pelo `code-reviewer` sem bloqueios):** RN-CLASS-01 agora pede o plano 1x com duas turmas do mesmo esporte e confere 422 `CLASS_GROUP_COUNT_MISMATCH` (`expected: 1, received: 2`); o caso de lista vazia ficou, comentado como validação do Zod (400). A aula em andamento é buscada de ontem até hoje (sem instabilidade na meia-noite). O teste do Professor trava a decisão 34: `GET …/teachers` traz "Professor E2E" (2 turmas) e "Professor Dois E2E" (1). A primeira confirmação do aluno passou para o teste do modo manual (só depois de abrir a lista); o teste da espera parte dela. No seed, o jogador 3 tem o ciclo no mês do calendário (pergunta 12 de docs/07) e o comentário da turma "Futevôlei iniciante" diz que ela fica sem sessões sem o job. Verificado: build de `shared`, `api-client` e API; `db:migrate` no `space_sports_e2e`; `test:e2e:real` com 19 testes passando (agenda 9 + aulas 10); `pnpm lint` na raiz; typecheck do web e da API. Testes de integração da API não rodados.
3. **Revisão das correções** (2.14 a 2.16) se quiser fechar a Fase 2 com o `code-reviewer`.
4. **Decisões do produto** (2026-10-29): as perguntas 11, 12, 13, 8 e 4 a 7 viraram as decisões 35 a 39, a 10 virou a 40 (exclusão por pedido validado pela equipe) e a 33 foi substituída pela 41 (pausa por mês inteiro). Implementação na Onda 5 (2.19 a 2.22). Segue aberta só a pergunta 9 (domínio).

**Onda 5 (2026-10-29) — tudo no `main`:** decisões 37 (choque de horário entre aulas do aluno), 40 (exclusão de conta por pedido validado pelo Super) e 41 (pausa por mês inteiro) nas tarefas 2.19 a 2.26 (API 2.19, 2.20, 2.23, 2.26; web 2.21, 2.25; mobile 2.22, 2.24), todas revisadas sem bloqueio (a 2.25 revisada pela sessão principal). Migrações 0015 (pausa mensal), 0016 (pedido de exclusão) e 0017 (remove `CUSTOMER_ACCOUNT_DELETED`). **Verificação final no `main`:** lint, typecheck (10 pacotes), `generate:api-client:check`, `drizzle-kit check`, integração da API 718, unitários (API 81, web 192, mobile 289, shared 82, ui-tokens 205, api-client 23), e2e do web 149, e2e real 19 (agenda 9 + aulas 10). Maestro não executado. Worktrees removidos.

**Pendências da Onda 5 (baixo risco):** descrição de `deactivateMe` no OpenAPI ainda diz "Nada é apagado" (os dispositivos agora são apagados); comentários longos em `me/account.service.ts` e `test/auth/deactivate-account.int.test.ts`; teste do cancelamento com pausa em curso não roda o `processBilling` até o fim do ciclo; mobile: `maxPauseMonths` supõe saldo cheio no ano seguinte (vale enquanto só há uma pausa por vez) e "Retomar" só aparece com status `PAUSED` (conferir se a pausa em curso com `PAST_DUE` existe na prática); a página pública de exclusão só serve a quem tem senha; limite por e-mail do endpoint público pode ser usado para bloquear a página de um terceiro por 1 h; duas cópias de `@better-auth/core` no lockfile; canal de atendimento (pergunta 42).

**Onda 6 (2026-10-29) — tudo no `main`:** kit de marca v1.1 (`docs/brand/kit/`, claro e escuro) e logo do espaço (decisões 43 e 44, RF-SPACE-11) nas tarefas 2.27 a 2.33 (design 2.27; API 2.30, 2.31; web 2.28, 2.33; mobile 2.29, 2.32), todas revisadas; os bloqueios das revisões foram corrigidos no merge ou devolvidos ao agente (2.31). Migração 0018 (logo do espaço). Parceiros no seed: Astral Beach Sports, Arena Errejota e Duna Sports (no lugar da Arena 7), com as quadras; `pnpm db:seed:demo` com Dono e professores. **Verificação final no `main`:** lint, typecheck (10 pacotes), `generate:api-client:check`, unitários (web 204, mobile 317, ui-tokens 370, shared 82, api-client 23) e e2e do web com API simulada 161/161 (numa de duas execuções seguidas, 1 falha intermitente no cadastro de `auth.spec.ts`). Maestro e e2e real não executados nesta onda; a 2.29 caiu uma vez por falta de memória (emulador + Gradle + e2e ao mesmo tempo) e foi retomada sem as capturas.

**Pendências da Onda 6 (baixo risco):** conferência visual do app no aparelho (claro e escuro, splash escura, anel de foco) e Maestro; `metadataBase` global do Open Graph depende do domínio (pergunta 9); tokens que faltam em `packages/ui-tokens` (`scrim`, hoje provisório em `apps/web/src/app/globals.css`, e chip/chip-selecionado); `logoUrl` na sessão de suporte do Super (hoje o seletor mostra as iniciais); e2e: o escopo do mock vai por cookie fixo em `localhost:3100` (`e2e/fixtures.ts`), e chamadas do navegador direto ao mock podem cair no escopo padrão; aviso "worker process has failed to exit gracefully" no Jest do mobile; corrida estreita de dois registros simultâneos da mesma key de upload (só o próprio gestor); regra de expiração do R2 em `uploads/` (manual); logos dos parceiros só em 150×150; cidade da Duna Sports e professores fictícios de Errejota e Duna a confirmar.

**Pendências conhecidas (baixo risco):**
- API: aprovação de mensalista não confere o horário das turmas além da janela de 4 semanas; tirar o esporte de uma quadra com turma ativa não é recusado; adicionar aluno à aula só alcança quem tem vínculo (falta busca de usuários); notificações dentro da requisição (mover para fila quando o volume crescer); job de cobrança parado por mais de um mês não recupera meses; `POST /v1/recurring-bookings` sem a trava contra exclusão em andamento (hoje o app só inativa a conta, decisão 29).
- Web: relatórios de ocupação e receita sem endpoint próprio (usa turmas e extrato com `service=CLASS`); busca de assinaturas e mensalidades só por `userId`; consultas grandes demais (100 e 2.000 assinaturas) e chave de cache fora do `invalidateSpace`; frequência por turma duplicada entre `sessoes/presencas-view.tsx` e `relatorios/frequencia-report.tsx`; mocks do e2e menos fiéis que a API.
- Mobile: seção "Entregue (2.13)" não escrita; Maestro não executado.
- Pendentes de fases anteriores: CI com E2E real nunca visto num runner; pergunta 10 (exclusão); contas das lojas, domínio, Sentry/PostHog, staging.

**Lições de operação desta fase:**
- O `--watch` do dispatch pode ser encerrado pelo sistema quando a memória aperta (3 agentes mais testes de integração estouram os ~15 GB); a notificação de fim não chega e é preciso ler o terminal (`orca-ide terminal read --terminal <handle>`). Rodar no máximo 3 agentes em paralelo e evitar testes pesados junto.
- Merge de tarefas paralelas conflita em `docs/06-roadmap.md`, em `NOTIFICATION_TYPES`/`domain-events.ts`/`notification-events.ts`, no `api-client` gerado (regenerar, não mesclar) e nos mocks do e2e do web (`mock-api.mjs`; rotas de aulas separadas pelo cookie `e2e-classes`). O commitlint recusa a mensagem automática do merge: usar `chore: merge ...`.
- Sempre rodar `pnpm --filter @space-sports/shared build` e `pnpm --filter @space-sports/api build` após merges (o `dist` desatualizado quebrou o e2e real uma vez).
- Teste de auditoria do Super dependia da hora do dia (data UTC contra a de São Paulo); corrigido.
- Worktrees novos precisam de `pnpm install --frozen-lockfile` e do build de `shared`, `ui-tokens` e `api-client`.

## Onda 1 — API (2.1 primeiro; 2.2 e 2.3 em paralelo depois do merge da 2.1)

### 2.1 · API: professores, turmas, sessões e planos
- **Agente:** `api-engineer`
- **Branch:** `feat/api-classes-core`
- **Plano:** `equilibrado`
- **Roadmap:** Fase 2 Backend — Professores, Turmas fixas, Planos

**Prompt**
```
Implemente em apps/api a base do módulo de Aulas (RF-CLASS-01..03; RN-CLASS-01/02/04 no que couber; decisões 24 a 26 de docs/07).

(1) Schema Drizzle e migração 0012 com TODAS as tabelas da seção Aulas de docs/04-modelo-de-dados.md (class_groups, class_sessions, attendances, plans, subscriptions, enrollments, subscription_charges), com índices, checks e FKs; as tabelas de assinatura/presença só são criadas aqui, a lógica delas vem nas tarefas 2.2 e 2.3. Acrescente a space_settings o que faltar para as aulas (past_due_block_days com opção de desligar a regra, max_pause_days_per_year, defaults do doc 02), com Zod em packages/shared e seed. attendances tem unique (session_id, user_id).
(2) Professores: convidar e gerir vínculo TEACHER em space_members reaproveitando o fluxo de equipe existente (um usuário pode ser professor em vários espaços); listar professores do espaço.
(3) Turmas fixas: CRUD em /v1/manage/spaces/:spaceId/class-groups (esporte, nível, professor, quadra, dia da semana, horário no fuso do espaço, duração múltipla de 30 min, capacidade, ativa). Criar/editar valida conflito de agenda com reservas, bloqueios, mensalistas e outras turmas; desativar/excluir turma com matrículas ativas é recusado com erro claro.
(4) Sessões: job BullMQ (padrão dos jobs de recurring, fila própria, idempotente, retry sem duplicar, ligado por JOBS_ENABLED) gera as sessões de cada turma ativa com 4 semanas de antecedência, cria a ocupação CLASS em court_occupations e sinaliza (sem quebrar o job) o que conflitar com bloqueio/torneio/reserva. Editar a turma regenera só sessões futuras sem confirmações. Sessão herda professor e capacidade da turma; a capacidade da sessão pode ser ajustada pela gestão.
(5) Planos: CRUD em /v1/manage/spaces/:spaceId/plans (nome, esporte, weekly_frequency 1/2/3.. ou null = ilimitado, price_cents, billing_day 1 a 28 = dia fixo do mês definido pelo espaço, sem pró-rata, regras de pausa, ativo). Leitura pública de planos e turmas com vagas (matrículas ativas x capacidade) em /v1/spaces/:slug/classes (só espaços ACTIVE).
(6) Permissões: pela matriz do doc 02 (Gerir planos e turmas: Dono/Admin; Professor lê as próprias turmas e sessões; Recepção lê).
Fora do escopo: assinaturas, matrículas, mensalidades, presença e lista de espera (2.2 e 2.3). Testes de integração por papel, conflito de agenda, geração idempotente de sessões e vagas. Regenere o api-client, rode pnpm --filter @space-sports/shared build, lint, typecheck, generate:check e os testes de integração; reconstrua apps/api. Marque o progresso em docs/06-roadmap.md e registre em docs/tarefas/fase-2.md, na seção desta tarefa, o contrato que 2.2, 2.3, web e mobile vão consumir.
```

**Contrato entregue (2.1)** — o que 2.2, 2.3, web e mobile consomem. Tipos em `@space-sports/shared` (`classes.ts`) e no cliente gerado (`packages/api-client`, tag `classes`).

*Schema (migração `0012_classes`, código em `apps/api/src/db/schema/classes.ts`)*
- Todas as tabelas de Aulas de `docs/04` (seção Aulas, já atualizada): `class_groups`, `class_sessions`, `class_session_conflicts` (nova, avisos do job), `attendances` (`UNIQUE(session_id, user_id)`; `waitlist_position` obrigatório só em `WAITLIST`), `plans`, `subscriptions`, `enrollments`, `subscription_charges`. Enums `class_session_status`, `attendance_status`, `subscription_status`, `enrollment_status`.
- FKs compostas com `space_id`: turma/sessão → quadra e professor (`space_members(id, space_id)`) do mesmo espaço; sessão → turma; assinatura → plano (`plans(id, space_id)`).
- Para a 2.2: `subscriptions` tem unique parcial (user_id, plan_id) em `PENDING_APPROVAL|ACTIVE|PAUSED|PAST_DUE`; datas do ciclo nulas até a aprovação; `enrollments` tem unique parcial (subscription_id, class_group_id) em `ACTIVE` e índice (class_group_id, status) para contar vagas; `subscription_charges` tem `UNIQUE(subscription_id, period_start)` para o job idempotente. A trava de capacidade na aprovação/troca de turma (RN-CLASS-02) é da 2.2: travar a linha de `class_groups` (`FOR UPDATE`) e contar `enrollments` ACTIVE.
- Para a 2.3: `class_sessions` já tem `opened_at/by`, `closed_at/by`, `cancelled_at/by`, `cancel_reason` e o índice parcial `class_sessions_pending_idx` (status `SCHEDULED|OPEN|CLOSED`) por `starts_at` para o job de 1 minuto. Cancelar sessão = `status CANCELLED` + `court_occupations.active = false` (kind `CLASS`, ref_id = sessão); a sessão cancelada nunca é recriada pelo job. Ao aumentar a capacidade da sessão (`PATCH …/class-sessions/:id`) a 2.3 deve promover a espera.
- `space_settings`: `past_due_block_enabled` + `past_due_block_days` (RN-CLASS-06) e `max_pause_days_per_year` (RN-CLASS-07; 0 = sem pausa). Padrões provisórios em `SPACE_SETTINGS_DEFAULTS`: ligado, 7 dias, 30 dias (pergunta 11 de docs/07). `GET/PATCH …/settings` agora devolve os três sempre preenchidos (antes `pastDueBlockDays`/`maxPauseDaysPerYear` eram nulos). Limite efetivo de pausa de um plano: `plan.pauseAllowed ? (plan.maxPauseDaysPerYear ?? settings.maxPauseDaysPerYear) : 0`.

*Permissões*: nova `classes.view` (Dono, Admin, Professor, Recepção) para leitura; `classes.manage` (Dono, Admin) para escrita. Quem é **só** Professor vê apenas as turmas/sessões em que é `teacher_member_id` (outras → 404); Admin/Recepção/Dono veem tudo. Escopo resolvido por `classesScope()` em `apps/api/src/classes/classes-scope.ts` (reutilizar na 2.3).

*Rotas (gestão em `/v1/manage/spaces/:spaceId`)*
| Método e rota | Permissão | Notas |
|---|---|---|
| `GET /teachers` | `classes.view` | `{ items: [{ memberId, userId, name, avatarUrl, activeClassGroupCount }] }`. `memberId` = `teacherMemberId`. Convite: `POST /team/invites` com `role: TEACHER`; remover/tirar o papel de quem dá turma ativa → 409 `TEACHER_HAS_CLASS_GROUPS` |
| `GET /class-groups?active&sportId&courtId&teacherMemberId` | `classes.view` | `{ items: ClassGroup[] }` com `enrolledCount` e `availableSpots` |
| `POST /class-groups` | `classes.manage` | `CreateClassGroupInput` (`name, sportId, level?, teacherMemberId, courtId, weekday, startTime HH:MM, durationMin múltiplo de 30 (30–360), capacity 1–100, active?`). 201 `ClassGroupDetail`; gera as sessões |
| `GET /class-groups/:id` | `classes.view` | `ClassGroupDetail` = `ClassGroup` + `conflicts[]` |
| `PATCH /class-groups/:id` | `classes.manage` | parcial; mudar quadra/dia/horário/duração/`active` regenera só as sessões futuras sem confirmações (`CONFIRMED/WAITLIST/PRESENT/ABSENT`) em modo estrito; reativar revalida professor (vínculo TEACHER ativo), quadra (ativa e com o esporte) e agenda. Professor e capacidade vão direto (UPDATE) para as sessões futuras sem confirmações, sem regenerar nem revalidar a agenda; a capacidade só muda nas sessões que ainda têm a capacidade antiga da turma (ajuste manual por sessão é mantido). Trocar o esporte com matrículas ativas → 409 `SPORT_CHANGE_NOT_ALLOWED` |
| `DELETE /class-groups/:id` | `classes.manage` | 204; só sem histórico |
| `GET /class-session-conflicts` | `classes.view` | `{ items: ClassSessionConflict[] }` em aberto |
| `GET /class-sessions?from&to&classGroupId&teacherMemberId&status` | `classes.view` | datas locais, padrão hoje + 27 dias, máx. 62; `{ from, to, timeZone, items: ClassSession[] }` com `confirmedCount`/`waitlistCount` |
| `GET /class-sessions/:id` | `classes.view` | `ClassSession` (a 2.3 estende com a lista) |
| `PATCH /class-sessions/:id` | `classes.manage` | `{ capacity }` só desta aula |
| `GET /plans?active&sportId` · `GET /plans/:id` | `classes.view` | `Plan` (`weeklyFrequency` null = ilimitado, `billingDay` 1–28, `pauseAllowed`, `maxPauseDaysPerYear?`) |
| `POST /plans` · `PATCH /plans/:id` · `DELETE /plans/:id` | `classes.manage` | preço novo só vale para novas assinaturas (snapshot); trocar o esporte com assinaturas `PENDING_APPROVAL/ACTIVE/PAUSED/PAST_DUE` → 409 `SPORT_CHANGE_NOT_ALLOWED` |

Pública: `GET /v1/spaces/:slug/classes` (sem login; só espaço `ACTIVE`, senão 404 `SPACE_NOT_FOUND`) → `PublicSpaceClasses { space{ id, name, slug, timeZone }, plans: PublicPlan[] (ativos; maxPauseDaysPerYear efetivo), classGroups: PublicClassGroup[] (ativas; teacher só `name`/`avatarUrl`; enrolledCount/availableSpots) }`.

*Quadras* (`/courts`, ajustes da 2.4): `PATCH /courts/:id` com `status: INACTIVE` e turmas ativas na quadra → 409 `COURT_HAS_CLASS_GROUPS` (`MAINTENANCE` segue permitido); `DELETE /courts/:id` com qualquer turma na quadra (ou com sessões nela) → 409 `COURT_HAS_CLASS_GROUPS`. Nos dois casos a mensagem cita os nomes e `details.classGroups = [{ id, name }]`.

*Regeneração e o mesmo dia*: a geração cria **uma sessão por turma e data local**. Ao trocar o horário (ou a duração/quadra) da turma, a sessão futura que já tem confirmação fica no horário antigo e **segura o dia**: naquela data não é gerada uma sessão no horário novo (o aluno confirmado não perde a aula; a gestão cancela a antiga, tarefa 2.3, se quiser a aula no horário novo). Professor e capacidade da sessão com confirmação também não mudam com a turma (troca de professor de uma sessão é da 2.3).

*Erros*: 409 `CLASS_SCHEDULE_CONFLICT` (`details.conflictsWith`: `CLASS_GROUP`/`RECURRING_BOOKING` com `refId`, ou `BOOKING`/`BLOCK`/`CLASS`/`TOURNAMENT` com `startsAt`), `CAPACITY_BELOW_ENROLLMENTS`, `CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS`, `CLASS_GROUP_HAS_HISTORY`, `CAPACITY_BELOW_CONFIRMED`, `CLASS_SESSION_NOT_EDITABLE`, `PLAN_HAS_SUBSCRIPTIONS`, `TEACHER_HAS_CLASS_GROUPS`, `SPORT_CHANGE_NOT_ALLOWED` (`details.enrolledCount` na turma, `details.subscriptionCount` no plano), `COURT_HAS_CLASS_GROUPS`; 404 `CLASS_GROUP_NOT_FOUND`, `CLASS_SESSION_NOT_FOUND`, `PLAN_NOT_FOUND`, `COURT_NOT_FOUND`; 422 `TEACHER_NOT_FOUND`, `SPORT_NOT_FOUND`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`, `OUTSIDE_OPENING_HOURS`, `CLASS_SESSIONS_RANGE_TOO_LONG`.

*Job*: fila BullMQ `class-sessions`, job `generate-sessions`, cron `15 3 * * *` (America/Sao_Paulo), 3 tentativas com backoff, ligado por `JOBS_ENABLED`. Gera 4 semanas (`CLASS_SESSION_GENERATION_DAYS = 28`), uma sessão por turma e data local, ocupação `CLASS`; conflito → linha em `class_session_conflicts` e o job segue; falha de uma turma → `PartialClassJobFailure` no fim, o retry só completa o que falta. `ClassSessionsService` é exportado pelo `ClassesModule` (`generateFor`, `removeUpcomingUnconfirmed`, `lockGroup`).

*Auditoria*: `class_group.create|update|delete`, `class_session.capacity_change`, `plan.create|update|delete`.

### 2.2 · API: assinaturas, matrículas e mensalidades
- **Agente:** `api-engineer`
- **Branch:** `feat/api-subscriptions`
- **Plano:** `equilibrado`
- **Roadmap:** Fase 2 Backend — Planos e assinaturas, Mensalidades

**Prompt**
```
Implemente em apps/api, sobre o schema da migração 0012 (já no main), assinaturas e mensalidades (RF-CLASS-04..06, 11; RN-CLASS-01/02/06/07/08; decisões 12, 24 e 25). Se precisar de migração, use 0013.

(1) Assinatura: o aluno solicita um plano escolhendo as turmas fixas (Nx/semana = exatamente N turmas do esporte do plano; ilimitado = as turmas que escolher, sem limite de idas); a gestão aprova (cria enrollments ACTIVE, valida capacidade da turma sob concorrência com trava) ou recusa; troca de turma, desmatricular, pausa (respeita max_pause_days_per_year, congela mensalidades e confirmações), retomada, cancelamento (encerra as matrículas no fim do ciclo e não gera novas mensalidades). Estados PENDING_APPROVAL, ACTIVE, PAUSED, PAST_DUE, CANCELLED com transições validadas. Preço em snapshot. Forma de pagamento preferida (intended_payment_method). Aluno pode ter só uma assinatura PENDING/ACTIVE/PAUSED por plano.
(2) Mensalidades: job BullMQ (fila própria, idempotente, retry) gera a subscription_charge de cada ciclo, com vencimento no billing_day fixo do plano e sem pró-rata; PENDING que passa do vencimento vira OVERDUE; OVERDUE há mais de past_due_block_days (se a regra estiver ligada) leva a assinatura a PAST_DUE; pagar volta para ACTIVE. Registro de pagamento pela gestão (valor, forma, data, quem registrou) reutilizando payments/RF-PAY-01 (novo payable_type), com estorno e dispensa (WAIVED) por Dono/Admin. Lista de mensalidades a receber e inadimplentes; extrato de recebimentos passa a incluir o serviço de mensalidade de aula.
(3) Rotas: aluno em /v1/me/subscriptions (+ mensalidades e pausar/cancelar/trocar turma); gestão em /v1/manage/spaces/:spaceId/subscriptions e /subscription-charges. Respeitar permissões do doc 02 e spaces.status.
(4) Eventos de domínio e notificações push (padrão existente): assinatura aprovada/recusada, mensalidade próxima do vencimento e vencida.
Testes de integração para cada RN, capacidade sob concorrência, pausa, ciclos e job idempotente. Regenere o api-client, rode shared build, lint, typecheck, generate:check, testes de integração e reconstrua apps/api. Marque docs/06-roadmap.md e registre o contrato em docs/tarefas/fase-2.md, na seção desta tarefa. Não altere apps/web nem apps/mobile.
```

**Contrato entregue (2.2)** — o que 2.3, web e mobile consomem. Tipos em `@space-sports/shared` (`subscriptions.ts`) e no cliente gerado (`packages/api-client`, tag `subscriptions`). Código em `apps/api/src/classes/subscription*.ts`, `subscriptions.*.ts` e `*-subscriptions.controller.ts`.

*Schema (migração `0013_subscriptions`)*: `enrollment_status` ganhou `PENDING` (turma escolhida no pedido; **não ocupa vaga**, só `ACTIVE` conta). `subscriptions` + `pause_year`, `ends_on`, `cancel_requested_at`, `approved_at/by`, `rejected_at`, `cancelled_at/by`, `status_reason` (CHECK `cancel_at_period_end ⇒ ends_on`). `subscription_charges` + `due_reminder_sent_at`, `overdue_notified_at`, `waived_at/by` (CHECK `WAIVED ⇔ waived_at`). Detalhes em `docs/04`.

*Regras (provisórias; pergunta 12 de `docs/07`)*
- Estados: `PENDING_APPROVAL → ACTIVE` (aprovar) | `CANCELLED` (recusar, `rejected: true`; ou o aluno retira). `ACTIVE ⇄ PAUSED` (pausar; retomar ou o job no dia seguinte a `pausedUntil`). `ACTIVE ⇄ PAST_DUE` (job/pagamento). `ACTIVE|PAUSED|PAST_DUE → CANCELLED` no dia seguinte a `endsOn` (job). `PAST_DUE` não pausa. Transição inválida → 409 `INVALID_SUBSCRIPTION_STATUS`.
- RN-CLASS-01: Nx/semana = exatamente N turmas ativas do esporte do plano; ilimitado = uma ou mais; turmas não podem coincidir no horário. A gestão pode matricular em mais turmas (Nx: até N ativas) e desmatricular.
- RN-CLASS-02: aprovar, trocar de turma e matricular travam as linhas de `class_groups` (`FOR UPDATE`, ordem de id; ordem geral assinatura → turmas → mensalidades) e contam `enrollments` `ACTIVE`. Ao pedir, turma lotada já responde 409 `CLASS_GROUP_FULL` (aviso; a garantia é na aprovação).
- Preço: snapshot do plano **no pedido**. Uma assinatura em aberto por aluno e plano (409 `SUBSCRIPTION_ALREADY_EXISTS`). Plano inativo não aceita pedido (409 `PLAN_INACTIVE`).
- Ciclo (decisão 25): mês do calendário, vencimento no `billingDay`, sem pró-rata. Aprovado até o vencimento paga o mês cheio (a mensalidade nasce na aprovação); aprovado depois começa no mês seguinte. O job gera a do mês a partir do dia 1 (ou 5 dias antes do vencimento, se ele cair nos primeiros dias, `CHARGE_GENERATION_LEAD_DAYS`).
- RN-CLASS-06: `PENDING` vencida vira `OVERDUE`; com `past_due_block_enabled`, em aberto há **mais de** `past_due_block_days` dias desde o vencimento → `PAST_DUE`; pagar (até quitar), dispensar ou desligar a regra → `ACTIVE`. **Para a 2.3:** o bloqueio de confirmação é `subscription.status === 'PAST_DUE'` (o status só vira `PAST_DUE` com a regra ligada) e `PAUSED` também não confirma.
- RN-CLASS-07: pausa de hoje até `until` (inclusive), só `ACTIVE`; limite = `plan.pauseAllowed ? (plan.maxPauseDaysPerYear ?? settings.maxPauseDaysPerYear) : 0` por ano civil (`pauseDaysAvailable` na resposta; 0 → 409 `PAUSE_NOT_ALLOWED`; acima → 422 `PAUSE_LIMIT_EXCEEDED`). A mensalidade cujo vencimento cai na pausa não é cobrada (a já gerada, não vencida e sem pagamento, é apagada). Matrículas continuam `ACTIVE` (a vaga é do aluno). Retomar antes devolve os dias não usados.
- RN-CLASS-08: cancelar em curso → `cancelAtPeriodEnd`, `endsOn` = último dia do mês; a mensalidade do mês continua devida; a de ciclo posterior não é gerada (a antecipada sem pagamento é apagada); no dia seguinte a `endsOn` o job encerra a assinatura e as matrículas (`ENDED`, `endedOn = endsOn`). Repetir o cancelamento não muda nada.

*Permissões*: nova `charge.waive` (Dono, Admin). Assinaturas da gestão: `enrollment.manage` (Dono, Admin, Recepção; o Professor não vê assinaturas nem valores). Mensalidades e inadimplentes: `payment.record`. Pagar/estornar: `POST …/payments` e `POST …/payments/:paymentId/reverse` (`payment.record`, RN-PAY-01). Espaço suspenso: gestão só leitura (guard); as escritas do aluno → 403 `SPACE_READ_ONLY`.

*Rotas do aluno (`/v1/me/subscriptions`)*
| Método e rota | Notas |
|---|---|
| `POST /` | `RequestSubscriptionInput { planId, classGroupIds[], intendedPaymentMethod? }` → 201 `SubscriptionDetail` (`PENDING_APPROVAL`, matrículas `PENDING`) |
| `GET /?status` | `{ items: Subscription[] }` |
| `GET /:id` · `GET /:id/charges` | `SubscriptionDetail` (com `charges`, mais recentes primeiro) · `{ items: SubscriptionCharge[] }` |
| `PATCH /:id` | `{ intendedPaymentMethod: PaymentMethod \| null }` |
| `POST /:id/pause` · `/resume` · `/cancel` · `/swap-class-group` | `{ until, reason? }` · — · `{ reason? }` · `{ fromClassGroupId, toClassGroupId }`; todas devolvem `SubscriptionDetail` |

*Rotas da gestão (`/v1/manage/spaces/:spaceId`)*
| Método e rota | Permissão | Notas |
|---|---|---|
| `GET /subscriptions?status&planId&classGroupId&userId&limit&cursor` | `enrollment.manage` | `SubscriptionPage` (mais recentes primeiro) |
| `GET /subscriptions/:id` | `enrollment.manage` | `SubscriptionDetail` |
| `POST /subscriptions/:id/approve` | `enrollment.manage` | `{ classGroupIds? }` substitui as turmas pedidas; avisa o aluno |
| `POST /subscriptions/:id/reject` | `enrollment.manage` | `{ reason? }`; avisa o aluno |
| `POST /subscriptions/:id/pause` · `/resume` · `/cancel` · `/swap-class-group` | `enrollment.manage` | mesmas regras do aluno |
| `POST /subscriptions/:id/enrollments` · `DELETE /subscriptions/:id/enrollments/:enrollmentId` | `enrollment.manage` | matricular (201) · desmatricular (encerra hoje, a assinatura continua) |
| `GET /subscription-charges?status&overdue&subscriptionId&userId&dueFrom&dueTo&limit&cursor` | `payment.record` | `SpaceSubscriptionChargePage` (por vencimento, com `student`, `plan`, `subscriptionStatus`, `totalDueCents`) |
| `GET /subscription-charges/delinquents` | `payment.record` | `DelinquentsResponse { date, totalOverdueCents, items[{ subscriptionId, student, plan, overdueCount, overdueCents, oldestDueDate, daysOverdue }] }` |
| `POST /subscription-charges/:chargeId/waive` | `charge.waive` | `{ reason? }` → `SubscriptionCharge` `WAIVED`; idempotente |

*Formas*: `Subscription { id, space{id,name,slug,timeZone}, plan{id,name,sport,weeklyFrequency,billingDay}, student{userId,name,avatarUrl}, status, priceCents, intendedPaymentMethod, startsOn, currentPeriodStart/End, pausedFrom/Until, pauseDaysLimit, pauseDaysAvailable, cancelAtPeriodEnd, endsOn, rejected, statusReason, approvedAt, cancelledAt, createdAt, enrollments[{ id, status, startedOn, endedOn, classGroup{ id, name, weekday, startTime, durationMin, court, teacher{name,avatarUrl}, active } }], nextCharge{ chargeId?, dueDate, amountCents, status PROJECTED|PENDING|OVERDUE } | null, overdueCents }`. `SubscriptionCharge { id, subscriptionId, periodStart, periodEnd, dueDate, amountCents, paidCents, dueCents, status, waivedAt, payments[{ id, amountCents, method, paidAt }], createdAt }`.

*Pagamentos e extrato (mudanças de contrato existente)*: `RecordablePayableType` ganhou `SUBSCRIPTION_CHARGE` (até o valor em aberto; dispensada → 409 `CHARGE_NOT_PAYABLE`). O enum `BookingPayableType` do OpenAPI virou `PayableType` (inclui `SUBSCRIPTION_CHARGE`). `StatementService` ganhou `CLASS` (mensalidade de aula); `StatementEntry` ganhou `subscriptionId` e `planName`, e `chargePeriodStart` vale também para a mensalidade de aula; sem `service`, o extrato inclui as aulas.

*Erros*: 404 `SUBSCRIPTION_NOT_FOUND`, `SUBSCRIPTION_CHARGE_NOT_FOUND`, `ENROLLMENT_NOT_FOUND`, `PLAN_NOT_FOUND`; 409 `PLAN_INACTIVE`, `SUBSCRIPTION_ALREADY_EXISTS`, `INVALID_SUBSCRIPTION_STATUS`, `CLASS_GROUP_FULL`, `ALREADY_ENROLLED`, `PLAN_FREQUENCY_REACHED`, `PAUSE_NOT_ALLOWED`, `CHARGE_NOT_PAYABLE`, `CHARGE_NOT_WAIVABLE`, `CHARGE_HAS_PAYMENTS`; 422 `CLASS_GROUP_COUNT_MISMATCH`, `CLASS_GROUP_NOT_ELIGIBLE`, `CLASS_GROUPS_OVERLAP`, `PAUSE_LIMIT_EXCEEDED`, `PAUSE_UNTIL_IN_PAST`.

*Job*: fila BullMQ `subscriptions` (3 tentativas, backoff exponencial, `JOBS_ENABLED`): `process-billing` de hora em hora desde a 2.7 (antes às 00:20; por assinatura, cada uma na própria transação: encerra cancelamentos, retoma pausas, gera a mensalidade, marca `OVERDUE`, aplica `PAST_DUE`; falha isolada → `PartialClassJobFailure` no fim e o retry só completa o que falta) e `send-charge-reminders` às 09:00 (reserva por coluna, `SKIP LOCKED`; um aviso de cada tipo por mensalidade). Só espaços `ACTIVE`.

*Eventos e notificações*: `subscription.approved|rejected`, `subscription_charge.due_soon|overdue` → `SubscriptionNotifier` → tipos `SUBSCRIPTION_APPROVED`, `SUBSCRIPTION_REJECTED`, `SUBSCRIPTION_CHARGE_DUE_SOON`, `SUBSCRIPTION_CHARGE_OVERDUE` (`data: { subscriptionId, spaceId, chargeId? }`).

*Auditoria*: `subscription.request|approve|reject|pause|resume|cancel|swap_class_group`, `enrollment.create|end`, `subscription_charge.waive`, `payment.record|reverse` (com `chargeId`/`subscriptionId`).

*Ajustes pendentes em web e mobile (contrato mudou; sem eles o `typecheck` do monorepo falha)*: web `apps/web/src/lib/painel/statement.ts` precisa do rótulo de `CLASS` em `STATEMENT_SERVICE_LABEL`; mobile `apps/mobile/src/features/notifications/labels.ts` precisa dos 4 tipos novos.

### 2.3 · API: lista de presença, espera e sessões
- **Agente:** `api-engineer`
- **Branch:** `feat/api-attendance`
- **Plano:** `equilibrado`
- **Roadmap:** Fase 2 Backend — Lista de presença, Espera, Presença real, Notificações

**Prompt**
```
Implemente em apps/api, sobre o schema da migração 0012 (já no main), a lista de presença das sessões (RF-CLASS-07..10; RN-CLASS-03/04/05/06; decisão 24: sem reposição). Se precisar de migração, use 0014. Use enrollments ACTIVE como fonte de quem pode confirmar (nos testes, crie assinaturas/matrículas direto no banco; a lógica de assinatura é da tarefa 2.2, que roda em paralelo).

(1) Ciclo da sessão SCHEDULED, OPEN, CLOSED, DONE, CANCELLED. Modo AUTOMATIC: job BullMQ de 1 minuto abre em starts_at − attendance_open_before_min e fecha em starts_at − attendance_close_before_min (fila própria, idempotente, retry); MANUAL: Admin/Professor abre e fecha. Em qualquer modo Admin/Professor abre, fecha e reabre manualmente; toda ação vai para o log de auditoria. Sessão passa a DONE depois do fim.
(2) Aluno: ver as aulas da semana/dia das suas turmas (/v1/me/class-sessions), detalhe com lista confirmada e posição na espera, confirmar e desistir (até attendance_cancel_deadline_min antes) enquanto a lista estiver aberta; só confirma nas sessões das suas turmas; excedentes da capacidade da sessão vão para WAITLIST com waitlist_position sob trava de concorrência; desistência promove o primeiro da espera automaticamente. Assinatura PAUSED ou PAST_DUE (com a regra ligada) não confirma.
(3) Gestão no web (/v1/manage/spaces/:spaceId/class-sessions): calendário e detalhe, adicionar/remover aluno manualmente (added_by_staff; adicionar acima da capacidade vai para a espera), marcar presença real PRESENT/ABSENT depois da aula, cancelar sessão com motivo (libera a ocupação da quadra e avisa os alunos), trocar o professor de uma sessão. Professor só opera as próprias sessões; Recepção só lê.
(4) Visão de equipe somente leitura para o app (Professor/Admin): aulas de hoje do espaço, horários, listas e presenças, por /v1/me/staff-spaces ou rota equivalente sem valores.
(5) Notificações push (padrão existente): lista aberta, promovido da espera, aula cancelada.
(6) Histórico de presença por aluno e frequência por turma (base dos relatórios).
Testes de integração para cada RN, concorrência na última vaga e na promoção da espera, jobs idempotentes e permissões. Regenere o api-client, rode shared build, lint, typecheck, generate:check, testes de integração e reconstrua apps/api. Marque docs/06-roadmap.md e registre o contrato em docs/tarefas/fase-2.md, na seção desta tarefa. Não altere apps/web nem apps/mobile.
```

**Contrato entregue (2.3)** — o que web e mobile consomem. Tipos em `@space-sports/shared` (`attendance.ts`, novo) e no cliente gerado (tags `classes` e `me`). **Sem migração**: o schema da 0012 bastou.

*Quem pode confirmar (RN-CLASS-01/03/06/07, decisão 24)*: matrícula `ACTIVE` na turma da sessão, de assinatura `ACTIVE`, `PAUSED` ou `PAST_DUE` (pendente e cancelada não contam). Bloqueiam: assinatura `PAUSED` ou com `paused_from..paused_until` cobrindo a data da aula → `SUBSCRIPTION_PAUSED`; com `past_due_block_enabled`, assinatura `PAST_DUE` **ou** mensalidade `PENDING/OVERDUE` vencida há mais de `past_due_block_days` → `SUBSCRIPTION_PAST_DUE` (não depende do job da 2.2). Com mais de uma assinatura na turma, basta uma liberada. Código em `apps/api/src/classes/attendance-rules.ts` (`enrollmentStates`, `enrollmentBlock`): a 2.2 não precisa mudar nada se mantiver esses status/colunas.

*Concorrência*: toda mudança na lista e no status da sessão trava a linha de `class_sessions` (`FOR UPDATE`, `attendance-core.ts`); confirmados ≤ capacidade da sessão, excedentes em `WAITLIST` com `waitlist_position` 1..n sem buracos (refeitas a cada saída). Desistência, remoção e aumento da capacidade promovem a espera em ordem, **só antes do início da aula** (com a aula em andamento ninguém sai da espera). **Vaga ocupada** = `CONFIRMED` + `PRESENT` + `ABSENT` (`OCCUPYING_STATUSES` em `attendance-core.ts`): a marcação da presença não libera a vaga (2.5).

*Ciclo da sessão (RN-CLASS-04)*: `SCHEDULED → OPEN ⇄ CLOSED → DONE`, ou `CANCELLED`.
- Job: fila BullMQ `class-attendance`, job `attendance-tick`, cron `* * * * *`, 3 tentativas (backoff 5 s), ligado por `JOBS_ENABLED`. A cada rodada: aula terminada (`ends_at ≤ agora`) → `DONE` (qualquer modo/espaço); modo AUTOMATIC (padrão quando nulo): `OPEN` → `CLOSED` em `starts_at − attendance_close_before_min` (se não foi aberta depois desse horário), `SCHEDULED` que passou do fechamento → `CLOSED` direto (sem aviso), `SCHEDULED` → `OPEN` entre a abertura e o fechamento (só espaço `ACTIVE`). Cada transição numa transação com a sessão travada e o status conferido: rodadas repetidas/paralelas não duplicam transição nem aviso; falha de uma sessão → `PartialClassJobFailure` e o retry completa.
- Manual (qualquer modo): `open` de `SCHEDULED`/`CLOSED` até o fim da aula; reabrir depois do horário de fechamento automático deixa a lista aberta até alguém fechar. Só a primeira abertura avisa os alunos.
- Auditoria: `class_session.open|reopen|close|done|cancel|capacity_change|teacher_change`, `class_attendance.add|remove|presence` (as do job com `actorId` nulo e `diff.automatic`; `done` é gravado em lote, uma linha por sessão, na mesma transação da ida para `DONE`).

*Rotas do aluno (`/v1/me/class-sessions`, só login)*
| Método e rota | Notas |
|---|---|
| `GET /?from&to` | datas locais (America/Sao_Paulo), padrão hoje + 6 dias, máx. 31 (422 `CLASS_SESSIONS_RANGE_TOO_LONG`). Sessões das turmas com matrícula ativa + as em que a gestão o incluiu, canceladas inclusive. `{ from, to, items: MyClassSession[] }` |
| `GET /:sessionId` | `MyClassSessionDetail` = `MyClassSession` + `confirmed[]` (`userId, name, avatarUrl`; a espera só em número). Sessão de turma alheia → 404 `CLASS_SESSION_NOT_FOUND` |
| `POST /:sessionId/attendance` | 200 `MyClassSessionDetail`. Sem vaga entra na espera; quem desistiu e volta vai para o fim |
| `DELETE /:sessionId/attendance` | 200 `MyClassSessionDetail`. Confirmado: lista `OPEN` e até `cancellableUntil`; espera: antes do início (`OPEN`/`CLOSED`) |

`MyClassSession` = `ClassSession` + `space { id, name, slug, timeZone }`, `myAttendance { status, waitlistPosition } | null` (nulo = não está ou desistiu), `canConfirm`, `canWithdraw`, `blockedReason` (`LIST_NOT_OPEN | NOT_ENROLLED | SUBSCRIPTION_PAUSED | SUBSCRIPTION_PAST_DUE`, nulo se pode ou já está na lista) e `cancellableUntil` (`startsAt − attendance_cancel_deadline_min`).

*Rotas da gestão (`/v1/manage/spaces/:spaceId`)*
| Método e rota | Permissão | Notas |
|---|---|---|
| `GET /class-sessions/:id` | `classes.view` | **mudou**: agora `ClassSessionDetail` = `ClassSession` + `openedAt`, `closedAt`, `cancelledAt`, `attendances[]` (`Attendee`: `userId, name, avatarUrl, status, waitlistPosition, addedByStaff`; confirmados/presenças primeiro, depois a espera; sem desistências) e `enrolledStudents[]` (`userId, name, avatarUrl, subscriptionStatus`) |
| `PATCH /class-sessions/:id` | `classes.manage` | **mudou**: `{ capacity?, teacherMemberId? }` (ao menos um); aumentar a capacidade promove a espera (antes do início); responde `ClassSessionDetail`. 409 `CAPACITY_BELOW_CONFIRMED` abaixo das vagas ocupadas (confirmados + presenças marcadas); 422 `TEACHER_NOT_FOUND` |
| `POST /class-sessions/:id/open` · `/close` | `attendance.manage` | 200 `ClassSessionDetail`; 409 `CLASS_SESSION_STATUS_CONFLICT` (`details.status`, `details.action`) |
| `POST /class-sessions/:id/cancel` | `classes.manage` | `{ reason }` (1–200). Só `SCHEDULED/OPEN/CLOSED`; ocupação CLASS inativa (libera a quadra); a lista fica como estava (histórico); avisa matriculados + quem estava na lista |
| `POST /class-sessions/:id/attendances` | `attendance.manage` | `{ userId }`, 201 `ClassSessionDetail`; qualquer usuário (sem as travas de matrícula), `addedByStaff`; sem vaga (confirmados + presenças marcadas) → espera. Só sessão `SCHEDULED/OPEN/CLOSED`. 409 `ALREADY_IN_SESSION`, 422 `USER_NOT_FOUND` |
| `DELETE /class-sessions/:id/attendances/:userId` | `attendance.manage` | promove a espera (antes do início); 409 `NOT_IN_SESSION`, 409 `PRESENCE_ALREADY_MARKED` (quem já tem `PRESENT`/`ABSENT` não sai, 2.5) |
| `PUT /class-sessions/:id/presence` | `attendance.manage` | `{ items: [{ userId, status: PRESENT\|ABSENT }] }`; a partir do início da aula (409 `PRESENCE_TOO_EARLY`), também em `DONE`, não em `CANCELLED`; vale para quem está na lista e para os matriculados (senão 422 `STUDENT_NOT_IN_SESSION`, `details.userIds`) |
| `GET /class-attendances?userId&classGroupId&from&to&status` | `classes.view` | histórico; exige `userId` ou `classGroupId` (422 `ATTENDANCE_FILTER_REQUIRED`); datas locais, padrão últimos 30 dias, máx. 366 (422 `ATTENDANCE_RANGE_TOO_LONG`). `{ from, to, items: ClassAttendanceRecord[], summary }` |
| `GET /class-groups/:id/frequency?from&to` | `classes.view` | `{ classGroup, from, to, sessionsDone, sessionsCancelled, totals, students[] }`; contadores `present, absent, unmarked` (confirmado em aula `DONE` sem marcação) e `attendanceRate` (0–1 ou nulo) |

Escopo do Professor nos relatórios: o **histórico** (`class-attendances`) filtra pelo professor **da sessão** (`class_sessions.teacher_member_id`, inclui as aulas em que substituiu); a **frequência** (`class-groups/:id/frequency`) filtra pelo professor **da turma** (`class_groups.teacher_member_id`; a turma de outro → 404, mesmo que ele tenha dado aulas nela).

Escopo: `attendance.manage` = Dono, Admin e Professor **só nas sessões dele** (mesmo que também seja Recepção; outras → 404); Recepção só lê. Cancelar e trocar professor/capacidade: Dono/Admin. Espaço suspenso: escrita 403 `SPACE_READ_ONLY` (também nas rotas do aluno).

*Visão de equipe no app*: `GET /v1/me/staff-spaces` ganhou `today.classSessions: StaffTodayClassSession[]` (`id, classGroup, sportName, court, teacherName, startsAt, endsAt, status, capacity, confirmedCount, waitlistCount, attendees[]` sem valores; `confirmedCount` = vagas ocupadas, `CONFIRMED` + `PRESENT` + `ABSENT`, como em `ClassSession`), por horário, canceladas inclusive; quem é só Professor vê as dele.

*Notificações* (tipos novos em `NOTIFICATION_TYPES`, com preferência própria): `CLASS_LIST_OPEN` (matriculados que ainda não estão na lista e podem confirmar: `enrollmentBlock` com as configurações do espaço tira a assinatura pausada, a pausa agendada na data da aula e o atraso com a regra ligada), `CLASS_WAITLIST_PROMOTED`, `CLASS_SESSION_CANCELLED` (com o motivo no texto). `data: { classSessionId, spaceId }` para o deep link. Eventos de domínio: `class_session.opened`, `class_session.cancelled`, `class_attendance.promoted`.

*Erros novos*: 403 `NOT_ENROLLED_IN_CLASS`, `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_PAST_DUE`; 409 `ATTENDANCE_LIST_NOT_OPEN`, `CANCEL_DEADLINE_PASSED`, `ALREADY_IN_SESSION`, `NOT_IN_SESSION`, `PRESENCE_ALREADY_MARKED` (2.5), `CLASS_SESSION_STATUS_CONFLICT`, `PRESENCE_TOO_EARLY`; 422 `STUDENT_NOT_IN_SESSION`, `USER_NOT_FOUND`, `ATTENDANCE_FILTER_REQUIRED`, `ATTENDANCE_RANGE_TOO_LONG`.

*Impacto nos clientes*: o mobile deixa de compilar até ganhar os rótulos dos 3 tipos novos em `src/features/notifications/labels.ts` (mapa exaustivo) e `classSessions` no fixture de `staff-view-screen.test.tsx`; o web compila sem mudança. `ClassSessionsService.updateCapacity` saiu (virou `ClassSessionLifecycleService.update`).

### 2.4 · API: ajustes da revisão da 2.1
- **Agente:** `api-engineer`
- **Branch:** `fix/api-classes-core-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, aplique os achados da revisão da 2.1 (módulo apps/api/src/classes e vizinhos). Bloqueios: (1) class-groups.service.ts ~178: mudar teacherMemberId ou capacity não pode regenerar as sessões em modo STRICT (um bloqueio ou torneio a 5 semanas travaria a troca de professor com 409 CLASS_SCHEDULE_CONFLICT); atualize teacher_member_id e capacity direto nas sessões futuras sem confirmação, sem regenerar (isso preserva os ajustes manuais de capacidade por sessão), e use STRICT só quando o horário muda ou na reativação; teste do cenário. (2) class-groups.service.ts ~152: na transição inativa para ativa rode assertTeacher e assertCourt (professor com vínculo TEACHER ativo, quadra ativa que oferece o esporte); teste. Sugestões: (3) mudar a quadra para INACTIVE com turmas ativas deve recusar com 409 (ou o job pula a quadra inativa e sinaliza; escolha a recusa) e excluir quadra com turma deve responder com código e mensagem que citem as turmas; (4) trave a linha de space_members (FOR UPDATE) em assertTeacher; (5) trocar o esporte de turma ou plano com matrículas/assinaturas ativas deve recusar com 409; (6) inclua os campos novos de space_settings e uma turma, um plano e um professor de exemplo no seed (sem inventar dados dos espaços parceiros de docs/08: só nos espaços de demonstração do seed); (7) documente em docs/tarefas/fase-2.md, seção 2.1, que uma sessão com confirmação segura o dia ao trocar o horário no mesmo dia. Não faça a checagem de mensalista contra turmas além da janela (fica como pendência). Teste cada ponto. Rode pnpm --filter @space-sports/shared build, lint, typecheck, generate:check e os testes de integração; reconstrua apps/api. Não mude o contrato OpenAPI sem necessidade (se mudar, regenere o api-client). Não altere apps/web nem apps/mobile.
```

**Entregue (2.4)**
- Troca de professor/capacidade sem regenerar (bloqueio ou torneio no horário não trava mais a troca); `STRICT` só quando quadra/dia/horário/duração mudam ou na reativação. Reativar roda `assertTeacher` e `assertCourt`.
- `assertTeacher` trava a linha de `space_members` (`FOR UPDATE`); a equipe trava a mesma linha antes de contar as turmas ativas do professor, e `lockSpace` passou a `FOR NO KEY UPDATE` (não conflita com o `KEY SHARE` das FKs para `spaces`, evitando um possível deadlock com o insert da turma).
- Quadra: inativar com turmas ativas e excluir com turmas → 409 `COURT_HAS_CLASS_GROUPS` citando as turmas. Esporte da turma/plano travado com matrículas/assinaturas em andamento → 409 `SPORT_CHANGE_NOT_ALLOWED`.
- Seed de demonstração (`apps/api/test/e2e-seed`, espaço fictício "Arena E2E"): campos novos de `space_settings`, professor `professor.e2e@exemplo.com`, turma "Futevôlei iniciante" (sábado 07:00, Quadra A) e plano "Futevôlei 1x/semana". O seed de produção não mudou (parceiros sem dados inventados; os campos ficam nulos e valem os padrões).
- Contrato: só descrições/erros documentados no OpenAPI (api-client regenerado); nenhum schema mudou.
- Pendências: checagem de mensalista contra as sessões de turma além da janela de 4 semanas; trocar os esportes da quadra (`sports` no `PATCH /courts/:id`) tirando o esporte de uma turma ativa ainda não é recusado (a turma segue gerando sessões na quadra).

### 2.5 · API: ajustes da revisão da 2.3
- **Agente:** `api-engineer`
- **Branch:** `fix/api-attendance-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, aplique os achados da revisão da 2.3 (módulo de presença das aulas). Bloqueio: depois que a presença é marcada, só CONFIRMED conta como vaga ocupada; PRESENT e ABSENT também ocupam vaga. Corrija os três pontos: remover aluno (promoteWaitlist calcula free errado e promove da espera com a aula em andamento), adicionar aluno (estoura a capacidade) e PATCH de capacidade da sessão (aceita capacidade abaixo dos presentes/faltosos); não promova a espera quando startsAt <= now; recuse com 409 a remoção de quem já tem presença marcada; corrija também confirmedCount da visão de equipe (sessionRows) para contar CONFIRMED, PRESENT e ABSENT; teste o cenário (capacidade 2, B marcado PRESENT, remover B, adicionar D, PATCH capacity 1). Sugestões: (3) o aviso "lista aberta" não deve ir a quem não pode confirmar: reaproveite enrollmentBlock com as configurações do espaço para filtrar os destinatários (pausa agendada, atraso); (4) audite a transição automática para DONE (em lote) ou documente que não é auditada, prefira auditar; (7) registre em docs/tarefas/fase-2.md, seção 2.3, que frequência filtra pelo professor da turma e histórico pelo professor da sessão; (8) teste com duas chamadas de tick() simultâneas do job de ciclo da sessão. Não faça as sugestões 5 e 6 (ficam como pendência). Rode pnpm --filter @space-sports/shared build, lint, typecheck, generate:check (confira o nome do script) e os testes de integração; reconstrua apps/api. Não altere apps/web nem apps/mobile.
```

**Entregue (2.5)**
- Vaga ocupada = `CONFIRMED` + `PRESENT` + `ABSENT` (`OCCUPYING_STATUSES`): incluir aluno não estoura a capacidade depois da chamada, `PATCH` de capacidade recusa abaixo dos presentes/faltosos (409 `CAPACITY_BELOW_CONFIRMED`, mesmo código) e `confirmedCount` (`ClassSession` e visão de equipe) conta os três.
- A espera só é promovida antes do início da aula (`promoteWaitlist` não promove com `startsAt <= now`), na remoção, na desistência e no aumento da capacidade.
- Remover quem já tem presença marcada → 409 `PRESENCE_ALREADY_MARKED` (`details.status`).
- Aviso "lista aberta" filtrado por `enrollmentBlock` com as configurações do espaço (pausa agendada na data, atraso com a regra ligada), como na confirmação.
- Job: ida para `DONE` auditada em lote (`class_session.done`, sem ator, `diff.automatic`), com as linhas travadas em ordem de id; falha nesse lote é contada (`failures`) e o resto da rodada segue. Teste com duas rodadas de `tick()` simultâneas.
- Docs: escopo do Professor no histórico (professor da sessão) e na frequência (professor da turma) na seção 2.3.
- Contrato: só descrições no OpenAPI e o erro novo `PRESENCE_ALREADY_MARKED` no `DELETE …/attendances/:userId` (api-client regenerado); nenhum schema mudou. Web e mobile: tratar o 409 novo na remoção e ler `confirmedCount` como vagas ocupadas.
- Pendências: sugestões 5 e 6 da revisão da 2.3 (não feitas, por pedido).

### 2.6 · Mobile: destravar o typecheck com o contrato de aulas
- **Agente:** `mobile-engineer`
- **Branch:** `fix/mobile-classes-contract`
- **Plano:** `equilibrado`

**Prompt**
```
O contrato da API de aulas (2.1 a 2.3, já no main; packages/api-client atualizado) quebrou o typecheck do apps/mobile: faltam os 3 rótulos novos em features/.../labels.ts (os enums novos do contrato) e o campo classSessions: [] no fixture da visão de equipe (GET /v1/me/staff-spaces). Rode pnpm --filter @space-sports/shared build e os builds dos pacotes se precisar, depois pnpm --filter @space-sports/mobile typecheck, corrija só o necessário (rótulos em PT-BR e o fixture), sem criar telas novas. Lint (pnpm lint na raiz) e testes do app passando. Não altere apps/api nem apps/web.
```

### 2.7 · API: ajustes da revisão da 2.2
- **Agente:** `api-engineer`
- **Branch:** `fix/api-subscriptions-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api (e packages/shared), aplique os achados da revisão da 2.2. Bloqueio: a pausa de assinatura dispensa a mensalidade que vence dentro dela, então o aluno pausa 1 dia no vencimento todo mês e nunca paga. Decisão (provisória, registre como decisão 33 em docs/07 e em docs/02): a pausa pelo app tem duração mínima de 7 dias (configurável por espaço em space_settings, ex.: min_pause_days, com Zod em packages/shared); pausa menor é recusada com erro claro; só dispensa a mensalidade que vence dentro de uma pausa que cumpra o mínimo; teste do abuso (pausa de 1 dia sobre o vencimento). Sugestões: (3) o job process-billing roda às 00:20 de America/Sao_Paulo mas espaços em outros fusos ficam com ctx.today atrasado; rode de hora em hora e processe só os espaços que já passaram da meia-noite no fuso deles (idempotente); (4) os avisos de mensalidade (subscription-notifier) devem mostrar o valor em aberto (amountCents menos pagos), não o valor cheio; (5) registre em docs/07 (pergunta 12) que uma (6) comente em chargePeriodsToGenerate que o job só gera o mês atual e o seguinte e não recupera um mês inteiro parado; (7) registre em docs/07 a pergunta de aceitar turmas no mesmo horário em dois planos do mesmo aluno. Também corrija o aviso do biome em packages/shared/src/subscriptions.ts:336 sem trocar para Math.min (errado para strings de data): silencie a regra naquela linha com comentário. Teste cada ponto. Rode pnpm --filter @space-sports/shared build, lint, typecheck da API, generate:api-client:check e os testes de integração; reconstrua apps/api; regenere o api-client se o contrato mudar. Não altere apps/web nem apps/mobile.
```

**Entregue (2.7)**
- Decisão 33 (provisória): `space_settings.min_pause_days` (padrão 7, 1 a 365; `SpaceSettings.minPauseDays` em `@space-sports/shared`, GET/PATCH `…/settings`). Pausa do aluno menor que o mínimo → 422 `PAUSE_TOO_SHORT` (`details.minDays`). A gestão pode pausar por menos, mas aí a mensalidade que vence na pausa continua devida. Só a pausa que cumpre o mínimo dispensa a mensalidade (`pauseWaivesCharge`, `isPeriodBillable`); a retomada antecipada que encurta a pausa abaixo do mínimo volta a gerar a mensalidade que vencia nela (vencida, se já passou), mesmo de um mês anterior (`chargePeriodsBetween`).
- `Subscription` ganhou `pauseMinDays` (o mínimo do espaço, para o app mostrar e validar).
- Job `process-billing` de hora em hora (`20 * * * *`): cada assinatura é processada na primeira rodada depois da meia-noite do fuso do espaço e marcada em `subscriptions.billing_processed_on` (falha não marca; a próxima tentativa ou rodada pega de novo).
- Avisos de mensalidade (próxima do vencimento e vencida) mostram o valor em aberto (cheio menos os pagamentos não estornados).
- Migração `0014_min_pause_days` (`space_settings.min_pause_days`, `subscriptions.billing_processed_on`). Docs: decisão 33 em `docs/07` e RN-CLASS-07 em `docs/02`; pergunta 12 (d) (pausa que atravessa o ano) e pergunta 13 (turmas no mesmo horário em planos diferentes); comentário em `chargePeriodsToGenerate` (o job não recupera um mês inteiro parado).
- Contrato: `minPauseDays` em `SpaceSettings`/`UpdateSpaceSettingsInput`, `pauseMinDays` em `Subscription`, erro `PAUSE_TOO_SHORT` e descrições da pausa (api-client regenerado). Web: campo `minPauseDays` nas configurações do painel e o 422 `PAUSE_TOO_SHORT` na pausa; mobile: mostrar o mínimo e tratar `PAUSE_TOO_SHORT`.

### 2.8 · Web: rótulos e ajustes do contrato de aulas
- **Agente:** `web-engineer`
- **Branch:** `fix/web-classes-contract`
- **Plano:** `equilibrado`

**Prompt**
```
O contrato de aulas (2.1 a 2.5, já no main; packages/api-client atualizado) quebrou o typecheck do apps/web: falta o rótulo do serviço CLASS (STATEMENT_SERVICE_LABEL em apps/web/src/lib/painel/statement.ts, "Mensalidade de aula") e StatementEntry ganhou subscriptionId e planName. Rode pnpm --filter @space-sports/shared build e os builds dos pacotes se precisar. Corrija só o necessário (sem telas novas), inclusive o PayableType no payment-dialog se o contrato mudou, e lint (pnpm lint na raiz), testes e e2e com API simulada passando. Não altere apps/api nem apps/mobile.
```

### 2.9 · Mobile: rótulos de notificação de assinatura
- **Agente:** `mobile-engineer`
- **Branch:** `fix/mobile-subscriptions-contract`
- **Plano:** `equilibrado`

**Prompt**
```
O contrato de assinaturas de aula (2.2, já no main; packages/api-client atualizado) quebrou o typecheck do apps/mobile: faltam os 4 rótulos novos de notificação em apps/mobile/src/features/notifications/labels.ts (SUBSCRIPTION_APPROVED, SUBSCRIPTION_REJECTED, SUBSCRIPTION_CHARGE_DUE_SOON, SUBSCRIPTION_CHARGE_OVERDUE) em PT-BR. Rode pnpm --filter @space-sports/shared build e os builds dos pacotes se precisar, corrija só o necessário (sem telas novas) e deixe typecheck, lint (pnpm lint na raiz) e testes do app passando. Não altere apps/api nem apps/web.
```

## Onda 2 — Web e mobile (3 tarefas em paralelo; a API já está no `main`, contrato nas seções 2.1 a 2.7 acima)

### 2.10 · Web: turmas, planos, professores e configuração (/painel/aulas)
- **Agente:** `web-engineer`
- **Branch:** `feat/web-aulas-cadastros`
- **Plano:** `equilibrado`
- **Roadmap:** Fase 2 Painel — CRUD de turmas, planos e professores; Configuração da lista de presença

**Prompt**
```
Em apps/web, sob /painel/aulas, implemente o cadastro de aulas (RF-CLASS-01..03; permissões pela matriz do doc 02: Dono/Admin gerem, Professor vê só as próprias turmas, Recepção lê; esconda ações sem permissão). Contrato e rotas: seções 2.1, 2.2 e 2.7 de docs/tarefas/fase-2.md e packages/api-client (/v1/manage/spaces/:spaceId/class-groups, /plans, professores via equipe, space_settings). Telas: (1) Turmas: lista com vagas e matrículas, criar/editar/desativar (esporte, nível, professor, quadra, dia da semana, horário, duração múltipla de 30 min, capacidade), com os erros de conflito de agenda e SPORT_CHANGE_NOT_ALLOWED/COURT_HAS_CLASS_GROUPS tratados por código; (2) Planos: CRUD (frequência 1x/2x/3x/ilimitado, valor, dia de vencimento fixo 1 a 28, regras de pausa, mínimo de pausa); (3) Professores: listar, convidar e remover (reuse o fluxo de equipe; um professor pode estar em vários espaços); (4) Configuração da lista de presença e das regras de aula nas Configurações do espaço (modo automático/manual, abre/fecha X min antes, prazo de desistência, bloqueio por atraso, limite e mínimo de pausa). Adicione o grupo "Aulas" ao menu (nav.ts) mantendo o item Mensalidades para a tarefa 2.12. Use shadcn/ui, estados de carregamento/vazio/erro, valores em centavos formatados em R$ e horários em America/Sao_Paulo. Testes unitários e e2e com API simulada. Typecheck, pnpm lint na raiz e testes passando. Atualize os itens de Painel do espaço em docs/06-roadmap.md. Não altere apps/api nem apps/mobile.
```

### 2.11 · Web: calendário de sessões e lista de presença (/painel/aulas/sessoes)
- **Agente:** `web-engineer`
- **Branch:** `feat/web-aulas-sessoes`
- **Plano:** `equilibrado`
- **Roadmap:** Fase 2 Painel — Calendário de sessões; detalhe com lista, abrir/fechar, adicionar/remover aluno, presença

**Prompt**
```
Em apps/web, sob /painel/aulas/sessoes, implemente a operação das sessões (RF-CLASS-07..10; RN-CLASS-03..05; seção 2.3 e 2.5 de docs/tarefas/fase-2.md e packages/api-client: /v1/manage/spaces/:spaceId/class-sessions). Telas: (1) calendário/lista de sessões por semana e dia, com status (SCHEDULED/OPEN/CLOSED/DONE/CANCELLED), professor, quadra, ocupação (confirmados/capacidade) e fila de espera; Professor só vê as próprias; (2) detalhe da sessão: lista de presença (confirmados, espera com posição), abrir/fechar/reabrir manualmente, adicionar aluno (busca) e remover aluno (tratar 409 PRESENCE_ALREADY_MARKED), marcar PRESENT/ABSENT depois do início da aula, ler confirmedCount como vagas ocupadas; (3) só Dono e Admin cancelam a sessão (com motivo, avisando que os alunos serão notificados) e trocam o professor da sessão (decisão 32 de docs/07); Professor abre/fecha lista e marca presença das próprias aulas; (4) histórico de presença por aluno e frequência por turma. Esconda ações sem permissão, trate os erros por código, use estados de carregamento/vazio/erro e horários em America/Sao_Paulo. Testes unitários e e2e com API simulada. Typecheck, pnpm lint na raiz e testes passando. Atualize os itens correspondentes em docs/06-roadmap.md. Coordene só por arquivos novos: crie componentes sob components/painel/aulas/sessoes e não edite os de cadastros (tarefa 2.10 em paralelo), exceto uma linha no menu se ainda não existir. Não altere apps/api nem apps/mobile.
```

### 2.12 · Web: alunos, mensalidades e relatórios (/painel/aulas/alunos)
- **Agente:** `web-engineer`
- **Branch:** `feat/web-aulas-alunos-mensalidades`
- **Plano:** `equilibrado`
- **Roadmap:** Fase 2 Painel — Alunos; Mensalidades; Relatórios

**Prompt**
```
Em apps/web, sob /painel/aulas/alunos e /painel/aulas/mensalidades, implemente (RF-CLASS-05, 06, 11; RN-CLASS-06..08; seção 2.2, 2.3 e 2.7 de docs/tarefas/fase-2.md e packages/api-client: /v1/manage/spaces/:spaceId/subscriptions e /subscription-charges; permissão enrollment.manage, Professor não vê assinaturas nem valores): (1) Alunos: lista de assinaturas com filtros por status (PENDING_APPROVAL, ACTIVE, PAUSED, PAST_DUE, CANCELLED), aprovar/recusar pedidos, alterar as turmas do aluno, desmatricular, ver histórico de presença; (2) Mensalidades: a receber, inadimplentes, registrar pagamento (valor, forma, data) reutilizando o payment-dialog com o PayableType correto, estornar, dispensar (só Dono/Admin, charge.waive) e ver o extrato com o serviço de aula; (3) Relatórios: ocupação das turmas, frequência (dos relatórios de presença) e receita de mensalidades por período, com CSV quando a API oferecer. Trate erros por código, valores em centavos formatados em R$, datas em America/Sao_Paulo, estados de carregamento/vazio/erro. Crie componentes sob components/painel/aulas/alunos e components/painel/aulas/mensalidades; o item Mensalidades do menu já existe em nav.ts (aponte-o para a nova rota). Testes unitários e e2e com API simulada. Typecheck, pnpm lint na raiz e testes passando. Atualize os itens correspondentes em docs/06-roadmap.md. Não altere apps/api nem apps/mobile.
```

### 2.13 · Mobile: aulas, meu plano e visão de equipe
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-aulas`
- **Plano:** `equilibrado`
- **Roadmap:** Fase 2 App

**Prompt**
```
Em apps/mobile (Expo Router + NativeWind + React Native Reusables), implemente a jornada de aulas (RF-CLASS-04, 06..08, 10; decisões 21, 24 e 25 de docs/07; contrato nas seções 2.1 a 2.3, 2.5 e 2.7 de docs/tarefas/fase-2.md e packages/api-client: GET /v1/spaces/:slug/classes, /v1/me/subscriptions, /v1/me/class-sessions, GET /v1/me/staff-spaces): (1) aba Aulas na página do espaço: planos e turmas com vagas, contratar um plano escolhendo as turmas (Nx/semana = exatamente N turmas; ilimitado = as turmas escolhidas) e forma de pagamento preferida; (2) Meu plano: assinatura, turmas, próxima mensalidade e histórico (pagas/pendentes), pausar (duração mínima, mostrar o erro), cancelar (termina no fim do mês) e trocar turma; (3) Aulas da semana/dia com detalhe: professor, horário, quadra, status da lista, lista confirmada e posição na espera; confirmar e desistir enquanto a lista estiver aberta (tratar bloqueio por pausa/atraso e prazo de desistência por código de erro); (4) visão de equipe somente leitura (Professor/Admin): aulas de hoje com horários, listas de presença e presenças, sem valores e sem ações de gestão. Sem reposição de aula (decisão 24): não ofereça essa opção. Estados de carregamento/vazio/erro, textos em PT-BR, testID estáveis nas telas novas, testes unitários. Typecheck, pnpm lint na raiz e testes do app passando. Atualize os itens de App em docs/06-roadmap.md. Não altere apps/api nem apps/web.
```

## Onda 3 — Ajustes da revisão da Fase 2

### 2.14 · Mobile: ajustes da revisão da Fase 2
- **Agente:** `mobile-engineer`
- **Branch:** `fix/mobile-aulas-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/mobile, aplique os achados da revisão da 2.13. Bloqueio: (1) retomar a pausa (plan-detail-screen.tsx ~410 e pause-sheet.tsx ~35) não pode ser com um toque sem aviso: use um Alert de confirmação como no cancelamento; quando os dias já usados (hoje menos pausedFrom) forem menores que pauseMinDays, o texto deve dizer que a mensalidade que vencia durante a pausa volta a ser cobrada (e já nasce vencida se o vencimento passou); na folha de pausa acrescente "se você retomar antes de N dias, ela volta a ser cobrada" no lugar da garantia sem condição. Sugestões: (2) aula CANCELLED não pode mostrar "Presença confirmada" (session-detail-screen.tsx, sessions.ts, my-classes-section.tsx): mostre "Aula cancelada"; (3) blockedReason LIST_NOT_OPEN com sessão que não está SCHEDULED deve usar o hint do status (CLOSED/DONE/CANCELLED) em vez de "ainda não está aberta"; (4) trocar de turma (swap-sheet.tsx) deve selecionar e só então confirmar por botão ou Alert; (5) mensagens PT-BR para ALREADY_IN_SESSION e NOT_IN_SESSION em lib/api-errors.ts; (6) subscribe-screen.tsx: se planId não existe mais e há um único plano, cair nele; (7) plan-detail-screen: quando pauseBounds ficar nulo feche a folha (setPauseOpen(false)) para o erro não sumir; (8) classes-tab.tsx: maxPauseDaysPerYear === 0 significa "sem pausa". Teste cada ponto. Typecheck, pnpm lint na raiz e testes do app passando. Marque/ajuste docs/06-roadmap.md: a linha 52 ainda diz que falta o bloqueio de confirmação da 2.3 (já feito) e o item de visão de equipe do App deve citar as aulas de hoje. Não altere apps/api nem apps/web.
```

### 2.15 · API: ajustes da revisão da Fase 2
- **Agente:** `api-engineer`
- **Branch:** `fix/api-classes-phase2-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, aplique os achados da revisão da Fase 2. (1) attendance-rules.ts ~143: subscriptionStatus === 'PAUSED' bloqueia a confirmação em qualquer data, inclusive depois de pausedUntil (até o job retomar às 00:20); considere PAUSED como pausado só se pausedUntil for nulo ou a data da sessão for menor ou igual a pausedUntil, e aplique o mesmo critério ao filtro do aviso de lista aberta (class-notifier); teste: pausa até 05/11, aula 06/11 às 07:00, lista abrindo 24 h antes, o aluno recebe o aviso e consegue confirmar. (2) Uniformize o cálculo de "hoje" para atraso/pausa/bloqueio: confirmação (attendance.service.ts ~452), aviso (class-notifier.ts ~64) e cobrança (subscription-billing.ts) devem usar o fuso do espaço (cities.timezone), não DEFAULT_TIME_ZONE nem o da sessão; teste perto da meia-noite em espaço de outro fuso. Não mude o contrato OpenAPI. Teste cada ponto. Rode pnpm --filter @space-sports/shared build, lint, typecheck, pnpm generate:api-client:check e os testes de integração de classes; reconstrua apps/api. Não altere apps/web nem apps/mobile.
```

### 2.16 · Web: ajustes da revisão da Fase 2
- **Agente:** `web-engineer`
- **Branch:** `fix/web-aulas-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web, aplique os achados da revisão do web da Fase 2. Bloqueios: (1) sessao-detalhe-view.tsx ~137 e lib/painel/sessions.ts ~70: sessionActions usa new Date() só no desenho, então "Presente/Faltou" não aparece quando a aula começa com a tela aberta; crie um hook useNow() (atualiza por setTimeout até startsAt e endsAt, ou por intervalo curto) e passe now para sessionActions; teste com page.clock.runFor atravessando o startsAt. (2) alunos/approve-dialogs.tsx ~85: a aprovação trava quando uma turma pedida foi desativada ou mudou de esporte; comece com a interseção do pedido com as opções, ou liste as turmas pedidas indisponíveis como itens marcados desmarcáveis com o aviso "indisponível", e envie classGroupIds quando a seleção for diferente do pedido; teste. (3) e2e: mock-api.mjs ~621/627 devolve SPORT_CHANGE_NOT_ALLOWED sempre que body.sportId existe, e aulas-cadastros.spec.ts ~116 e ~296 validam isso; faça o mock comparar com o esporte atual (só recusa se mudar de verdade), faça o teste trocar de esporte de verdade e acrescente casos de editar só a capacidade da turma e salvar o plano sem mudar nada com sucesso. Sugestões: (2) csv.ts: neutralize também \t e \r no início da célula, como apps/api/src/common/csv.ts; (3) nav.ts: dê a cada item do grupo Aulas uma permission e filtre no app-sidebar para o Professor não ver Alunos e Mensalidades; (4) settings-form.ts ~102: a regra de mínimo de pausa maior que o limite anual do espaço vira aviso, não erro, porque o plano pode ter limite próprio; (7) remove-attendee-dialog: desabilite o botão depois do 409 PRESENCE_ALREADY_MARKED; (8) payment-dialog: mensagem própria para data vazia; (6) subscription-sheet: mostre o valor que falta (dueCents) quando há pagamento parcial; (11) esconda o preço dos planos ao Professor (quem não tem payment.record). A aba Receita dos relatórios visível para a Recepção fica como está (decisão 30 de docs/07); registre isso como observação em docs/07. Não faça as sugestões 5, 9, 10 e 12 (ficam como pendência). Testes unitários e e2e com API simulada, typecheck, pnpm lint na raiz passando. Não altere apps/api nem apps/mobile.
```

## Onda 4 — E2E real de Aulas

### 2.17 · QA: e2e real de Aulas (Playwright contra a API)
- **Agente:** `qa-engineer`
- **Branch:** `test-web-aulas-real-e2e`
- **Plano:** `equilibrado`

**Prompt**
```
Escreva o e2e real de Aulas em apps/web/e2e/real/aulas.spec.ts, contra a API real (playwright.real.config.ts, seed de apps/api/test/e2e-seed/seed.ts). Hoje só a agenda de aluguel (agenda.spec.ts) roda contra a API; o e2e de aulas com API simulada (e2e/aulas-*.spec.ts) não prova as regras do servidor. Cite os IDs RF/RN no nome de cada teste, como em agenda.spec.ts.

Fluxo, em sequência (mode serial): (1) RF-CLASS-02/03: o Dono cria pelo painel (/painel/aulas/turmas) uma turma com capacidade 2 na Quadra B num horário que a agenda.spec.ts não usa, e um plano 1x/semana (/painel/aulas/planos); a criação gera as sessões na hora (class-groups.service, generateFor), então confira a sessão em /painel/aulas/sessoes. Com JOBS_ENABLED=false nada roda por fila: não dependa de job. (2) Assinatura: os jogadores pedem o plano escolhendo a turma pela API do aluno (POST /v1/me/subscriptions, com o login do jogador por request do Playwright, porque a jornada do aluno é do app); o Dono aprova em /painel/aulas/alunos. RN-CLASS-02: com a turma lotada (2 matrículas), a aprovação de um terceiro recebe CLASS_GROUP_FULL e o painel mostra a mensagem. (3) Lista de presença: deixe o espaço em modo manual (Espaço → Configurações, ou pelo seed) e abra a lista pelo detalhe da sessão. (4) RF-CLASS-06/RN-CLASS-04: para lotar a sessão, reduza a capacidade da sessão a 1 ou use uma turma de capacidade maior com mais alunos; confirme alunos pela API do aluno (POST /v1/me/class-sessions/:id/attendance) até lotar; o excedente entra na espera com waitlistPosition; o primeiro desiste (DELETE …/attendance, dentro do prazo de desistência) e o primeiro da espera é promovido; confira no painel (lista com espera e posição). (5) Permissão do Professor: logado como professor.e2e, GET /v1/manage/spaces/:spaceId/teachers e as telas de sessões mostram só as turmas dele, e o menu esconde Alunos e Mensalidades (o mock não prova isso). (6) Presença real: presente/faltou só a partir do início da aula; se não der para controlar o relógio do servidor, crie a turma num horário de hoje que já começou, ou registre no relatório por que o passo ficou de fora.

Pode estender o seed (mais jogadores, por exemplo jogador2/3.e2e@exemplo.com, e o modo de presença do espaço), mantendo agenda.spec.ts verde; o seed é truncado e recriado a cada execução. Não altere código de produção (apps/api/src, apps/web/src, apps/mobile). Se achar um bug, escreva o teste que falha, marque com test.fail e um comentário com o ID, e descreva no relatório; não corrija.

Para rodar: docker compose up -d postgres redis; pnpm --filter @space-sports/shared build; pnpm --filter @space-sports/api build; DATABASE_URL=postgres://space_sports:space_sports@localhost:5432/space_sports_e2e pnpm --filter @space-sports/api db:migrate; pnpm --filter @space-sports/web test:e2e:real. Toda a suíte real (agenda + aulas) deve passar, além de pnpm lint na raiz e o typecheck do web. Não rode os testes de integração da API junto (memória). No fim, atualize docs/06-roadmap.md (Fase 2, item E2E/qualidade: o que o e2e real de aulas cobre) e a seção "Estado" deste arquivo.
```

### 2.18 · QA: ajustes da revisão da 2.17
- **Agente:** `qa-engineer`
- **Branch:** `test-web-aulas-real-e2e-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web/e2e/real/aulas.spec.ts e apps/api/test/e2e-seed/seed.ts, aplique as sugestões da revisão da 2.17. (1) RN-CLASS-01 (aulas.spec.ts ~204): o pedido com classGroupIds [] cai no Zod (400 genérico) e não exercita a regra do servidor; peça o plano 1x/semana com duas turmas do mesmo esporte (a turma criada no teste e "Futevôlei iniciante" do seed) e confira o error.code do mismatch de quantidade (subscriptions.service.ts, classGroupCountMismatch); mantenha o caso vazio se quiser, mas o comentário deve dizer o que cada um prova. (2) Instabilidade perto da meia-noite (~413): a aula em andamento começa 10 min antes de agora e é buscada com from=to=hoje em São Paulo; busque de ontem até hoje (localDate(-1)..localDate()) ou ache a sessão pelo id/nome sem depender do dia. (3) Decisão 34 de docs/07: o Professor vê a lista inteira de professores do espaço; em ~466, com o professor.e2e logado, confira que GET …/teachers traz também o "Professor Dois E2E" (e a contagem de turmas), para travar esse comportamento. (4) O título do teste em ~280 promete "e só então o aluno confirma": mova a primeira confirmação para esse teste ou ajuste o título. (5) seed.ts: a assinatura do jogador 3 tem currentPeriodStart e currentPeriodEnd no mesmo dia; use o mês do calendário (início e fim do mês, pergunta 12 de docs/07). (6) seed.ts: o comentário antes da turma "Futevôlei iniciante" diz que as sessões vêm do job; no e2e o job está desligado e a turma não tem sessões, corrija. Não altere código de produção. Rode build de shared, api-client e api, db:migrate no space_sports_e2e e pnpm --filter @space-sports/web test:e2e:real (a suíte inteira, agenda e aulas, deve passar), pnpm lint na raiz e o typecheck do web e da API. Não rode os testes de integração da API junto. Atualize a seção "Estado" deste arquivo.
```

## Onda 5 — Decisões 37, 40 e 41 (2.19 e 2.20 em paralelo, mergeadas; depois 2.21 e 2.22 em paralelo; 2.23 depois delas)

### 2.19 · API: choque de horário entre aulas e pausa mensal (decisões 37 e 41)
- **Agente:** `api-engineer`
- **Branch:** `feat/api-classes-overlap-monthly-pause`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api e packages/shared, implemente as decisões 37 e 41 de docs/07 (RN-CLASS-01 e RN-CLASS-07 já atualizadas em docs/02). Migração: 0015.

Decisão 37, choque de horário: um aluno não pode ter duas aulas no mesmo horário, em qualquer esporte, plano ou espaço. (a) Matrícula: pedido (POST /v1/me/subscriptions), aprovação, troca de turma e matrícula pela gestão recusam a turma cujo horário semanal (weekday + início + duração) se sobrepõe a outra turma ativa em que o aluno está matriculado em qualquer assinatura em aberto (inclusive pedidos pendentes do próprio aluno e de outros espaços, comparando no fuso de cada espaço). Hoje isso só é conferido dentro da mesma assinatura; reaproveite essa checagem. Novo código 409 CLASS_SCHEDULE_OVERLAP com a turma que conflita (nome, espaço, dia e horário; sem dados de outro espaço além disso). (b) Confirmação de presença (POST /v1/me/class-sessions/:id/attendance) e inclusão pela gestão recusam a aula que se sobrepõe (intervalo real starts_at/ends_at) a outra aula em que o aluno já está CONFIRMED ou na espera (WAITLISTED), novo 409 CLASS_SESSION_OVERLAP. Como a espera também conta no choque, a promoção não cria sobreposição; confira isso num teste. Corrida: serialize pelo aluno (trava da linha de users ou advisory lock por user_id) além das travas que já existem; teste duas confirmações simultâneas em espaços diferentes no mesmo horário. canConfirm/blockedReason do detalhe da aula devem refletir o choque (novo blockedReason SCHEDULE_OVERLAP).

Decisão 41, pausa por mês inteiro: substitua a pausa em dias. space_settings.max_pause_days_per_year → max_pause_months_per_year (padrão 1, 0 a 12), plans.max_pause_days_per_year → max_pause_months_per_year (nulo = usa o do espaço), remova min_pause_days e PAUSE_TOO_SHORT; na migração converta os dias para meses arredondando para cima e as pausas em andamento para meses inteiros (só há dados de desenvolvimento). Pausa: o aluno informa o mês de início (o próximo mês ou depois, nunca o corrente) e a quantidade de meses (pausedFrom = dia 1, pausedUntil = último dia do mês final, no fuso do espaço); a gestão também pode começar no mês corrente. O job de cobrança não gera a mensalidade dos meses trancados; confirmações bloqueadas no período (já existe). Saldo: contado por ano de cada mês trancado (resolve a pendência da pausa que atravessa o ano); erro PAUSE_LIMIT_EXCEEDED com o saldo. Retomar: devolve os meses ainda não iniciados; retomar dentro de um mês trancado gera a mensalidade desse mês (vence no billing_day, ou hoje se já passou). Cancelar uma pausa agendada antes de começar devolve tudo. Atualize o contrato (pauseMonthsLimit, pauseMonthsAvailable, sem pauseMinDays), a configuração do espaço e do plano, os avisos (notificações) e docs/04-modelo-de-dados.md. Remova as regras da decisão 33 (dispensa por pausa mínima, retomada que volta a cobrar) junto com os testes delas.

Testes de integração para cada regra. Regenere o cliente (pnpm generate:api-client) e rode generate:api-client:check, build de shared e api, lint, typecheck e os testes de integração de classes e subscriptions. Não altere apps/web nem apps/mobile (o web e o mobile vêm nas 2.21 e 2.22); liste no relatório o que mudou no contrato.
```

### 2.20 · API: exclusão de conta por pedido do usuário (decisão 40)
- **Agente:** `api-engineer`
- **Branch:** `feat/api-account-deletion-request`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api e packages/shared, implemente a decisão 40 de docs/07 (RF-AUTH-03 em docs/02). Já existe a base: account_deletion_requests (origem USER/SUPER, status PENDING e os demais), o atendimento e a recusa pelo Super em src/super/users.service.ts e anonymizeUser em src/users/anonymize.ts; a inativação pelo usuário é POST /v1/me/deactivate. Migração: 0016, se precisar.

(1) POST /v1/me/deletion-request (senha atual ou sessão recente, como na inativação; motivo opcional): numa transação cria o pedido com source USER e inativa a conta como a inativação faz (encerra as sessões, bloqueia o login); responde 201 com o prazo (createdAt + 15 dias). Pedido pendente duplicado → 409 DELETION_REQUEST_PENDING. E-mail de pedido recebido com o prazo e como desistir (pelo atendimento). (2) Endpoint público para a página web de exclusão (exigência do Google Play): POST /v1/public/deletion-request com e-mail e senha (credencial), mesmas regras, resposta genérica para não revelar se o e-mail existe, com rate limit. (3) Super: a lista de pedidos mostra o prazo (vencido em destaque pela ordenação), a origem e as pendências da conta (reservas e ocorrências de mensalista futuras, assinaturas em aberto, confirmações de aula futuras, mensalidades e valores em aberto, por espaço); ao atender (fulfill), antes de anonimizar, cancela as reservas futuras e as ocorrências de mensalista em que ele é o titular (liberando a ocupação da quadra), encerra as assinaturas, remove as confirmações futuras promovendo a espera, e avisa os espaços afetados (notificação para a gestão); pagamentos ficam. O bloqueio de único Dono e de Super continua. Recusar exige motivo e mantém a conta inativa; novo "cancelar pedido" (desistência pelo atendimento) marca o pedido como cancelado e reativa a conta. E-mails de concluído e recusado. Tudo auditado (super.deletion_request.*). Use os eventos de domínio e o padrão de notificações já existentes.

Testes de integração para cada caso (inclusive a anonimização depois dos cancelamentos e a promoção da espera). Regenere o cliente (pnpm generate:api-client), rode generate:api-client:check, build de shared e api, lint, typecheck e os testes de integração de users, super e me. Não altere apps/web nem apps/mobile; liste no relatório o que mudou no contrato.
```

### 2.21 · Web: choque de horário, pausa mensal e exclusão de conta
- **Agente:** `web-engineer`
- **Branch:** `feat/web-overlap-pause-deletion`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web, adapte o painel às tarefas 2.19 e 2.20 (já no main; contrato em packages/api-client). Estado do main: o typecheck de apps/web e apps/mobile está vermelho desde o merge da 2.19 e da 2.20 (campos de pausa em dias que saíram do contrato: maxPauseDaysPerYear, minPauseDays, pauseDaysLimit, pauseDaysAvailable, pauseMinDays, corpo { until }; novos valores de enum: status CANCELLED do pedido de exclusão e o tipo de notificação CUSTOMER_ACCOUNT_DELETED); deixá-lo verde é parte desta tarefa. Contrato novo: pausa { startMonth: 'YYYY-MM', months: 1..12, reason? }; assinatura com pauseMonthsLimit e pauseMonthsAvailable (pausedFrom maior que hoje = pausa agendada; POST …/resume também cancela a pausa agendada); erros CLASS_SCHEDULE_OVERLAP, CLASS_SESSION_OVERLAP, PAUSE_START_NOT_ALLOWED, PAUSE_ALREADY_SCHEDULED e PAUSE_LIMIT_EXCEEDED (com ano e meses restantes); exclusão em POST /v1/me/deletion-request ({ password?, reason? }, 201 { requestId, requestedAt, dueAt }; erros INVALID_PASSWORD, REAUTHENTICATION_REQUIRED, DELETION_REQUEST_PENDING, LAST_OWNER, SUPER_ACCOUNT) e POST /v1/public/deletion-request ({ email, password, reason? }, sempre 202 genérico; 429 TOO_MANY_REQUESTS). Do payload de CLASS_SESSION_OVERLAP use só nome, espaço e horário (o status vai sair, tarefa 2.23). (1) Decisão 37: mensagens em português para CLASS_SCHEDULE_OVERLAP (aprovação, troca de turma e matrícula em /painel/aulas/alunos, mostrando a turma que conflita) e CLASS_SESSION_OVERLAP (adicionar aluno no detalhe da sessão). (2) Decisão 41: Configurações do espaço e o formulário de plano passam a usar meses de pausa por ano (sem o mínimo de dias); na ficha do aluno, pausar escolhe o mês de início (a gestão pode o corrente) e a quantidade de meses, mostra o saldo do ano e retomar explica a regra (meses não iniciados voltam; o mês em andamento é cobrado); isso também resolve a pendência "pausar, retomar e cancelar assinatura pelo painel". (3) Decisão 40: em /super, a lista de pedidos de exclusão mostra origem, prazo (vencido em destaque) e as pendências da conta; ações atender, recusar (motivo obrigatório) e cancelar pedido (reativa); confirmação explicando o que será cancelado. Página pública /excluir-conta (exigida pelo Google Play): explica o que acontece e o prazo de 15 dias, formulário de e-mail e senha para o endpoint público e a resposta genérica; link no rodapé das páginas públicas. A página só funciona para quem tem senha: diga que quem entra com Google, Apple ou telefone pede pelo app ou pelo atendimento. Em /super: rótulo do status CANCELLED e da ação de cancelar (super cancel, reativa a conta); a notificação CUSTOMER_ACCOUNT_DELETED é para a gestão (Dono/Admin) e deve ter rótulo nas preferências do painel. Atualize os mocks do e2e (mock-api.mjs) e escreva testes unitários e e2e com API simulada. Typecheck, pnpm lint na raiz e testes passando. Não altere apps/api nem apps/mobile.
```

### 2.22 · Mobile: choque de horário, pausa mensal e exclusão de conta
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-overlap-pause-deletion`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/mobile, adapte o app às tarefas 2.19 e 2.20 (já no main; contrato em packages/api-client). Estado do main: o typecheck de apps/web e apps/mobile está vermelho desde o merge da 2.19 e da 2.20 (campos de pausa em dias que saíram do contrato: maxPauseDaysPerYear, minPauseDays, pauseDaysLimit, pauseDaysAvailable, pauseMinDays, corpo { until }; novos valores de enum: status CANCELLED do pedido de exclusão e o tipo de notificação CUSTOMER_ACCOUNT_DELETED); deixá-lo verde é parte desta tarefa. Contrato novo: pausa { startMonth: 'YYYY-MM', months: 1..12, reason? }; assinatura com pauseMonthsLimit e pauseMonthsAvailable (pausedFrom maior que hoje = pausa agendada; POST …/resume também cancela a pausa agendada); erros CLASS_SCHEDULE_OVERLAP, CLASS_SESSION_OVERLAP, PAUSE_START_NOT_ALLOWED, PAUSE_ALREADY_SCHEDULED e PAUSE_LIMIT_EXCEEDED (com ano e meses restantes); exclusão em POST /v1/me/deletion-request ({ password?, reason? }, 201 { requestId, requestedAt, dueAt }; erros INVALID_PASSWORD, REAUTHENTICATION_REQUIRED, DELETION_REQUEST_PENDING, LAST_OWNER, SUPER_ACCOUNT) e POST /v1/public/deletion-request ({ email, password, reason? }, sempre 202 genérico; 429 TOO_MANY_REQUESTS). Do payload de CLASS_SESSION_OVERLAP use só nome, espaço e horário (o status vai sair, tarefa 2.23). (1) Decisão 37: contratar plano e trocar de turma tratam CLASS_SCHEDULE_OVERLAP (mostrando a turma que conflita, inclusive de outro espaço); o detalhe da aula trata blockedReason SCHEDULE_OVERLAP e CLASS_SESSION_OVERLAP com mensagem em português. (2) Decisão 41: a folha de pausa de Meu plano passa a "trancar" por mês: escolher o mês de início (a partir do próximo) e a quantidade de meses, com o saldo do ano; retomar avisa que os meses não iniciados voltam ao saldo e que o mês em andamento é cobrado; a aba Aulas do espaço mostra a regra em meses; remova o mínimo de dias e PAUSE_TOO_SHORT. (3) Decisão 40: no Perfil, "Excluir conta" ao lado de "Inativar conta": tela explicando o que acontece (inativa na hora, a equipe confirma em até 15 dias, reservas, assinaturas e confirmações futuras são canceladas, para desistir fale com o atendimento), pede a senha e confirma com Alert; ao concluir, sai da conta e mostra o prazo (dueAt, no fuso America/Sao_Paulo); trate os erros listados acima (REAUTHENTICATION_REQUIRED pede a senha de novo). Dê rótulo a CUSTOMER_ACCOUNT_DELETED em src/features/notifications/labels.ts e esconda esse tipo das preferências de quem não é da gestão de um espaço. Testes do app, typecheck e pnpm lint na raiz passando. Atualize os fluxos do Maestro afetados (sem executar, se não houver emulador). Não altere apps/api nem apps/web.
```

### 2.23 · API: ajustes da revisão da 2.19
- **Agente:** `api-engineer`
- **Branch:** `fix/api-classes-overlap-pause-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, aplique as sugestões da revisão da 2.19. (1) subscription-charges.service.ts ~186: o job que inicia a pausa agendada leva a PAUSED qualquer status, inclusive PAST_DUE, e durante a pausa a assinatura sai de BILLED_STATUSES, apagando o atraso; mantenha a regra simples: a mensalidade vencida antes da pausa continua devida e, se a assinatura está PAST_DUE no dia 1, a pausa começa mesmo assim, mas a retomada (manual ou no fim) reavalia o atraso e o painel/inadimplentes continuam mostrando a mensalidade em aberto durante a pausa; teste. (2) resumeSubscription: retomar no próprio dia em que a pausa começa (pausedFrom >= hoje) deve devolver também o mês corrente e não gerar a mensalidade dele (a pausa nem começou de fato); só retomar com o mês já iniciado cobra o mês e gasta o saldo; teste. (3) attendance.errors.ts ~53: tire o status do payload de CLASS_SESSION_OVERLAP (fica nome, espaço, início e fim), para não expor ao espaço A a situação do aluno no espaço B; atualize OpenAPI e regenere o cliente. (4) cancel() com pausa agendada: ao pedir o cancelamento, apague a pausa agendada e devolva os meses em subscription_pause_months; teste. (5) Revisão da 2.22: o pedido de exclusão (POST /v1/me/deletion-request e o público) encerra as sessões, mas o token de push fica em devices para a conta inativa; remova os dispositivos do usuário na mesma transação e teste. (6) zonedWeeklySlotsOverlap: registre num comentário que o deslocamento do fuso é calculado no instante atual (sem horário de verão no Brasil hoje). (7) Acréscimo (decisão 40, item 6): a exclusão é só do Super; remova o tipo de notificação CUSTOMER_ACCOUNT_DELETED e o aviso aos Donos/Admins no atendimento (com migração para o enum, próximo número livre depois da 0016), mantendo os cancelamentos. No item 2, retomar no dia em que a pausa começa age como cancelar a pausa agendada (devolve o mês e cobra o mês normalmente), escolha confirmada durante a tarefa. Não crie notificações novas de pausa. Rode build de shared e api, lint, typecheck da API, pnpm generate:api-client:check e os testes de integração de classes. Não altere apps/web nem apps/mobile.
```

### 2.24 · Mobile: ajustes da revisão da 2.22
- **Agente:** `mobile-engineer`
- **Branch:** `fix/mobile-overlap-pause-deletion-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/mobile, aplique as sugestões da revisão da 2.22. (1) plan-detail-screen.tsx ~633: pauseScheduled deve valer também com status PAST_DUE (a API aceita cancelar a pausa agendada nesse status), mostrando o aviso "Pausa agendada" e o botão de cancelar. (2) pause-sheet.tsx ~374 e pause.ts ~469: quando o mês de início escolhido é do ano corrente, o seletor de meses vai só até pauseMonthsAvailable (e não até pauseMonthsLimit); meses que atravessam o ano contam no ano de cada mês, então calcule o máximo somando o saldo do ano corrente e o limite do ano seguinte (o saldo do ano seguinte começa cheio). (3) pause.ts ~468: com o saldo do ano zerado, a folha abre se houver opções de início no ano seguinte e mostra só essas. (4) delete-account-screen.tsx ~137: INVALID_PASSWORD mostra "Senha incorreta." no campo; "Digite a senha da sua conta." só para REAUTHENTICATION_REQUIRED. (5) delete-account-screen.tsx ~81: corrija o comentário sobre o token de push (a API passa a apagar os dispositivos no pedido, tarefa 2.23). (6) Decisão 40, item 6: a exclusão é só do Super e o tipo CUSTOMER_ACCOUNT_DELETED sai da API na 2.23 (já no main quando esta tarefa rodar): remova o rótulo, o filtro de preferências por gestão e os testes dele. Teste cada ponto. Typecheck, pnpm lint na raiz e testes do app passando. Não altere apps/api nem apps/web.
```

### 2.25 · Web: ajustes da revisão da 2.21
- **Agente:** `web-engineer`
- **Branch:** `fix/web-overlap-pause-deletion-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web, aplique as sugestões da revisão da 2.21. (1) lib/painel/pause.ts, canPause: não mostre "Pausar" quando o plano não permite pausa (pauseMonthsLimit igual a 0); teste. (2) startMonthOptions: quando a última pausa foi retomada dentro do mês corrente (pausedUntil maior ou igual ao início do mês corrente), não ofereça o mês corrente, porque a API recusa com PAUSE_START_NOT_ALLOWED; teste. (3) lib/painel/errors.ts, describeSlot: quando conflict.timeZone for diferente de America/Sao_Paulo, anexe o fuso ao horário do conflito (ex.: "Terça 19:00, horário de Manaus"); teste. Atualize os mocks do e2e se precisar. Testes unitários e e2e com API simulada, typecheck e pnpm lint na raiz passando. Não altere apps/api nem apps/mobile.
```

### 2.26 · API: ajustes da revisão da 2.23
- **Agente:** `api-engineer`
- **Branch:** `fix/api-pause-cancel-devices`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, aplique as sugestões da revisão da 2.23. (1) subscriptions.service.ts ~594: cancelar com uma pausa em andamento que passa do fim do ciclo (endsOn) deixa os meses depois de endsOn gastos e o pausedUntil além do fim da assinatura; em qualquer pausa (agendada ou em curso), devolva os meses a partir do mês seguinte ao endsOn e corte o pausedUntil em endsOn; registre na auditoria; teste (tranca de dezembro a fevereiro, cancela em 10/12: janeiro e fevereiro voltam ao saldo). (2) POST /v1/me/deactivate (decisão 29): encerra as sessões mas deixa os dispositivos de push; remova os devices do usuário na mesma transação, como no pedido de exclusão, e teste. (3) users/deletion-request.ts ~29: quebre a linha de 161 colunas do docblock. Não mude o contrato OpenAPI. Rode build de shared e api, lint, typecheck da API, generate:api-client:check e os testes de integração de classes, me e auth. Não altere apps/web nem apps/mobile.
```

## Onda 6 — Identidade visual e espaços parceiros (2.27 e 2.30 em paralelo, mergeadas; depois 2.28 e 2.29 em paralelo)

O kit (v1.1, com dark mode na prancha 07) está em `docs/brand/kit/` (pranchas HTML que abrem no navegador; leia o `README.md` de lá). Web e app seguem o kit nos dois temas. Ele substitui a identidade provisória "praia/areia" (laranja-sol e areia) de `docs/05-design-system.md`. Os nomes dos tokens semânticos (convenção shadcn) **não mudam**, para que o web e o mobile continuem compilando com a troca de valores.

### 2.27 · Design: tokens e arquivos da marca a partir do kit
- **Agente:** `ui-designer`
- **Branch:** `feat/brand-tokens`
- **Plano:** `equilibrado`

**Prompt**
```
Aplique o kit de marca de docs/brand/kit/ (leia o README.md e as sete pranchas HTML; 02-kit-de-logos.html é a fonte de verdade da logo) ao design system em packages/ui-tokens e à documentação. Hoje os tokens seguem a identidade provisória "praia/areia" (primária laranja #C2410C, fundo areia); a marca nova é: Mar #03547D (primária: ações, logo, links), Sol #FBBD10 (destaque, energia), Noite #06202E (texto, modo escuro, fundos profundos), Rede #FFFFFF (superfícies), com as escalas 50–900 de Mar, Sol e Neutra e as funcionais (sucesso #1F9D6B, alerta #E07B12, erro #D9483B, info #2A7CA4) da prancha 04. (1) Cores: exporte as escalas como primitivas (ex.: mar-50..900, sol-50..900, neutral-50..900) e remapeie os tokens semânticos sem mudar os nomes: primary = Mar com texto branco; secondary = Sol com texto Noite (botão "Destaque" da prancha 06); foreground = Noite; background = neutral-50 (#F7F9FA) e card branco; border neutral-200; input mais escuro (3:1, WCAG 1.4.11); ring Mar; accent (hover/seleção) num tom claro coerente (ex.: mar-50 ou sol-50); muted/muted-foreground na escala Neutra; sidebar coerente. Adicione o token info. As funcionais sólidas precisam de 4.5:1 com o texto que vai sobre elas: se #1F9D6B, #E07B12 ou #D9483B não passarem com branco, escureça o sólido (ou troque o texto por Noite) e documente; os status tingidos da prancha 06 (Confirmado #E3F4EC/#146B49, Pendente #FCF1D9/#7A5306, Cancelado #FBE5E3/#9E2A20) viram tokens próprios (ex.: success-subtle/-subtle-foreground). Charts: 5 séries derivadas da marca (Mar, Sol, Noite/neutro, sucesso, coral/erro) com 3:1 contra o fundo. Temas claro e escuro: siga a tabela de tokens da prancha 07 (07-dark-mode.html), que é a fonte de verdade dos dois temas: bg/base #F7F9FA/#071A24 (background), bg/surface #FFFFFF/#0C2633 (card, popover), bg/raised #EEF2F4/#12313F (muted, campos, hover/accent), border #DCE3E6/#1E4152, text/primary #06202E/#F2F6F8 (foreground), text/secondary #4A5A63/#A9BCC6 (muted-foreground), action/primary #03547D com texto #FFFFFF no claro e #FBBD10 com texto #06202E no escuro (primary: no escuro o Sol é a ação principal), action/secondary #FBBD10 com texto Noite no claro e #2A7CA4 com texto branco no escuro (secondary), text/link #03547D/#8FBFD8 (crie o token link), focus/ring #FBBD10 nos dois temas, status success #1F9D6B/#3CC48A, warning #E07B12/#F29A3A, error #D9483B/#F2685B, e os status tingidos do escuro (Confirmado #12392C/#3CC48A, Pendente #3D2410/#F29A3A; derive Cancelado na mesma lógica). No escuro, elevação por superfície (surface → raised), quase sem sombra. Onde o kit reprova ou não atinge o mínimo dos testes de contraste (ex.: o anel Sol sobre o fundo claro tem cerca de 1,7:1, abaixo dos 3:1 de elemento não textual), mantenha a cor do kit e acrescente o mínimo para passar (ex.: anel Sol com contorno ou offset em Mar no claro), documentando a escolha. Painel Super (classe super), nos dois temas: mantenha um destaque próprio que não se confunda com Mar nem com Sol (o violeta atual serve se continuar passando nos contrastes com os neutros novos). Atualize contrast.test.ts com os pares novos (inclusive os -subtle e os valores HSL arredondados do mobile) e regenere o CSS (pnpm generate). (2) Tipografia: duas famílias, Space Grotesk (display, títulos e logo; 400–700) e Inter (interface; 400–600). Exponha as famílias (ex.: font-display e font-sans) e a escala da prancha 05 como tokens: display 64/72 700 -0,02em, h1 48/56 700 -0,01em, h2 36/44 600, h3 24/32 600, body-lg 18/28, body 16/24, small 14/20 500, overline 12/16 600 +0,12em caixa alta; mantenha os tamanhos atuais do Tailwind (xs..4xl) para o texto denso do painel. (3) Raios: sm 6, md 12, lg 16, xl 24, full (pill); base --radius 12. Sombras no tom Noite. Espaçamento base 4 já existe. Alvo de toque mínimo 44 (botões do app em 48). (4) Arquivos da marca: crie packages/ui-tokens/brand/ com SVGs de todas as versões aprovadas da prancha 02: logo vertical (positivo, negativo sobre Mar, sobre Sol), horizontal (positivo e negativo), símbolo, monocromático escuro e branco, ícone de app (fundo Mar e fundo Sol) e o favicon simplificado (sem malha e sem rastros, para menos de 40 px). Copie os paths do símbolo exatamente como estão no HTML do kit; o nome ("SPACE" e "SPORTS", Space Grotesk 700/600, inclinado 9°, "SPORTS" espaçado entre traços na vertical) precisa virar contorno (paths), sem depender da fonte instalada: use um script com opentype.js ou fonttools sobre o arquivo da Space Grotesk (baixe do Google Fonts, licença OFL; não versione a fonte se não precisar). Gere também os PNGs que os apps vão usar, num script reproduzível versionado (ex.: packages/ui-tokens/scripts/brand.mjs com sharp ou @resvg/resvg-js) e com saída em packages/ui-tokens/brand/png/: ícone do app 1024x1024 (fundo Mar), Android adaptive icon (foreground com a área segura de 66%, background Mar e monochrome), splash icon, favicon 48 e 32, apple-touch-icon 180 e uma imagem Open Graph 1200x630 (logo horizontal negativo sobre Mar). Exporte também o markup dos SVGs em TS (ex.: src/brand.ts com strings por variante e as dimensões/viewBox), para o web renderizar inline e o mobile usar com react-native-svg (SvgXml). Respeite a área de proteção (x = raio da bola) e os mínimos (vertical 96 px de largura, horizontal 160, símbolo 40). Confira visualmente os SVGs e PNGs gerados contra a prancha 02 (abra no navegador ou renderize e olhe a imagem). (5) Documentação: reescreva a seção "Diretrizes visuais" de docs/05-design-system.md (marca nova em vez de "praia/areia", sem o "a marca ainda não existe"; tabela da paleta clara/escura com os contrastes; Super; tipografia com as duas famílias; raios; uso da logo: qual versão em qual fundo, mínimos, área de proteção, o que não fazer) e o README de packages/ui-tokens (como o web e o mobile carregam as fontes e usam os arquivos da marca). Não altere apps/web nem apps/mobile: eles serão adaptados nas tarefas 2.28 e 2.29, mas os nomes dos tokens existentes não podem mudar (só os valores; tokens novos são acréscimos). Rode pnpm --filter @space-sports/ui-tokens test, typecheck, build e o check do CSS gerado, e pnpm lint na raiz.
```

### 2.30 · API: logo do espaço, parceiros reais no seed e seed de demonstração (decisões 43 e 44)
- **Agente:** `api-engineer`
- **Branch:** `feat/api-space-logo-partners`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, implemente as decisões 43 e 44 (docs/07-perguntas-em-aberto.md) e a RF-SPACE-11 (docs/02-requisitos-funcionais.md); dados dos parceiros em docs/08-espacos-parceiros.md (nunca invente endereço, preço, horário nem dado de quadra além do que está lá). (1) Logo do espaço (RF-SPACE-11): coluna spaces.logo_url opcional (migração 0018). Upload no mesmo esquema das fotos (URL pré-assinada no R2, conferência do objeto real, tipo e tamanho; imagem quadrada, PNG/JPEG/WebP, limite de tamanho próprio e documentado), com rotas da gestão sob /v1/manage/spaces/:id/logo para pedir o upload, registrar a key, e remover (apaga o objeto antigo ao trocar ou remover); só Dono e Admin, respeitando o espaço suspenso (só leitura) e o modo suporte do Super; auditoria (space.logo.update / space.logo.remove). Exponha logoUrl (nullable) em todas as respostas que descrevem o espaço para o jogador e a gestão: vitrine/busca, mapa, página do espaço (GET /v1/spaces/:slug), favoritos, me/staff-spaces, a lista de espaços da gestão/seletor do painel e o Super (lista e detalhe). Erros com códigos próprios no padrão das fotos (LOGO_NOT_UPLOADED, LOGO_TOO_LARGE, INVALID_LOGO_FILE, INVALID_LOGO_KEY, STORAGE_UNAVAILABLE). Atualize o OpenAPI e regenere o cliente (pnpm generate:api-client) no mesmo branch; docs/04 já tem o campo. (2) Seed de produção (src/db/seed.ts), decisão 43: a Duna Sports (slug duna-sports, cidade Belo Horizonte/MG provisória até a confirmação, como registrado no docs/08) substitui a Arena 7 em SEED_PARTNER_SPACES (o seed não apaga espaços que já existam). Quadras dos parceiros, agora conhecidas: Astral Beach Sports 3, Arena Errejota 2, Duna Sports 2, nomeadas "Quadra 1".."Quadra N", descobertas, ACTIVE, cada uma com os três esportes do catálogo e maxPlayers = defaultMaxPlayers do esporte; idempotente e sem sobrescrever a implantação: só cria as quadras de um parceiro que ainda não tem nenhuma. Logo, preço, horário e endereço continuam fora do seed de produção. Atualize o comentário de SEED_PARTNER_SPACES e o teste test/db/seed.int.test.ts. (3) Seed de demonstração (dev/staging), separado do de produção e do e2e: src/db/scripts/seed-demo.ts com o script pnpm db:seed:demo (também na raiz), que roda o seed de produção e depois acrescenta, idempotente: o Dono da Astral Beach Sports "Goiano" e os professores Bruno, Galantine e Potenza (vínculos OWNER e TEACHER ativos); 2 professores fictícios na Arena Errejota e 2 na Duna Sports (invente nomes comuns e deixe claro no código que são fictícios); contas com e-mail verificado no domínio reservado exemplo.com (ex.: goiano.astral@exemplo.com) e senha de SEED_DEMO_PASSWORD (obrigatória, sem padrão no código); e as logos dos três parceiros a partir de docs/brand/parceiros/<slug>.jpg (copie para apps/api/src/db/demo-assets/ se for mais simples de empacotar), enviadas ao storage pelo mesmo serviço do upload quando o R2 estiver configurado e puladas com aviso quando não estiver. O script recusa rodar com NODE_ENV=production e não cria preço, horário, turma nem plano. Documente no README da API como rodar e quais contas ele cria. Testes de integração: upload/registro/remoção da logo (permissões, suspenso, modo suporte, arquivo inválido, troca apaga o antigo), logoUrl nas respostas, quadras do seed (idempotência, não mexe em quem já tem quadra) e o seed de demonstração (idempotente, contas e vínculos, recusa em produção). Rode build de shared e api, lint, typecheck, pnpm generate:api-client:check, drizzle-kit check e os testes de integração de spaces, super, me e db. Não altere apps/web nem apps/mobile.
```

### 2.28 · Web: aplicar a marca no painel, no Super e nas páginas públicas
- **Agente:** `web-engineer`
- **Branch:** `feat/web-brand`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web, aplique a identidade visual nova (tarefa 2.27, já no main) e a logo do espaço (tarefa 2.30, já no main): tokens em packages/ui-tokens (paleta Mar/Sol/Noite, tokens novos como info e os -subtle de status, fontes, raios), arquivos da marca em packages/ui-tokens/brand/ e o markup dos SVGs em @space-sports/ui-tokens (src/brand.ts). Referência visual: docs/brand/kit/ (abra as pranchas no navegador; a 07 é o tema escuro) e docs/05-design-system.md, seção "Diretrizes visuais". O web segue o kit nos dois temas: no escuro a ação principal é Sol com texto Noite, a secundária Mar 400, links #8FBFD8, chip de esporte selecionado em Sol e os demais em bg/raised com borda, campos em bg/raised. (1) Fontes: Space Grotesk pelo next/font/google ligada à variável de família display dos tokens, ao lado da Inter já existente; títulos de página, h1–h3 e números de destaque em Space Grotesk; o resto em Inter. (2) Logo: um componente Logo (variantes vertical, horizontal e símbolo; tons positivo, negativo e sobre Sol; monocromático) que renderiza o SVG inline com aria-label "Space Sports", respeitando os mínimos e a área de proteção. Use a horizontal no topo da sidebar de /painel e de /super (símbolo quando a sidebar recolhe), a vertical nas telas de login, cadastro, convite e recuperação de senha, e a horizontal no cabeçalho e no rodapé das páginas públicas (incluindo /excluir-conta); troque qualquer texto "Space Sports" que faça as vezes de logo. Nos fundos escuros, a versão negativa. (3) Metadados: favicon, icon e apple-icon do app router a partir de packages/ui-tokens/brand/ (copie para apps/web/src/app ou public), themeColor Mar e a imagem Open Graph nas páginas públicas. (4) Componentes: confira que os componentes shadcn seguem os tokens novos sem cores fixas no código (procure hex, classes como orange-*, amber-* e restos da paleta areia e troque por tokens); badges de status de reserva, pagamento e mensalidade com os tokens -subtle (Confirmado/Pago verde, Pendente âmbar, Cancelado/Atrasado vermelho); chips de esporte como na prancha 06 no claro (selecionado em Noite, os demais em sol-100) e na 07 no escuro; campo em foco com borda Mar (o fundo sol-50 só nas páginas públicas, se ficar bom); botões primário Mar, destaque Sol com texto Noite. Densidade do painel continua a atual (não suba tudo para 48 px no painel; nas páginas públicas os botões ficam com 48). Anel de foco: o ring agora é Sol; troque os ring-ring/50 (9 usos) e ring-offset-background (2) pela receita de docs/05-design-system.md (anel sem opacidade, com ring-offset-ring-offset, que é Mar no claro), para o foco ficar visível nos dois temas. Raios: rounded-xl passou a valer 24 (raio do card de quadra do kit); os cards comuns (inclusive o Card do shadcn) devem usar rounded-lg (16), deixando o 24 só para o card de espaço/quadra das páginas públicas. (5) Logo do espaço (RF-SPACE-11, tarefa 2.30, já no main): na aba Espaço do painel (dados do espaço), enviar, trocar e remover a logo (Dono/Admin; quadrada, com prévia e os erros LOGO_* e STORAGE_UNAVAILABLE em português), no fluxo de URL pré-assinada das fotos; mostrar logoUrl no seletor de espaço da sidebar, no Super (lista e detalhe) e na página pública do espaço; sem logo, as iniciais do nome num círculo com os tokens. (6) Confira claro e escuro e a variante Super em todas as áreas (rode o app e olhe as telas principais: login, Hoje, Agenda, Aulas, Super e a página pública de um espaço; tire capturas). Atualize os testes que dependem de textos ou classes trocados e os mocks do e2e se preciso. Testes unitários, e2e com API simulada, typecheck e pnpm lint na raiz passando. Não altere packages/ui-tokens (se faltar algum token, registre no relatório final), apps/api nem apps/mobile.
```

### 2.29 · Mobile: aplicar a marca no app (ícone, splash, fontes e logo)
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-brand`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/mobile, aplique a identidade visual nova (tarefa 2.27, já no main) e a logo do espaço (tarefa 2.30, já no main): tokens em packages/ui-tokens (paleta Mar/Sol/Noite, tokens novos como info e os -subtle de status, fontes, raios; o NativeWind recebe o nativewind.css gerado), PNGs da marca em packages/ui-tokens/brand/png/ e o markup dos SVGs em @space-sports/ui-tokens (src/brand.ts). Referência visual: docs/brand/kit/ (a prancha 07 é o tema escuro) e docs/05-design-system.md, seção "Diretrizes visuais". O app segue o kit nos dois temas: no escuro a ação principal é Sol com texto Noite, a secundária Mar 400, links #8FBFD8, chip de esporte selecionado em Sol e os demais em bg/raised com borda, campos em bg/raised, card de quadra como o da prancha 07, elevação por superfície. (1) Ícones e splash: troque os ícones padrão do Expo em apps/mobile/assets/images (icon, adaptive icon foreground/background/monochrome, splash icon, favicon) pelos PNGs da marca e ajuste o app.json (cor de fundo do adaptive icon e da splash em Mar #03547D; splash com o símbolo; modo escuro da splash em Noite #06202E se o plugin permitir). (2) Fontes: @expo-google-fonts/space-grotesk (400–700) junto com a Inter já carregada; títulos de tela, cabeçalhos de seção, preços e placares em Space Grotesk, o resto em Inter; mapeie as famílias no tailwind/NativeWind conforme os tokens (font-display). (3) Logo: componente Logo com react-native-svg (SvgXml com as strings de brand.ts), variantes vertical, horizontal e símbolo e tons positivo, negativo e sobre Sol, com accessibilityLabel "Space Sports". Use a vertical nas telas de boas-vindas, login, cadastro e recuperação de senha, e a horizontal ou o símbolo no cabeçalho da Vitrine (Explorar); nos fundos escuros (tema escuro), a versão negativa. (4) Componentes: tire cores fixas do código (hex, classes da paleta areia/laranja) em favor dos tokens; botões com 48 de altura e raio 12 (primário Mar, destaque Sol com texto Noite, escuro Noite, contorno); chips de esporte como na prancha 06 no claro (selecionado em Noite, os demais em sol-100) e na 07 no escuro; badges de status com os tokens -subtle; campo em foco com borda Mar; card de espaço com raio 24 como o card de quadra das pranchas 06 e 07 (sem inventar dados: só o que a API traz); barra de abas com o ativo em Mar (Sol no escuro, se seguir a ação principal da prancha 07). Raios: rounded-xl passou a valer 24 (raio do card de quadra do kit); os cards comuns devem usar rounded-lg (16), deixando o 24 para o card de espaço. Anel de foco (quando houver, ex.: teclado/acessibilidade) com o token ring e o ring-offset. Alvos de toque de pelo menos 44. (5) Logo do espaço (RF-SPACE-11, tarefa 2.30, já no main): mostrar logoUrl (expo-image) no card da vitrine, no mapa (pin ou cartão), na página do espaço, nos favoritos e na aba Meu Espaço; sem logo, as iniciais do nome num círculo com os tokens; o app não envia logo (gestão só no web). (6) Confira claro e escuro (rode o app no emulador se houver e tire capturas das telas principais: boas-vindas, login, Explorar, página do espaço, Agenda, Perfil). Atualize os testes e os fluxos do Maestro afetados (sem executar, se não houver emulador). Testes do app, typecheck e pnpm lint na raiz passando. Não altere packages/ui-tokens (se faltar algum token, registre no relatório final), apps/api nem apps/web.
```

### 2.31 · API: ajustes da revisão da 2.30
- **Agente:** `api-engineer`
- **Branch:** `fix/api-space-logo-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, aplique as sugestões da revisão da 2.30 (logo do espaço, já no main). (1) space-logo.service.ts, set(): compare a key com a logo atual antes do checkObject; registrar de novo a key em uso hoje pode apagar o objeto (se a URL pré-assinada ainda valer e alguém regravar um arquivo inválido) e deixar spaces.logo_url apontando para um arquivo inexistente. Retorne sem mudanças quando a key é a atual; se for simples, copie o objeto conferido para uma key final, para que a URL pré-assinada não alcance o arquivo publicado (avalie aplicar o mesmo às fotos). Teste. (2) storage/photo-storage.ts, read(): limite a leitura com Range bytes=0-<limite> no GET, para que um arquivo regravado entre o HEAD e o GET não seja lido inteiro na memória; teste. (3) Mova EXTENSIONS, lockSpace e contentTypeOfKey de manage-spaces.service.ts para um módulo utilitário (ex.: spaces/storage-keys.ts) usado pelos dois serviços. (4) db/demo-seed.ts: se o PUT do arquivo funcionar e o registro falhar, apague o objeto (storage.delete) no catch. Não mude o contrato OpenAPI. Rode build de shared e api, lint, typecheck, generate:api-client:check e os testes de integração de spaces e db. Não altere apps/web nem apps/mobile.
```

### 2.32 · Mobile: ajustes da revisão da 2.29
- **Agente:** `mobile-engineer`
- **Branch:** `fix/mobile-brand-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/mobile, aplique as sugestões da revisão da 2.29 (marca do kit, já no main). (1) components/ui/button.tsx ~22: a variante secondary agora é Sol (destaque), e isso transformou botões que eram discretos em chamadas fortes, ex.: "Criar conta" em app/(auth)/entrar.tsx ~88 logo abaixo de "Entrar" e features/booking/invite-section.tsx ~66. Procure todos os usos de variant="secondary" e decida caso a caso: mantenha Sol só onde é o "Destaque" do kit (prancha 06: "Ver horários") e troque por outline ou ghost onde a intenção era um botão secundário discreto; nunca duas chamadas fortes lado a lado. (2) components/ui/input.tsx ~17: o foco troca border-[1.5px] por border-2 e empurra o conteúdo; mantenha a mesma largura e troque só a cor (ou compense o padding). (3) components/ui/chip.tsx ~57-64: no escuro, o chip desabilitado não apaga o texto porque as classes dark: continuam valendo; acrescente dark:text-muted-foreground no estado desabilitado. (4) button.tsx ~77 e chip.tsx ~73: o anel de foco some quando style é função; componha o anel também nesse caso (ou documente). (5) features/notifications/preferences-screen.tsx ~50: troque color('light', 'card') por um valor que não finja depender do tema (comentário ou constante clara). (6) package.json: "@expo-google-fonts/space-grotesk" com ^ como a Inter. Teste o que mudar. Não rode emulador nem Gradle (a máquina tem pouca memória). Testes do app, typecheck e pnpm lint na raiz passando. Não altere packages/ui-tokens, apps/api nem apps/web.
```

### 2.33 · Web: ajustes da revisão da 2.28
- **Agente:** `web-engineer`
- **Branch:** `fix/web-brand-review`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web, aplique as sugestões da revisão da 2.28 (marca do kit, já no main; o e2e da logo em série e o themeColor pelos tokens já foram corrigidos). (1) components/space-avatar.tsx: onde a logo do espaço aparece ao lado do próprio nome (seletor da sidebar, lista e detalhe do Super), a imagem é decorativa: use alt="" (ex.: prop decorative) para o leitor de tela não ler o nome duas vezes; mantenha o alt "Logo de <nome>" onde a imagem está sozinha; ajuste o e2e marca.spec.ts ~134. (2) Revise os usos de variant="secondary" do Button (agora é Sol, o "Destaque" do kit): mantenha só onde é de fato destaque e troque por outline/ghost onde a intenção era um secundário discreto; nunca duas chamadas fortes lado a lado. (3) Overlays de diálogo e sheet em bg-neutral-900/60: no escuro o contraste com o fundo #071A24 fica baixo; ajuste o scrim do tema escuro (ex.: mais opaco) e confira um diálogo nos dois temas. (4) e2e com API simulada: na suíte completa, testes que leem mockCalls (ex.: auth.spec.ts ~192, painel.spec.ts ~146) falham às vezes em paralelo porque o mock tem estado único; isole por teste (prefixo/escopo por worker ou filtro pelo id do espaço/usuário do teste) ou marque em série os describes que dependem de mockCalls, e confirme duas execuções completas seguidas sem falha. Registre no relatório final os tokens que faltaram (ex.: chip, chip-selected, scrim) para a ui-designer. Testes unitários, e2e com API simulada, typecheck e pnpm lint na raiz passando. Não altere packages/ui-tokens, apps/api nem apps/mobile.
```

## Onda 7 — Design system e paleta do web fiéis ao kit (2.34 primeiro; 2.35 depois do merge da 2.34)

Pedido do usuário (2026-10-29): o design system e a paleta do web devem seguir a marca. As tarefas 2.27, 2.28 e 2.33 aplicaram os tokens e a logo, mas os componentes e as telas do web ainda não reproduzem o kit nos dois temas. Plano `forte` por pedido do usuário.

### 2.34 · Design: auditoria do web contra o kit e tokens que faltam
- **Agente:** `ui-designer`
- **Branch:** `feat/web-brand-audit`
- **Plano:** `forte`

**Prompt**
```
Compare o web (apps/web) com o kit de marca (docs/brand/kit/: leia o README.md e as sete pranchas HTML; a 04 é a paleta, a 06 os componentes e a 07 o tema escuro, que é a fonte de verdade dos tokens dos dois temas) e feche as diferenças do lado do design system. Os tokens já foram aplicados nas tarefas 2.27 (packages/ui-tokens), 2.28 e 2.33 (apps/web), descritas em docs/tarefas/fase-2.md; o usuário diz que o design system e a paleta do web ainda não seguem a marca. (1) Auditoria visual: rode o web (pnpm --filter @space-sports/web dev, com a API simulada do e2e se não houver API; veja apps/web/e2e e o README do web) e abra as pranchas 04, 06 e 07 no navegador. Tire capturas, nos temas claro e escuro, de: login, Hoje, Agenda, Aulas, uma tela de formulário, um diálogo, o Super (classe super) e a página pública de um espaço. Compare com as pranchas peça por peça: paleta e uso das cores (onde aparece Mar, Sol, Noite; fundo, superfícies, bordas e textos), botões (primário, destaque, escuro, contorno, ghost; altura, raio, peso e tamanho da fonte), campos (fundo, borda, foco, rótulo, ajuda e erro), chips de esporte e de status, badges, cards (raio, borda, sombra, card de quadra), tabelas, abas, sidebar (fundo, item ativo, ícones), cabeçalhos de página (Space Grotesk, escala h1–h3), links, anel de foco, diálogo/sheet (scrim), toasts e gráficos. Procure também cores fixas no código (hex, rgb, classes da paleta padrão do Tailwind como gray-*, slate-*, zinc-*, red-*, green-*, amber-*, blue-*, violet-*, e opacidades soltas como black/50) e tokens usados para o propósito errado (ex.: secondary como cinza, accent no lugar de muted). (2) Escreva docs/brand/auditoria-web.md: tabela por componente/tela com "como está" × "como o kit pede" (cite a prancha e o valor), a correção e quem faz (ui-tokens ou web), com as capturas em docs/brand/auditoria-web/ (PNG, só as necessárias, comprimidas). Essa lista será a especificação da tarefa 2.35 (web), então seja concreta: classes/tokens a usar por componente, nos dois temas. (3) Tokens: acrescente em packages/ui-tokens o que faltar para o web seguir o kit sem cor fixa, nos dois temas e na variante super quando couber. No mínimo: scrim (hoje provisório em apps/web/src/app/globals.css: neutral-900 a 60% no claro, preto a 80% no escuro), chip e chip-selected (fundo, texto, borda; prancha 06 no claro: selecionado Noite, os demais sol-100; prancha 07 no escuro: selecionado Sol com texto Noite, os demais bg/raised com borda), e o que a auditoria mostrar (ex.: botão escuro/Noite, campo em foco, superfície raised, sombras no tom Noite, overline). Os nomes dos tokens existentes não mudam (só valores; tokens novos são acréscimos), porque o web e o mobile compilam com eles. Corrija valores que divergirem do kit e documente onde o contraste obrigou a desviar. Atualize contrast.test.ts com os pares novos (inclusive os valores HSL arredondados do nativewind.css), regenere o CSS (pnpm generate) e atualize docs/05-design-system.md (seção "Diretrizes visuais") e o README de packages/ui-tokens com os tokens novos e a receita de uso no web. Não altere apps/web, apps/mobile nem apps/api: o web é a tarefa 2.35; se o mobile precisar de ajuste por causa de um valor que mudou, registre no relatório. Rode pnpm --filter @space-sports/ui-tokens test, typecheck, build e o check do CSS gerado, o typecheck do web e do mobile (para garantir que nada quebrou) e pnpm lint na raiz.
```

### 2.35 · Web: design system e paleta pelo kit
- **Agente:** `web-engineer`
- **Branch:** `feat/web-brand-system`
- **Plano:** `forte`

**Prompt**
```
Em apps/web, faça o design system e a paleta seguirem o kit de marca em todas as telas, nos temas claro e escuro e na variante Super. A especificação é docs/brand/auditoria-web.md (tarefa 2.34, já no main, com capturas em docs/brand/auditoria-web/); a referência visual é docs/brand/kit/ (abra as pranchas 04, 06 e 07 no navegador) e docs/05-design-system.md, seção "Diretrizes visuais"; os tokens estão em packages/ui-tokens (generated/theme.css e super.css). (1) Aplique cada item da auditoria marcado para o web. (2) Componentes de apps/web/src/components/ui (button, badge, chip, input, textarea, select, select-menu, checkbox, switch, tabs, card, table, dialog, alert-dialog, sheet, popover, dropdown-menu, tooltip, sonner, sidebar, alert, skeleton): variantes e estados (hover, ativo, foco, desabilitado, erro) como nas pranchas 06 e 07, só com tokens; troque o scrim provisório de globals.css pelo token novo e use os tokens de chip. (3) Telas: tire toda cor fixa (hex, rgb, classes da paleta padrão do Tailwind, opacidades soltas como black/50) de apps/web/src em favor dos tokens; confira cabeçalhos de página e números de destaque em Space Grotesk com a escala h1–h3, links com o token link, gráficos com chart-1..5. Densidade do painel mantida (botões de 48 só nas páginas públicas). Não mude comportamento nem textos fora do necessário. A revisão da 2.34 achou itens que a tabela "Cores fixas" da auditoria deixou de fora; trate-os também: alertas de erro montados à mão com border-destructive/40 (components/painel/states.tsx, painel/aulas/sessoes/sessao-detalhe-view.tsx, painel/aulas/alunos/approve-dialogs.tsx) e border-destructive/50 (components/super/query-states.tsx) passam para o Alert destructive; border-border/40 em painel/agenda/agenda-grid.tsx; cores com dark: em checkbox.tsx (dark:bg-muted, dark:data-[state=checked]:bg-primary), select.tsx (dark:[&>option]:bg-popover) e switch.tsx (dark:data-[state=unchecked]:bg-input/80). O item ativo da sidebar com a cor de ação cheia (sidebar-primary), como a auditoria propõe, está aprovado. (4) Confira: rode o app e tire capturas, nos dois temas, das mesmas telas da auditoria (login, Hoje, Agenda, Aulas, um formulário, um diálogo, Super e a página pública de um espaço) e compare com as da 2.34 e com as pranchas; registre no relatório o que ainda diverge. Atualize os testes que dependem de classes ou textos trocados. Testes unitários, e2e com API simulada, typecheck e pnpm lint na raiz passando. Não altere packages/ui-tokens (se faltar token, registre no relatório final), apps/api nem apps/mobile.
```

## Onda 8 — Fotos ilustrativas no seed de demonstração (2.36, independente da onda 7)

Pedido do usuário (2026-10-29): fotos ilustrativas nos espaços para conferir a vitrine, a página do espaço e o app em dev. Sem R2 no ambiente local, as fotos ficam como links externos do Unsplash. Só no seed de demonstração (dev/staging); o seed de produção continua sem fotos. Plano `forte` por pedido do usuário.

### 2.36 · API: fotos ilustrativas dos parceiros no seed de demonstração
- **Agente:** `api-engineer`
- **Branch:** `feat/demo-seed-photos`
- **Plano:** `forte`

**Prompt**
```
Em apps/api, acrescente fotos ilustrativas dos espaços parceiros ao seed de demonstração (src/db/demo-seed.ts, script pnpm db:seed:demo; leia o README da API, seção "Seed de demonstração", e docs/08-espacos-parceiros.md). Não são fotos reais dos espaços: servem só para dev/staging mostrarem a vitrine, a página do espaço e o app com imagens. (1) Pesquisa: encontre no Unsplash (licença Unsplash, uso livre sem atribuição obrigatória) fotos de quadras de areia e dos três esportes dos parceiros (beach tennis, futevôlei e vôlei de praia): quadras ao ar livre ou cobertas, redes, bolas e raquetes na areia, jogadores em ação sem rosto em primeiro plano identificável. Nada de marcas, logos de terceiros, texto na imagem, crianças em destaque ou cenas que não sejam de esporte na areia. Escolha 3 fotos por parceiro (Astral Beach Sports, Arena Errejota e Duna Sports), sem repetir foto entre espaços, com a primeira (position 0) boa como capa em paisagem. Use a URL direta do CDN (https://images.unsplash.com/photo-...) com parâmetros de tamanho (ex.: ?w=1600&q=80&auto=format&fit=crop) e confirme com uma requisição que cada uma responde 200 com content-type image/*; abra/renderize cada imagem e confira que o conteúdo bate com o critério. (2) Seed: as URLs ficam numa constante do seed de demonstração (ex.: DEMO_PHOTOS por slug), cada uma com comentário do autor e da página da foto no Unsplash. O seed grava em space_photos (url, position, blurhash se o projeto já tiver como calcular sem dependência nova; senão null) só nos parceiros que ainda não têm nenhuma foto: idempotente, não mexe em quem já tem foto (implantação ou upload pelo painel) e não passa pelo R2 (são links externos, não objetos do bucket; confira que nenhum fluxo de remoção/troca de foto do painel tenta apagar no R2 uma URL que não é do bucket; se tentar, trate para ignorar URLs fora do R2_PUBLIC_URL, com teste). Acrescente as fotos ao DemoSeedReport (ex.: photos por slug: 'added' | 'kept'). O seed de produção (src/db/seed.ts) não muda. Continua recusando NODE_ENV=production e sem criar preço, horário, turma nem plano. (3) Documente no README da API (seção do seed de demonstração) que as fotos são ilustrativas, de onde vêm e que o espaço que já tem foto fica com as dele; acrescente em docs/08-espacos-parceiros.md uma nota curta de que as fotos do seed de demonstração não são dos espaços. (4) Testes de integração do seed de demonstração: fotos criadas nos três parceiros com as posições certas, idempotência (rodar duas vezes não duplica), parceiro com foto existente não recebe as ilustrativas, e o seed de produção continua sem fotos. Se o fluxo do painel precisou de ajuste para URLs externas, teste também. (5) Confira de ponta a ponta: rode pnpm db:seed:demo num banco local (docker compose da raiz, já de pé; SEED_DEMO_PASSWORD qualquer). Uma API do main já roda em http://localhost:3333 sobre esse mesmo banco: use-a para as leituras ou suba a sua em outra porta (PORT), sem derrubar a que está rodando. Chame GET /v1/spaces?limit=10 e GET /v1/spaces/<slug> e confirme cover e photos com as URLs; registre no relatório final se o web (apps/web, página pública /espacos/<slug> e o painel Espaço > Fotos) e o app exibem imagens desse domínio sem ajuste (ex.: CSP, next/image, allowlist), sem alterar apps/web nem apps/mobile. Rode build de shared e api, lint, typecheck, pnpm generate:api-client:check e os testes de integração de db e spaces. Não altere apps/web nem apps/mobile.
```

## Onda 9 — Fechamento da revisão da 2.35 (2.37 primeiro; 2.38 depois do merge da 2.37)

Decisões do usuário (2026-10-30), a partir das recomendações da revisão: ícone desabilitado apagado, cabeçalho compacto na tabela do Super, campo desabilitado mais escuro no tema escuro, botões de texto seguem em Mar. Plano `forte` por pedido do usuário. Regras: nada de teste de CSS ou classe no web; o usuário acompanha o web em http://localhost:3000 e a API em :3333 (rodando no repositório principal): não derrube esses processos nem use essas portas.

### 2.37 · Design: tokens do botão de contorno, do campo desabilitado e da aba ativa
- **Agente:** `ui-designer`
- **Branch:** `feat/brand-tokens-outline`
- **Plano:** `forte`

**Prompt**
```
Em packages/ui-tokens, acrescente os tokens que faltam para o web eliminar os últimos ajustes de tema, nos temas claro e escuro e na variante super quando couber (referência: docs/brand/kit/, pranchas 06 e 07; docs/brand/auditoria-web.md). (1) Botão de contorno: hoje o web usa border-foreground bg-card no claro e dark:border-muted-foreground dark:bg-transparent no escuro. Crie tokens para a borda e o fundo (ex.: outline-border e outline-background), com os valores atuais: claro Noite sobre card; escuro #A9BCC6 sobre transparente. Como só o scrim tem alfa hoje e um teste exige isso, use um fundo opaco que dê o mesmo resultado se possível; se o transparente for mesmo necessário, ajuste o teste de forma explícita. Lembre que o botão também aparece sobre superfícies diferentes. (2) Campo desabilitado: no escuro ele fica mais claro que os campos ativos (disabled #1E4152 contra input-background #12313F), o que o destaca mais que um campo ativo. Decisão do usuário: escurecer. Crie um token próprio para o fundo do campo desabilitado (ex.: input-disabled), mais escuro que o campo ativo no escuro e coerente no claro, sem mudar o token disabled, que continua servindo aos botões; o texto (disabled-foreground) precisa manter 3:1 sobre o fundo novo. Marque o valor como derivado na documentação, porque o kit não desenha esse estado. (3) Aba ativa no escuro: bg-card sobre o trilho bg-muted dá só 1,15:1 e fica mais escuro que o trilho. Crie um token ou indique outro existente para a aba ativa, de forma que ela se separe do trilho nos dois temas, sem mudar o claro (branco sobre neutral-100), e registre a escolha. Os nomes dos tokens existentes não mudam. Atualize contrast.test.ts com os pares novos (inclusive os HSL do mobile), regenere o CSS (pnpm generate), atualize docs/05-design-system.md (seção "Diretrizes visuais", receita de componentes) e o README do pacote. Não altere apps/web, apps/mobile nem apps/api. Rode pnpm --filter @space-sports/ui-tokens test, typecheck, build e o check do CSS gerado, o typecheck do web e do mobile e pnpm lint na raiz. Não derrube os processos nas portas 3000 e 3333.
```

### 2.38 · Web: ajustes finais da revisão da 2.35
- **Agente:** `web-engineer`
- **Branch:** `fix/web-brand-system-review`
- **Plano:** `forte`

**Prompt**
```
Em apps/web, feche a revisão da 2.35 (design system pelo kit, já no main; especificação em docs/brand/auditoria-web.md). (1) Tokens novos da 2.37 (já no main, ver docs/05-design-system.md): troque em components/ui/button.tsx o outline para os tokens de borda e fundo, removendo todos os dark: de cor, mantendo hover e desabilitado corretos nos dois temas (a 2.35 teve esse bug: variantes dark: ganhavam de hover: e disabled:); use o token do campo desabilitado na receita fieldClasses de lib/utils.ts; use o token da aba ativa em components/ui/tabs.tsx, com data-[state=active]:bg-tab-active e também data-[state=active]:border-tab-active-border (sem a borda, o escuro perde a separação de 3:1). Inclua disabled:placeholder:text-disabled-foreground na receita do campo. Onde docs/brand/auditoria-web.md divergir (aba ativa em bg-card, campo em disabled:bg-disabled, scrim como único token com alfa), vale docs/05-design-system.md. (2) Decisão do usuário: botão ghost só de ícone desabilitado fica apagado com disabled:opacity-50 no compoundVariants de button.tsx (ex.: "Mover para antes" em fotos-view.tsx). (3) Decisão do usuário: compacte o cabeçalho das tabelas do Super para as células não quebrarem linha em telas de cerca de 1200 px (ex.: "Espaço Exemplo A", "Belo Horizonte - MG"), sem perder o overline do kit no restante do painel. (4) Decisão do usuário: os botões de texto ghost seguem em Mar; não mude. (5) Sugestões da revisão: lib/utils.ts, troque as cópias literais pelas constantes textLink (cerca de 20) e overline (cerca de 11), ou remova as constantes se não fizerem sentido; components/super/stat-card.tsx usa CardLabel; o aviso de lista cortada em hoje-view.tsx ~111 vira Alert warning, como o da Agenda; dados-view.tsx ~89, 92 e 94 sem flex items-start gap-2 e mt-0.5, porque o Alert já posiciona o ícone; sheet.tsx ~73 "Close" vira "Fechar" e sidebar.tsx ~265 "Toggle Sidebar" vira "Alternar menu lateral". (6) Capturas: rode o app e tire capturas, nos dois temas, de login, Hoje, Agenda, Aulas, um formulário, um diálogo, Super e a página pública de um espaço, compare com as pranchas 04, 06 e 07 e com as capturas da 2.34 em docs/brand/auditoria-web/, e grave as finais em docs/brand/auditoria-web/depois/ (PNG comprimidos, mesmos nomes); liste no relatório o que ainda diverge, por tela. Isso inclui conferir de verdade a página pública do espaço e /entrar nos dois temas. Não escreva testes de CSS nem de classe (toHaveClass, toHaveCSS, toHaveStyle, getComputedStyle, className): o visual se confere rodando o app; ajuste só testes de comportamento afetados por texto trocado. Use suas próprias portas: não derrube nem reutilize os processos nas portas 3000 e 3333, que o usuário está acompanhando. Testes unitários, e2e com API simulada, typecheck e pnpm lint na raiz passando. Não altere packages/ui-tokens (se faltar token, registre no relatório), apps/api nem apps/mobile.
```

**Verificação final da Onda 9 no `main` (2026-10-30, `ef7ac58`):** tudo passou. `next build` do web; e2e real 19 (agenda 9 + aulas 10); lint e typecheck; unitários do web 204 e e2e com API simulada 161 no branch da 2.38, logo antes do merge. Conferência visual de `/espacos/astral-beach-sports` (com fotos reais do seed de demonstração) e `/entrar` nos dois temas. Worktrees removidos.

## Prompt de revisão (para todas as tarefas)
- **Agente:** `code-reviewer`, no mesmo worktree da tarefa

```
Revise o branch atual contra o main (git diff main...HEAD). A tarefa está descrita em docs/tarefas/fase-2.md, seção <número>. Verifique se o escopo foi cumprido, se o código ficou dentro das pastas do agente, se lint, typecheck e testes passam (rode-os), e aplique o seu checklist. Liste os achados separando "bloqueia o merge" de "sugestão".
```

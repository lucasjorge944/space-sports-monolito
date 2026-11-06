# Fase 1 — Briefings para o Orca (MVP: Descoberta + Aluguel + Super básico)

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`.

**Plano padrão:** `sonnet`

**Estado do `main`:** fundação da Fase 0 pronta (API NestJS com Better Auth, guards `@SuperOnly()`/`@SpaceRoles()`/`@SpacePermission()`, `GET /v1/me`; schema Drizzle completo em `apps/api/src/db/schema` com `bookings`, `court_occupations` (exclusão), `recurring_bookings`, `space_settings` etc.; `packages/api-client` gerado pelo orval; web com login e `/painel`/`/super` protegidos; app com login). Regras em `docs/02-requisitos-funcionais.md`; dados dos parceiros só do `docs/08-espacos-parceiros.md` (nunca inventar).

**Regras transversais:** guard de espaço respeita `spaces.status` (suspenso = só leitura, RF-SUPER-03); bloquear conta encerra as sessões; contrato OpenAPI muda só pelo `api-engineer` e o cliente é regenerado (`pnpm generate:api-client`) no mesmo PR; testes cobrem as RN citadas.

## Estado em 2026-10-27 (retomar daqui)

**Onda 1 concluída e no `main` (`dc7355b`, sem remoto/push):** 1.1 (espaços, quadras, busca, fotos, favoritos) e 1.2 (disponibilidade, reservas avulsas, balcão, bloqueios, dividir conta, pagamentos). Ambas revisadas pelo `code-reviewer` (Codex terra); os bloqueios da 1.2 (escrita em espaço suspenso, vazamento de pagamentos entre participantes) e as sugestões da 1.1 (cursor com assinatura dos filtros, validação da foto no HEAD) foram corrigidos. Lint, typecheck, `generate:check` e 243/244 testes de integração passam.

**Pendências antes/junto da Onda 2:**
1. ~~**Teste instável:** `apps/api/test/bookings/bookings.int.test.ts:63` usa `slotIn(27 * 60)` (relógio real + 27h); à noite o slot cai fora do horário de funcionamento e a busca devolve `undefined`. Fixar o horário (slot no meio do dia). Causa provável, não confirmada.~~ **Resolvido:** a grade é por data local e o slot (ou o de 30 min antes) caía em outro dia perto da meia-noite; os testes de `test/bookings` agora congelam `Date` às 12:10 (`useMiddayClock` em `fixtures.ts`).
2. ~~**Rotas inconsistentes:** 1.1 usa `/v1/manage/spaces/:spaceId/...`, 1.2 usa `/v1/spaces/:spaceId/...` nas rotas de gestão. Uniformizar (muda contrato; regenerar api-client) **antes** do web consumir.~~ **Resolvido:** gestão de reservas, bloqueios, pagamentos e `receivables/today` em `/v1/manage/spaces/:spaceId/...`; `/v1/spaces/...` só tem as rotas públicas. Cliente regenerado.
3. **`turbo test` trava** no Jest do mobile (o `jest` direto termina em ~3 s; o aviso de worker "force exited" já existe no `main`). Pode quebrar a CI.
4. Reconstruir `packages/shared` (`pnpm --filter @space-sports/shared build`) após merges, senão o typecheck da API falha por dist desatualizado.
5. Deep link `spacesports://convite/<token>` fixo no código até o domínio (pergunta 9). App precisa da rota `convite/[token]`.
6. Config externa: chaves do Google Maps e do R2 e CORS do bucket R2 para PUT a partir do web.
7. Menores: busca por nome diferencia acento; filtro de disponibilidade por data/hora (RF-SPACE-06) e mapa (RF-SPACE-07) ficam para quando houver agenda no app/web; extrato e CSV (RF-PAY-03) fora da 1.2.  (`schemas.ts` já reexporta os schemas da 1.1.)
8. Web/mobile devem tratar `SPACE_READ_ONLY`, `INVALID_PHOTO_FILE`, `PHOTO_TOO_LARGE` e usar `cancellableUntil` e `myShare` (jogador não recebe mais `payments`).

**Decisões de interpretação da 1.2 a validar com o produto:** bloqueios usam `booking.create`; no-show continua cobrável; concluir/no-show só após o início; organizador entra como participante no primeiro convite (máx. `people_count − 1` convites ativos); balcão com telefone verificado liga ao usuário.

**Onda 1.5 e Onda 2a (API) concluídas e no `main` (2026-10-28, sem push):** 1.7 (rotas de gestão em `/v1/manage/spaces/...`, testes de reserva determinísticos), 1.8 (Jest do mobile encerra), 1.3 mensalista (migração 0006), 1.4 equipe (0007), 1.5 Super (0008) e 1.6 notificações (0009). Revisadas pelo `code-reviewer` (plano `sonnet`); o único bloqueio (1.5: convite do Dono sem checar e-mail verificado) foi corrigido. No `main`: lint, typecheck, `generate:check`, 518/518 testes de integração e 74/74 unitários.

**Pendências da Onda 2a (backlog de ajuste da API):**
- ✅ Resolvidas na tarefa `fix-api-wave2a-backlog`: `GET /v1/me/staff-spaces` (RN-AUTH-04, só leitura: espaços com vínculo, papéis e reservas de hoje no fuso do espaço, sem valores); eventos `recurring.approved|rejected` publicados na aprovação/recusa; `booking.invite_created` publicado no convite direto a usuários (`userIds` em `POST /v1/bookings/:id/invites`, só o convidado aceita/recusa); aceite do convite de equipe exige `emailVerified` (422 `EMAIL_NOT_VERIFIED`); e-mail do convite de equipe em segundo plano e reenvio com intervalo de 60 s (429 `STAFF_INVITE_RESEND_TOO_SOON`); falha de um destinatário não interrompe os demais (cancelamento e lembrete); dispensa `WAIVED` (`POST /v1/manage/spaces/:id/recurring-charges/:chargeId/waive`, permissão nova `charge.waive` = Dono/Admin; não dispensa paga nem com pagamento não estornado); Professor vê o mensalista com `charges` vazio; solicitação PENDING duplicada = 409 `RECURRING_REQUEST_DUPLICATE` (trava advisory, sem migração); `uuidParam` em `common/uuid-param.ts`.
- 1.3 (restante): pausa/encerramento **não** dispensam sozinhos a mensalidade do mês e quadra desativada não trata mensalistas — dependem de decisão do produto (perguntas 13 e 14 em `docs/07`). ✅ Resolvidos em `fix-api-wave2a-leftovers`: jobs com falha parcial falham no fim e o BullMQ repete sem duplicar; retomada usa `bookings.cancelled_by_pause` (migração 0010), não o texto do motivo.
- 1.4 (restante): ✅ resolvido em `fix-api-wave2a-leftovers`: `anonymizeUser` encerra os vínculos (`REMOVED` com `updatedAt`); e-mail do convidado mascarado (`a***@dominio`) na auditoria da equipe e do convite de Dono pelo Super.
- 1.5 (restante): níveis só leitura (enum `sport_level`); `lastAccessAt` aproximado; teste de acesso não enumera todas as rotas `/v1/super`. ✅ Resolvidos em `fix-api-wave2a-leftovers`: exportação CSV auditada (`super.finance.export_csv`); edição do espaço, infraestrutura, horário e configurações pelo Super gravadas na mesma transação da auditoria.
- 1.6 (restante): ✅ resolvido em `fix-api-wave2a-leftovers`: filas separadas (`notifications` com concorrência 10; `notification-schedules` com lembretes e limpeza, concorrência 1); push idempotente por chave em `push_deliveries` (migração 0010) e nada lança depois do envio.
- Decisões do produto (assumidas até resposta): lembrete 120 min antes (`BOOKING_REMINDER_LEAD_MIN`); mensalidade do 1º mês cheia, sem pró-rata (pergunta 10 em `docs/07`); bloqueio/torneio no horário do mensalista só sinaliza a ocorrência.
- Para o web: rota `/convite/[token]`, headers `X-Support-Session`/`X-Support-Mode`, códigos de erro novos (equipe, Super, mensalista, `EMAIL_NOT_VERIFIED` no aceite do convite, `STAFF_INVITE_RESEND_TOO_SOON`, `RECURRING_REQUEST_DUPLICATE`, `CHARGE_NOT_WAIVABLE`/`CHARGE_HAS_PAYMENTS`, `INVITEE_NOT_FOUND`), botão de dispensar mensalidade e `charges` vazio para Professor. Para o mobile: modo gestão via `GET /v1/me/staff-spaces`; `CreateInvitesDto.names` ficou opcional e há `userIds`. Para o mobile: `PUT /v1/me/devices` após o login e `DELETE /v1/me/devices/:id` no logout; rota `convite/[token]`.
- Operação: migrações paralelas colidem (todas nascem como `0006`); ao lançar tarefas com migração em paralelo, atribuir o número no briefing ou serializar. O `git-operator` não aceita Haiku com effort `low` (plano `sonnet` já usa Sonnet).

**Próximos passos:** (a) tarefa pequena `api-engineer`: itens 1 e 2; (b) tarefa de CI para o item 3; (c) escrever os briefings da Onda 2 (1.3 mensalista, 1.4 equipe, 1.5 Super, 1.6 notificações; depois web e mobile) e lançar com `--watch`.

**Lições de operação:** o dispatch sem `--watch` não avisa quando o agente termina (conferir com `orca-ide terminal read --terminal <handle>`); o Orca nomeia os branches com hífen (`feat-api-spaces`); o `git-operator` (Codex) trava em `turbo test` e não resolve conflitos de código — conflitos vão para o `api-engineer` (`git merge main` no worktree dele); a cadeia do plano `equilibrado` cai para o Codex quando o Claude passa de 80% em 5h.

## Onda 1 — API (em paralelo; módulos distintos)

### 1.1 · Espaços, quadras e busca
- **Agente:** `api-engineer`
- **Branch:** `feat/api-spaces`
- **Roadmap:** Backend — Spaces, `space_settings`, Courts, busca geográfica

**Prompt**
```
Implemente em apps/api os módulos de espaços e quadras (RF-SPACE-01..04, 08, 09; RN-SPACE-01/02; RN-AUTH-03).

- Spaces: CRUD do espaço pelo painel (Dono/Admin), endereço -> geocodificação (interface com provider; implementação Google Maps via env, fake em testes), fotos com upload pré-assinado (Cloudflare R2, S3 API; capa + galeria, ordem), amenities, horário de funcionamento, formas de pagamento aceitas.
- space_settings: leitura/edição com validação Zod (múltiplos de 30 min, min<=max, padrões do doc 02 seção 2.1). A matriz de permissões do doc 02 vale para cada rota.
- Courts: CRUD, esportes por quadra (court_sports.max_players <= 20, decisão 18), coberta, capacidade, status ativa/manutenção.
- Busca pública: GET /v1/spaces com raio (PostGIS), esporte, serviço, amenities, nome, paginação por cursor. Só espaços ACTIVE com ao menos uma quadra ativa e preço/hora (RN-SPACE-01). Detalhe público GET /v1/spaces/:slug. Favoritar/desfavoritar e listar favoritos.
- Respeitar spaces.status no guard (suspenso = só leitura).
Fora do escopo: reservas, Super, notificações.
Testes de integração para permissões por papel, busca (raio/filtros/cursor) e validação das settings. Regenere o api-client. Marque o progresso no docs/06-roadmap.md. Relatório final como definido no seu agente.
```

### 1.2 · Disponibilidade e reservas avulsas
- **Agente:** `api-engineer`
- **Branch:** `feat/api-booking`
- **Roadmap:** Backend — disponibilidade, ocupações, booking, dividir conta

**Prompt**
```
Implemente em apps/api disponibilidade e reservas avulsas (RF-BOOK-01..04, 06, 08; RN-BOOK-01..07, 09). Use o schema existente (bookings, booking_participants, court_occupations, court_blocks, payment_records) e o preço proporcional de packages/shared.

- GET de disponibilidade: slots de 30 em 30 min por quadra/data/duração, respeitando funcionamento, min/max de duração, antecedência mínima e janela (fuso America/Sao_Paulo; datas em UTC no banco).
- Criar reserva: confirmada na hora (CONFIRMED), em transação que insere a court_occupation; a constraint de exclusão do banco é a garantia (conflito -> 409 com código estável). Valida nº de pessoas <= capacidade (RN-BOOK-04).
- Cancelar pelo jogador respeitando cancellation_deadline_min (RN-BOOK-05); gestão cancela a qualquer momento. Libera a ocupação.
- Reserva de balcão (cliente com ou sem app: nome + telefone), bloqueios manuais (court_blocks), concluir, no-show.
- Dividir conta: convites por link/deep link, aceite, parte de cada um (RN-BOOK-09, diferença com o organizador), registro de pagamento por participante; payment_status PENDING/PARTIALLY_PAID/PAID.
- PaymentRecords: registrar/estornar (Dono/Admin/Recepção), auditoria em audit_logs, "a receber hoje".
- Listagens: minhas reservas (próximas/passadas) e reservas do espaço com filtros.
Fora do escopo: mensalista, notificações, Super.
Testes obrigatórios: concorrência (dois usuários no mesmo slot, só um confirma), prazo de cancelamento, disponibilidade, divisão de conta, permissões por papel. Regenere o api-client. Marque o roadmap. Relatório final como definido no seu agente.
```

## Onda 1.5 — Pendências antes da Onda 2

### 1.7 · Estabilizar testes e uniformizar rotas de gestão
- **Agente:** `api-engineer`
- **Branch:** `fix/api-routes-and-flaky-test`
- **Roadmap:** Backend — pendências da Onda 1 (itens 1, 2 e 4 do estado)

**Prompt**
```
Duas correções em apps/api (contrato muda: regenere o cliente).
1) Teste instável: apps/api/test/bookings/bookings.int.test.ts usa slotIn(27 * 60) (relógio real + 27h); à noite o slot cai fora do horário de funcionamento e a busca devolve undefined. Torne os testes determinísticos (slot no meio do dia, sem depender da hora real) em todo o diretório test/bookings.
2) Rotas inconsistentes: o módulo de espaços usa /v1/manage/spaces/:spaceId/..., o de reservas usa /v1/spaces/:spaceId/... nas rotas de gestão. Uniformize todas as rotas de GESTÃO sob /v1/manage/spaces/:spaceId/... (reservas, bloqueios, pagamentos, "a receber hoje"). Mantenha em /v1/spaces/... só as rotas públicas (busca, detalhe, disponibilidade). Atualize testes, rode pnpm generate:api-client e pnpm generate:check, e reexporte em packages/api-client/src/schemas.ts os schemas da 1.1.
Antes de testar, rode pnpm --filter @space-sports/shared build. Lint, typecheck e todos os testes de integração devem passar. Não altere apps/web nem apps/mobile.
```

### 1.8 · CI: `turbo test` travando no Jest do mobile
- **Agente:** `mobile-engineer`
- **Branch:** `fix/mobile-jest-hang`

**Prompt**
```
`pnpm turbo test` trava no Jest de apps/mobile (o `jest` direto termina em ~3 s; há aviso de worker "force exited"). Investigue a causa (handles abertos, watch mode, workers) e corrija em apps/mobile e na config do turbo/CI, sem alterar código de produção além do necessário. Critério: `pnpm turbo test` termina sozinho, também com CI=1. Não altere apps/api.
```

## Onda 2 — depois do merge da Onda 1

Ordem prevista (briefings detalhados são escritos quando a Onda 1 entrar no `main`):
- **2a (API):** 1.3 mensalista (solicitação, aprovação, jobs semanais/mensais), 1.4 equipe (convites, papéis múltiplos), 1.5 Super (CRUD de espaços, suspender, convite do Dono, checklist, catálogos, usuários, modo suporte, financeiro), 1.6 notificações (push Expo + e-mail).
- **2b (web, em paralelo com 2a quando o contrato estiver no `main`):** painel do espaço (dados/fotos/quadras/settings, agenda, reservas, recebimentos, equipe, página pública) e painel Super.
- **2c (mobile):** vitrine/filtros/mapa, página do espaço, fluxo de reserva, dividir conta e deep link, minhas reservas, favoritos/perfil, visão de equipe.
- **Qualidade:** testes de regras, E2E (Maestro/Playwright), implantação assistida e beta.

## Onda 2a — API (lançar só depois do merge da 1.7; módulos distintos, em paralelo)

Todas: rotas de gestão em `/v1/manage/spaces/:spaceId/...`, auditoria em ações sensíveis, `spaces.status` respeitado (suspenso = só leitura), testes de integração das RN citadas, `pnpm --filter @space-sports/shared build`, `pnpm generate:api-client` e `generate:check` no mesmo PR. Conflitos em `packages/api-client` e `pnpm-lock.yaml`: regenerar no merge.

### 1.3 · Mensalista
- **Agente:** `api-engineer`
- **Branch:** `feat/api-recurring`
- **Roadmap:** Backend — Mensalista; PaymentRecords da mensalidade; Jobs

**Prompt**
```
Implemente em apps/api o módulo de mensalistas (RF-BOOK-05, 07; RN-BOOK-08; RN-PAY-01) usando as tabelas existentes em apps/api/src/db/schema (recurring_bookings etc.; crie migração se faltar algo, p.ex. mensalidades).
- Solicitação pelo jogador (dia da semana + horário + quadra + duração, múltiplos de 30 min, dentro do funcionamento); cadastro direto pela recepção/gestão (nasce ACTIVE).
- Estados: PENDING_APPROVAL → ACTIVE ⇄ PAUSED | ENDED | REJECTED. Aprovar/recusar/pausar/encerrar pela gestão (Dono/Admin/Recepção); jogador acompanha o status e pode encerrar o seu.
- Valor: o valor mensal GERAL do espaço (space_settings.recurring_monthly_price_cents), igual para todos, usando o valor vigente na data de geração.
- Jobs BullMQ: (a) semanal/diário gera as ocorrências (bookings + court_occupations) com 4 semanas de antecedência, idempotente; ocorrência que conflite com bloqueio/torneio/reserva é sinalizada para a gestão (não falha o job); (b) mensal gera a mensalidade com vencimento em recurring_billing_day. Ocorrências não têm cobrança própria.
- Mensalidade: PaymentRecords (registrar/estornar, com auditoria, só Dono/Admin/Recepção); "mensalidades a receber" e atrasadas; incluir no "a receber hoje" existente quando vencer hoje.
- Pausar/encerrar cancela as ocorrências futuras não iniciadas e libera a quadra.
- Aprovação com conflito de horário devolve 409 SLOT_UNAVAILABLE.
Testes: aprovação, conflito, geração idempotente das ocorrências, geração mensal com valor vigente, pausa/encerramento, permissões por papel.
```

### 1.4 · Equipe
- **Agente:** `api-engineer`
- **Branch:** `feat/api-staff`
- **Roadmap:** Backend — Equipe

**Prompt**
```
Implemente em apps/api a gestão de equipe do espaço (RN-AUTH-01/03/04; matriz de permissões em docs/02-requisitos-funcionais.md e em packages/shared).
- Convite por e-mail (RF-NOTIF-02) com token expirável para um papel (Admin/Professor/Recepção; Dono só pelo Super); aceite por usuário logado com o mesmo e-mail ou novo cadastro; reenviar/revogar convite.
- Papéis múltiplos por usuário no mesmo espaço e papéis diferentes em espaços diferentes; listar equipe; alterar papéis; remover membro.
- Regras: Admin não gerencia o Dono nem outros Admins além do que a matriz permite ("exceto Dono"); o último Dono não pode ser removido; remover o vínculo encerra o acesso na hora.
- GET /v1/me deve refletir os vínculos; o e-mail usa a interface de mail existente (apps/api/src/mail).
Testes: convite/aceite/revogação, papéis múltiplos, restrições de Admin e do último Dono, acesso negado após remoção.
```

### 1.5 · Super (plataforma)
- **Agente:** `api-engineer`
- **Branch:** `feat/api-super`
- **Roadmap:** Backend — Super

**Prompt**
```
Implemente em apps/api os endpoints do painel Super sob /v1/super/... com @SuperOnly() (RF-SUPER-01..10; RN-AUTH-02).
- Espaços: listar/buscar/filtrar (status, cidade, esportes); criar (já nasce ACTIVE) + convidar o Dono (reusar o convite da 1.4 se já estiver no main; senão deixe a interface pronta); editar qualquer dado; suspender/reativar/encerrar (suspenso some da vitrine e fica só leitura); checklist de implantação calculado (dados, fotos, quadras, preço, equipe).
- Modo suporte: impersonação auditada (início/fim registrados, escopo limitado ao espaço, sinalizado nas respostas).
- Financeiro consolidado, só leitura sobre payment_records: recebido por espaço/serviço/forma, mensalidades em aberto, CSV.
- Catálogos (esportes, amenities, cidades, níveis) CRUD; usuários (buscar, vínculos, bloquear = encerra sessões, pedidos de exclusão LGPD); usuários Super; métricas de uso por espaço; log de auditoria global paginado.
Nunca invente dados dos espaços parceiros. Testes: acesso negado a não-Super, suspensão x vitrine/escrita, bloqueio encerra sessões, modo suporte auditado, CSV.
```

### 1.6 · Notificações
- **Agente:** `api-engineer`
- **Branch:** `feat/api-notifications`
- **Roadmap:** Backend — Notificações push + e-mail; lembretes

**Prompt**
```
Implemente em apps/api as notificações (RF-NOTIF-01, 02, 04) para os eventos que já existem na API: reserva confirmada/cancelada, mensalista aprovado/recusado (quando 1.3 estiver no main; deixe o ponto de integração), lembrete antes da reserva (job), convite para dividir a conta.
- Tabelas: device_tokens (Expo push token por dispositivo), notifications (central do usuário, lida/não lida) e preferências por tipo (migração Drizzle).
- Endpoints: registrar/remover token, listar/marcar como lida, ler/alterar preferências.
- Envio via Expo Push atrás de uma interface (fake em testes), fila BullMQ com retry; respeitar preferências; limpar tokens inválidos.
- Emissão por eventos de domínio/serviço, sem acoplar os módulos de reserva ao Expo.
Testes: preferências respeitadas, lembrete idempotente, token inválido removido, isolamento entre usuários.
```

## Onda 2b/2c — API (ajustes), web e mobile (lançar em paralelo; o contrato da 2a já está no `main`)

Todas: usar só `packages/api-client` (regenerar só se for a 2.1), tokens de `packages/ui-tokens`, textos em português (BR), dinheiro em centavos formatado em R$, datas em UTC exibidas em `America/Sao_Paulo`, erros da API tratados por código. Suspenso = só leitura na UI. Nunca inventar dados dos espaços parceiros. Lint, typecheck e testes do app devem passar. Marcar os itens concluídos em `docs/06-roadmap.md`. Detalhes de rotas e erros: seção "Pendências da Onda 2a" acima.

### 2.1 · API: ajustes da Onda 2a
- **Agente:** `api-engineer`
- **Branch:** `fix/api-wave2a-backlog`
- **Roadmap:** Backend — pendências da Onda 2a

**Prompt**
```
Em apps/api, resolva o backlog "Pendências da Onda 2a" de docs/tarefas/fase-1.md, nesta prioridade: (1) endpoint de equipe somente leitura para o app (RN-AUTH-04): GET /v1/me/staff-spaces (ou equivalente em /v1/me) com espaços onde o usuário tem vínculo, papéis e reservas de hoje, sem permissões de escrita; (2) emitir os eventos recurring.approved, recurring.rejected e booking.invite_created para o NotificationsService; (3) aceite de convite exige emailVerified; envio de e-mail do convite via sendInBackground e limite de reenvio; (4) 1.6: falha de um destinatário não interrompe os demais; (5) 1.3: dispensa WAIVED de mensalidade, esconder charges do Professor, evitar solicitações PENDING duplicadas, mover uuidParam para common/. Itens restantes do backlog só se sobrar tempo. Teste cada regra. Rode pnpm --filter @space-sports/shared build, pnpm generate:api-client e generate:check. Não altere apps/web nem apps/mobile.
```

### 2.2 · Web: painel do espaço (/painel)
- **Agente:** `web-engineer`
- **Branch:** `feat/web-painel`
- **Roadmap:** Painel do espaço (web)

**Prompt**
```
Implemente em apps/web, sob /painel, o painel do espaço (docs/02-requisitos-funcionais.md; permissões por papel conforme a matriz): seleção de espaço quando houver mais de um; dados, fotos, quadras e configurações; agenda por quadra (dia/semana), reserva de balcão e bloqueios; mensalistas (aprovar/recusar/pausar/encerrar, mensalidades a receber); reservas com filtros e detalhe com participantes e pagamentos (registrar/estornar); recebimentos (a receber hoje, extrato por período/forma, CSV); equipe (convidar Admin/Recepção/Professor, papéis, remover); rota /convite/[token]; página pública do espaço com SEO e "abrir no app". Use as rotas /v1/manage/spaces/:spaceId/... do api-client, shadcn/ui, estados de carregamento/vazio/erro e esconda ações sem permissão. Entregue por etapas com commits separados (agenda e reservas primeiro). Não altere apps/api.
```

### 2.3 · Web: painel Super (/super)
- **Agente:** `web-engineer`
- **Branch:** `feat/web-super`
- **Roadmap:** Painel Super

**Prompt**
```
Implemente em apps/web, sob /super, o painel da plataforma (RF-SUPER-01..10): dashboard simples (espaços, usuários, reservas); espaços (lista com filtros, criação, detalhe, editar, ativar/suspender/encerrar, convidar Dono, checklist de implantação); modo suporte (headers X-Support-Session/X-Support-Mode, faixa visível e sair do modo); financeiro consolidado com CSV; usuários (buscar, vínculos, bloquear, pedidos LGPD) e catálogos. Use as rotas /v1/super do api-client e shadcn/ui; acesso só Super. Não altere apps/api nem o que for de /painel (outra tarefa em paralelo: evite editar componentes compartilhados além de adições).
```

### 2.4 · Mobile: descoberta e reserva
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-discovery-booking`
- **Roadmap:** App do jogador — Onboarding/localização, Vitrine, Página do espaço, Fluxo de reserva, Convidar/dividir conta, Mensalista

**Prompt**
```
Implemente em apps/mobile (Expo Router + NativeWind + React Native Reusables): permissão de localização no onboarding; vitrine (FlashList) com filtros, busca e mapa; página do espaço (galeria, infra, localização, contatos, formas de pagamento, aba Alugar); fluxo de reserva completo com disponibilidade, preço calculado e forma de pagamento no local; convidar jogadores/dividir conta e aceitar convite via deep link (rota convite/[token]); solicitar mensalista e acompanhar o status. Registrar o token push (PUT /v1/me/devices) após o login e removê-lo no logout. Use packages/api-client e ui-tokens; tratar erros por código (SLOT_UNAVAILABLE etc.). Não altere apps/api.
```

### 2.5 · Mobile: minhas reservas, perfil e equipe
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-account-staff`
- **Roadmap:** App do jogador — Minhas reservas, Favoritos/perfil/notificações, Visão de equipe

**Prompt**
```
Implemente em apps/mobile: minhas reservas (próximas/passadas, cancelar dentro do prazo, adicionar ao calendário, como chegar); favoritos; perfil, exclusão de conta e preferências de notificação; central de notificações (lista, lida/não lida); visão de equipe somente leitura (reservas de hoje e informações do espaço para quem tem vínculo, RN-AUTH-04) usando o endpoint da tarefa 2.1 — se ainda não estiver no main, deixe a tela pronta com um adaptador isolado e registre a pendência. Use packages/api-client e ui-tokens. Outra tarefa mobile roda em paralelo (2.4): mantenha as rotas e componentes em arquivos próprios e evite editar o layout raiz além de adições. Não altere apps/api.
```

## Onda 3 — API (pendências finais) e E2E (em paralelo)

### 3.1 · API: extrato de recebimentos e exclusão de conta
- **Agente:** `api-engineer`
- **Branch:** `feat/api-extrato-delete-user`
- **Plano:** `equilibrado`
- **Roadmap:** Painel do espaço — Recebimentos; App — Exclusão de conta

**Prompt**
```
Em apps/api: (1) extrato de recebimentos do espaço em /v1/manage/spaces/:spaceId/... (mesmo padrão e permissões dos recebimentos existentes): filtro por período (from/to, datas em UTC), forma de pagamento e serviço (aluguel/mensalidade), paginação, totais por forma e total geral em centavos, e exportação CSV; (2) exclusão de conta: habilitar user.deleteUser no Better Auth ligado ao anonymizeUser existente (POST /v1/auth/delete-user), encerrando as sessões e respeitando a regra de bloqueio/pendências definida em docs/02-requisitos-funcionais.md (RF/RN de LGPD); se houver ambiguidade de regra, registre em docs/07-perguntas-em-aberto.md em vez de assumir. Teste cada regra. Rode pnpm --filter @space-sports/shared build, pnpm generate:api-client e generate:check. Atualize docs/06-roadmap.md. Não altere apps/web nem apps/mobile.
```

### 3.2 · QA: E2E de reserva (Maestro) e agenda (Playwright)
- **Agente:** `qa-engineer`
- **Branch:** `test/e2e-booking-agenda`
- **Roadmap:** Qualidade e lançamento — E2E

**Prompt**
```
Escreva E2E que verifiquem as RF/RN: (1) Maestro em apps/mobile: login, busca de espaço, reserva com forma de pagamento no local, ver em Minhas reservas e cancelar dentro do prazo; (2) Playwright em apps/web: login no /painel, agenda por quadra, reserva de balcão, bloqueio e conflito de horário (SLOT_UNAVAILABLE). Use o seed de teste; não invente dados de espaços parceiros. Não altere código de produção: se achar bug, reproduza com teste e registre em docs/tarefas/fase-1.md. Marque o item no roadmap só se os testes passarem.
```

**Estado em 2026-10-28 (QA):** Playwright **passou**; Maestro **escrito, não executado**.
- **Web (`apps/web/e2e/real/agenda.spec.ts`, `pnpm --filter @space-sports/web test:e2e:real`):** 9 testes contra a **API real** + Postgres/Redis e o seed de teste (`apps/api/test/e2e-seed/seed.ts`, espaço fictício "Arena E2E", banco `*_e2e`): login, agenda por quadra, reserva de balcão (RN-BOOK-01, R$ 100,00), conflito `SLOT_UNAVAILABLE` 409 (mesmo horário, sobreposição parcial; outra quadra livre — RN-BOOK-03), bloqueio (cria, impede balcão, recusa sobre reserva existente, remover libera — RF-BOOK-06). A suíte com API simulada (`pnpm test:e2e`) segue com 49 passando.
- **Mobile (`apps/mobile/.maestro/`):** fluxo `flows/reserva-no-local.yaml` (login → busca → reserva com pagamento no local → Minhas reservas → cancelar dentro do prazo), escrito a partir dos textos reais das telas. **Não rodou**: o ambiente não tem Maestro, adb nem emulador, e o `app.json` não define `android.package`/`ios.bundleIdentifier` (o `APP_ID` vem do build). Passos em `apps/mobile/.maestro/README.md`. Os seletores são por texto/`accessibilityLabel` (na 5.2 as telas do fluxo ganharam `testID` e o fluxo passou a usar `id:`) e podem precisar de ajuste na primeira execução.
- **Bugs de produção encontrados:** nenhum. Observação de UX (por desenho): clicar num horário já reservado na grade abre a reserva, não o diálogo de balcão; o teste cria o conflito pelo botão "Reserva de balcão".
- **Lacunas:** cancelamento fora do prazo no mobile (precisa de reserva a <60 min do início, que o seed não cria); concorrência real de dois clientes simultâneos fica a cargo de `apps/api/test/bookings/`; ~~job de e2e real do web na CI~~ (adicionado, ver abaixo).

**CI do e2e real do web (2026-10-28, QA):** job `web-e2e-real` em `.github/workflows/ci.yml` (Postgres PostGIS `space_sports_e2e` + Redis como services → build da API e dos pacotes do web → `db:migrate` → Chromium do Playwright → `pnpm --filter @space-sports/web test:e2e:real`, cujo `globalSetup` carrega o seed de teste). Em falha, sobe o artefato `playwright-real-traces` (`test-results/` com traces + `playwright-report/`); para isso `playwright.real.config.ts` passou a gerar também o reporter `html` quando `CI` está definido. Nenhum código de produção alterado.
- **Validado localmente:** `actionlint` (imagem `rhysd/actionlint`) sem erros; YAML válido; mesma sequência de passos do job em Postgres/Redis novos (containers `postgis/postgis:17-3.5` e `redis:7-alpine`): 9/9 passando, também com `CI=1` (sem reaproveitar servidores, reporter `github`+`html`).
- **Não validado sem rodar na CI:**
  - Execução real do job num runner (services, health checks, tempo total dentro do `timeout-minutes: 25`, `next dev` compilando a frio no runner).
  - `playwright install --with-deps chromium` no `ubuntu-latest` (instala pacotes de sistema com apt).
  - Upload do artefato em falha (`if: failure()`): não foi provocada uma falha; confirmar que o artefato aparece e que os caminhos `apps/web/test-results/` e `apps/web/playwright-report/` batem na primeira falha real.
  - Cache do Turborepo e `pnpm install --frozen-lockfile` no runner (idem aos outros jobs).
  - Flakiness: `retries: 0` e um worker; se o runner mais lento causar instabilidade, avaliar `retries: 1` só na CI.
  - O job não é marcado como obrigatório (branch protection); decisão do dono do repositório.

## Onda 4 — Pendências da Onda 3 (em paralelo; pastas distintas)

### 4.1 · Web: extrato de recebimentos
- **Agente:** `web-engineer`
- **Branch:** `feat/web-extrato`
- **Roadmap:** Painel do espaço — Recebimentos

**Prompt**
```
Em apps/web, sob /painel, na área de recebimentos, implemente a tela do extrato usando GET /v1/manage/spaces/:spaceId/statement e statement.csv do packages/api-client (não regenere o cliente): filtros de período (datas exibidas em America/Sao_Paulo, enviadas em UTC com intervalo [from, to)), forma de pagamento e serviço (aluguel/mensalista), lista paginada por cursor, totais e totais por forma em R$ (centavos na API), estornos separados, download do CSV, estados de carregamento/vazio/erro. Hoje a API exige a permissão payment.record (Dono, Admin, Recepção); a pergunta 12 de docs/07 pode mudar isso, então use o helper de permissões existente em um único ponto. Marque o item em docs/06-roadmap.md. Não altere apps/api nem apps/mobile.
```

### 4.2 · Mobile: exclusão de conta com os novos códigos
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-delete-account-codes`
- **Roadmap:** App do jogador — Exclusão de conta

**Prompt**
```
Em apps/mobile, ajuste a tela /excluir-conta para o POST /v1/auth/delete-user real: remova a suposição de que 404 = indisponível; trate por código 409 LAST_OWNER (único Dono de um espaço: orientar a transferir a titularidade), 409 SUPER_ACCOUNT, 403 USER_BLOCKED, 400 SESSION_EXPIRED (pedir a senha e reenviar com password; conta sem senha: orientar a entrar de novo e tentar outra vez) e 400 INVALID_PASSWORD. Após o sucesso, limpe a sessão local e o token push e volte ao login. Textos em português (BR), testes do app passando. Marque o item em docs/06-roadmap.md. Não altere apps/api nem apps/web.
```

### 4.3 · API: endurecimento da exclusão e do extrato
- **Agente:** `api-engineer`
- **Branch:** `fix/api-delete-statement-hardening`

**Prompt**
```
Em apps/api, aplique as sugestões da revisão da 3.1: (1) corrida entre dois Donos excluindo a conta ao mesmo tempo (apps/api/src/users/delete-account.ts e users.service.ts do Super): trave os vínculos de Dono dos espaços envolvidos (SELECT ... FOR UPDATE) ou use pg_advisory_xact_lock por espaço, com teste de concorrência; (2) teste que confirme que a linha de users continua existindo (anonimizada) depois do delete-user; (3) em statement.service.ts troque ::float8 por ::bigint com Number(), e o mesmo em finance.service.ts; (4) no join de bookings do extrato troque o CASE no ON por dois left joins com coalesce. Não mude o contrato OpenAPI. Não altere apps/web nem apps/mobile.
```

## Onda 5 — Backlog da Onda 2a, prontidão do Maestro e E2E na CI (em paralelo; pastas distintas)

### 5.1 · API: backlog da Onda 2a
- **Agente:** `api-engineer`
- **Branch:** `fix/api-wave2a-leftovers`
- **Plano:** `equilibrado`
- **Roadmap:** Backend — Jobs e Notificações

**Prompt**
```
Em apps/api, resolva as pendências "restante" da Onda 2a listadas em docs/tarefas/fase-1.md: (1) 1.6: o worker de notificações roda com concorrência 1 e divide a fila entre lembretes e pushes; separe ou aumente a concorrência sem perder a garantia de um lembrete por reserva; evite push duplicado se o Redis falhar entre send e enqueueReceipts (idempotência ou ordem das operações); (2) 1.4: a anonimização de conta deve encerrar os vínculos em space_members (REMOVED, com updatedAt atualizado) e o e-mail do convidado não deve ficar em texto na auditoria (mascare); (3) 1.3: a retomada do mensalista não deve identificar ocorrências pausadas pelo texto do motivo (use uma coluna/flag dedicada) e jobs com falha parcial devem permitir retry do BullMQ sem duplicar ocorrências/mensalidades; (4) 1.5: audite a exportação CSV do financeiro e a edição do espaço pelo Super dentro de transação. Não implemente regras que dependam de decisão do produto (dispensa automática de mensalidade, quadra desativada tratando mensalistas): registre-as em docs/07-perguntas-em-aberto.md. Migração, se houver, será a próxima numeração livre em apps/api/drizzle. Teste cada regra; rode pnpm --filter @space-sports/shared build, lint, typecheck, generate:check e os testes de integração. Atualize a linha de "Jobs" e "Notificações" em docs/06-roadmap.md para refletir que os eventos de mensalista e de convite já são publicados. Não altere apps/web nem apps/mobile.
```

### 5.2 · Mobile: testID e seletores do Maestro
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-testids-maestro`
- **Plano:** `equilibrado`
- **Roadmap:** Qualidade e lançamento — E2E

**Prompt**
```
Em apps/mobile, adicione testID estáveis nas telas do fluxo de apps/mobile/.maestro/flows/reserva-no-local.yaml (login, busca/lista de espaços, página do espaço, cada passo de espaco/[slug]/reservar, Minhas reservas, reserva/[id] e cancelamento) sem mudar comportamento nem textos. Atualize o fluxo e os subflows para usar id: em vez de texto/accessibilityLabel onde fizer sentido, e atualize apps/mobile/.maestro/README.md. Não defina android.package nem ios.bundleIdentifier no app.json (depende do domínio; decisão do usuário). Não rode o Maestro (o ambiente não tem emulador). Testes do app, lint e typecheck passando. Não altere apps/api nem apps/web.
```

### 5.3 · QA: job de E2E real do web na CI
- **Agente:** `qa-engineer`
- **Branch:** `test/ci-e2e-real`
- **Plano:** `equilibrado`
- **Roadmap:** Qualidade e lançamento — E2E

**Prompt**
```
No workflow do GitHub Actions existente (.github/workflows), adicione um job que rode a suíte Playwright real do web (pnpm --filter @space-sports/web test:e2e:real) com serviços Postgres (PostGIS) e Redis, aplicando migrações e o seed de teste de apps/api/test/e2e-seed, usando o mesmo setup do ambiente local descrito em apps/web/e2e/real. Faça upload do relatório/traces em caso de falha. Valide o YAML localmente (actionlint se disponível) e rode a suíte local para confirmar que continua passando. Não altere código de produção. Registre em docs/tarefas/fase-1.md o que não pôde ser validado sem rodar na CI.
```

## Onda 6 — Decisões de 2026-10-28 sobre mensalista e exclusão de conta (`docs/07`, decisões 27 a 30)

### 6.1 · API: mensalista sem cobrança e exclusão de conta que cancela
- **Agente:** `api-engineer`
- **Branch:** `feat/api-recurring-no-billing`
- **Plano:** `equilibrado`
- **Roadmap:** Backend — Jobs; App — Exclusão de conta

**Prompt**
```
Em apps/api, aplique as decisões 27 a 30 de docs/07-perguntas-em-aberto.md (regras já reescritas em docs/02: RF-BOOK-05, RN-BOOK-08, RF-AUTH-03).

(1) Mensalista sem cobrança: o mensalista só ocupa horário na agenda. Remova a geração de mensalidades (job generate-charges), o endpoint POST /v1/manage/spaces/:id/recurring-charges/:chargeId/waive, a permissão charge.waive, `charges` nas respostas do mensalista, os eventos e lembretes ligados a cobrança do mensalista, e os campos recurring_monthly_price_cents e recurring_billing_day das space_settings (API, Zod em packages/shared e seed). Mantenha as tabelas e dados de recurring_charges e payments já existentes (migração só se for preciso soltar colunas obrigatórias; não apague dados), e mantenha no extrato de recebimentos os pagamentos antigos de mensalidade. Pausar/encerrar só cancela as ocorrências futuras (já é assim); retomada continua usando bookings.cancelled_by_pause. A geração de ocorrências não depende mais de preço mensal configurado: ajuste a aprovação e as validações que exigiam esse valor. Não trate quadra desativada com mensalistas.
(2) Exclusão de conta (POST /v1/auth/delete-user, delete-account.ts): dentro da mesma transação da anonimização, cancele as reservas futuras do usuário (status CANCELLED, motivo e auditoria; ignore a regra de prazo de cancelamento; notifique o espaço/participantes só se já houver evento para isso, sem criar push novo) e encerre os mensalistas ativos/pausados/pendentes (cancelando as ocorrências futuras). Não bloqueie por valores em aberto. Mantenha as travas atuais (único Dono, conta Super, conta bloqueada).
Teste cada regra, inclusive que reservas passadas e pagamentos já registrados ficam intactos. Rode pnpm --filter @space-sports/shared build, lint, typecheck, pnpm generate:api-client e generate:check, e os testes de integração. A numeração da migração é a próxima livre em apps/api/drizzle. Atualize docs/06-roadmap.md (linhas de Jobs e exclusão de conta) e liste em docs/tarefas/fase-1.md, na seção desta onda, o que web e mobile precisam remover (campos/telas de valor mensal, vencimento, mensalidades e dispensa). Não altere apps/web nem apps/mobile.
```

**Resultado (6.1, API):** RF-BOOK-05, RN-BOOK-08 e RF-AUTH-03 aplicados; sem migração (as colunas de `space_settings` já eram nulas e ficam sem uso). Contrato alterado (`openapi.json` e `packages/api-client` regenerados):
- Removidos: `GET /v1/manage/spaces/:id/recurring-charges` (`listRecurringCharges`), `POST …/recurring-charges/:chargeId/waive` (`waiveRecurringCharge`), permissão `charge.waive`, schemas `RecurringChargeDto`, `RecurringChargePageDto`, `ChargeStatus`, `RecurringChargeReceivableDto`, `ListRecurringChargesParams`, `FinanceSummaryOpenMonthlyFees*`.
- `RecurringBookingDto`/`RecurringBookingDetailDto`: sem `monthlyPriceCents` e sem `charges`.
- `SpaceSettings`/`UpdateSpaceSettingsInput`: sem `recurringMonthlyPriceCents` e `recurringBillingDay` (o PATCH é estrito: mandar esses campos agora dá 400 `VALIDATION_ERROR`).
- `ReceivablesTodayDto`: sem `recurringCharges`; `totalDueCents` soma só as reservas.
- `RecordPaymentDto.payableType` passa a ser `RecordablePayableType` (`BOOKING` | `BOOKING_PARTICIPANT`); `RECURRING_BOOKING_CHARGE` continua em `BookingPayableType` (saída: extrato e pagamentos antigos, que ainda podem ser estornados).
- `FinanceSummary` (Super): sem `openMonthlyFees`.
- Erros que deixaram de existir: `RECURRING_PRICE_NOT_SET`, `RECURRING_CHARGE_NOT_FOUND`, `CHARGE_NOT_WAIVABLE`, `CHARGE_HAS_PAYMENTS`, `CHARGE_NOT_PAYABLE`.
- Exclusão de conta: `POST /v1/auth/delete-user` mantém a resposta; agora cancela reservas futuras e encerra mensalistas (ver roadmap).

**O que web precisa remover (`apps/web`, quebra o typecheck hoje):**
- `components/painel/mensalistas/charges-table.tsx` (tela/aba de mensalidades) e o uso dela; `recurring-detail-sheet.tsx` (bloco de valor mensal e lista de mensalidades com dispensa); `mensalistas-view.tsx` (coluna/valor `monthlyPriceCents`); `recurring-desk-dialog.tsx` (aviso/checagem de valor mensal configurado).
- `components/painel/espaco/configuracoes-view.tsx` e `lib/painel/settings-form.ts` (+ teste): campos "valor mensal do mensalista" e "dia de vencimento" (não enviar mais no PATCH).
- `components/painel/recebimentos/recebimentos-view.tsx`: bloco de mensalidades que vencem hoje (`recurringCharges`) e a soma no total.
- `components/painel/payment-dialog.tsx`: usar `RecordablePayableType` (sem pagamento de mensalidade).
- `components/super/finance/finance-view.tsx`: card/tabela "mensalidades em aberto" (`openMonthlyFees`).
- `lib/painel/labels.ts` (rótulos de `ChargeStatus`) e `lib/painel/errors.ts` (mensagens de `RECURRING_PRICE_NOT_SET` e `CHARGE_NOT_PAYABLE`). Não mexer no item "Mensalidades" de `components/shell/nav.ts`: é das aulas (`/painel/aulas/mensalidades`). O extrato (`lib/painel/statement.ts`) continua mostrando o serviço `RECURRING` para pagamentos antigos.

**O que mobile precisa remover (`apps/mobile`, quebra o typecheck hoje):**
- `app/mensalistas/[id].tsx`: valor mensal (`monthlyPriceCents`) e a lista de mensalidades/"o que devo" (`charges`).
- `features/recurring/labels.ts`: rótulos de `ChargeStatus`.
- `app/espaco/[slug]/mensalista.tsx`: o texto "aprovado, cobra o valor mensal" (o pagamento é direto no espaço) e o tratamento de `RECURRING_PRICE_NOT_SET`, se houver.
- Opcional: avisar na tela de exclusão de conta que reservas futuras e mensalistas serão cancelados.

### 6.2 · Web: remover mensalidade do mensalista
- **Agente:** `web-engineer`
- **Branch:** `feat/web-recurring-no-billing`
- **Plano:** `equilibrado`
- **Roadmap:** Painel do espaço — Mensalistas, Recebimentos, Configurações

**Prompt**
```
Em apps/web, o contrato da API mudou (6.1 já está no main; regenere nada, o packages/api-client já está atualizado). Aplique a lista "O que web precisa remover" da seção 6.1 de docs/tarefas/fase-1.md: mensalidades, valor mensal, dia de vencimento, dispensa, mensalidades em aberto do Super, rótulos e erros que não existem mais. Não mexa no item "Mensalidades" de nav.ts (é das aulas). Ajuste os testes unitários e e2e afetados. Atualize a linha 88 de docs/06-roadmap.md (painel de mensalistas) para refletir que não há mais mensalidades. Typecheck, lint e testes do web passando. Não altere apps/api nem apps/mobile.
```

### 6.3 · Mobile: remover mensalidade do mensalista
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-recurring-no-billing`
- **Plano:** `equilibrado`
- **Roadmap:** App — Mensalista

**Prompt**
```
Em apps/mobile, o contrato da API mudou (6.1 já está no main; o packages/api-client já está atualizado). Aplique a lista "O que mobile precisa remover" da seção 6.1 de docs/tarefas/fase-1.md. Na tela de exclusão de conta, avise que reservas futuras e mensalistas serão cancelados. Ajuste os testes afetados. Typecheck, lint e testes do app passando. Não altere apps/api nem apps/web.
```

### 6.4 · API: ajustes da revisão da 6.1
- **Agente:** `api-engineer`
- **Branch:** `fix/api-recurring-no-billing-followup`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/api, aplique as sugestões da revisão da 6.1: (1) estorno de pagamento antigo RECURRING_BOOKING_CHARGE (bookings/payments.service.ts ~219) deve recalcular o status de recurring_booking_charges; (2) a exclusão de conta atendida pelo Super (super/users.service.ts ~340) deve cancelar reservas futuras e encerrar mensalistas como a exclusão pelo app (reuse releaseFutureSchedule, na mesma transação; publique booking.cancelled depois do commit); (3) corrida com reserva criada durante a exclusão: trave a linha de users (SELECT ... FOR UPDATE) em deleteOwnAccount e confira deleted_at na transação de criação de reserva, com teste; (4) publique os booking.cancelled sem bloquear a resposta do delete-user, sem perder erros no log; (5) reescreva em docs/06-roadmap.md as linhas 66 e 67 (Mensalista e PaymentRecords) sem mensalidade/recurring-charges; (6) remova "e mensalidades" do comentário de JOBS_ENABLED em config/env.ts. Não mude o contrato OpenAPI. Não altere apps/web nem apps/mobile.
```

### 6.5 · API: inativar conta no lugar de excluir
- **Agente:** `api-engineer`
- **Branch:** `feat/api-deactivate-account`
- **Plano:** `equilibrado`
- **Roadmap:** App — Conta

**Prompt**
```
Em apps/api, aplique a decisão 29 revisada de docs/07-perguntas-em-aberto.md (RF-AUTH-03 em docs/02): o app só INATIVA a conta. (1) Adicione o valor INACTIVE ao enum user_status (migração com a próxima numeração livre em apps/api/drizzle; trate INACTIVE como BLOCKED nos guards, no login e nas sessões, mas com mensagem/código de erro próprios, ex.: ACCOUNT_INACTIVE). (2) Novo POST /v1/me/deactivate (ou equivalente no padrão do projeto): encerra todas as sessões e marca a conta INACTIVE, sem anonimizar e sem cancelar reservas, mensalistas ou pagamentos; sem trava por valores em aberto, mas mantenha a trava de único Dono de espaço e de conta Super. Auditoria. (3) Desligue POST /v1/auth/delete-user para o app e remova dele o cancelamento de reservas/mensalistas e a trava de reserva em exclusão que a 6.1/6.4 criaram; mantenha anonymizeUser e o atendimento LGPD pelo Super (/v1/super/users/...) como estavam antes da 6.1, ou seja, o Super volta a só anonimizar (a exclusão definitiva será uma feature futura); mantenha releaseFutureSchedule apenas se ainda tiver uso, senão remova. (4) O Super pode reativar uma conta INACTIVE (reuse o fluxo de desbloqueio, com auditoria) e vê o status no detalhe/lista de usuários. Teste cada regra. Rode pnpm --filter @space-sports/shared build, lint, typecheck, pnpm generate:api-client e generate:check e os testes de integração; reconstrua apps/api (pnpm --filter @space-sports/api build). Atualize docs/06-roadmap.md e liste em docs/tarefas/fase-1.md, nesta seção, o que web (status INACTIVE no Super) e mobile (tela de excluir conta vira inativar, tratamento de ACCOUNT_INACTIVE no login) precisam mudar. Não altere apps/web nem apps/mobile.
```

**Entregue pela API (contrato para web e mobile)**
- `POST /v1/me/deactivate` (operationId `deactivateMe`, 204 sem corpo): marca a conta `INACTIVE` e encerra todas as sessões (inclusive a atual). Erros: 409 `LAST_OWNER` (único Dono com conta ativa de um espaço), 409 `SUPER_ACCOUNT`, 401/403 de sempre. Nada é apagado nem cancelado.
- Conta inativa: o login (e-mail, telefone, Google/Apple) responde 403 `ACCOUNT_INACTIVE` (mensagem: "Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma."); qualquer rota com sessão que sobrar responde 403 `ACCOUNT_INACTIVE`.
- `POST /v1/auth/delete-user` desligado: responde 404 e está `deprecated` no OpenAPI (o hook `deleteUser` segue gerado só para não quebrar o import do app; sai do contrato quando o app migrar).
- `user_status` ganhou `INACTIVE` (`USER_STATUSES`/`userStatusSchema` em `@space-sports/shared`); `SuperUser`, `SuperUserListItem`, `SuperAdmin` e o filtro `status` de `GET /v1/super/users` aceitam `INACTIVE`.
- `POST /v1/super/users/:id/unblock` também reativa a conta `INACTIVE` (auditoria `super.user.reactivate`, `diff.from`). Promover a Super uma conta inativa → 409 `USER_IS_INACTIVE`.
- Atender pedido LGPD pelo Super voltou a só anonimizar (não cancela reservas nem mensalistas).

**O que o web precisa mudar (`apps/web`, Super)**
- O `pnpm typecheck` do web quebra com o cliente regenerado: `super-admins.tsx:104`, `user-detail.tsx:98` e `users-table.tsx:129` passam o status para um componente tipado como `'ACTIVE' | 'BLOCKED'`; aceitar `UserStatus` com `INACTIVE` (rótulo "Inativa", tom neutro, diferente de "Bloqueada").
- Filtro de status da lista de usuários com a opção "Inativa" (`status=INACTIVE`).
- Detalhe do usuário: com `status = INACTIVE`, mostrar o botão "Reativar conta" (chama `superUnblockUser`) no lugar de "Desbloquear", com texto explicando que o titular inativou pelo app; "Bloquear" continua disponível.
- Tratar 409 `USER_IS_INACTIVE` ao promover a Super ("Reative a conta antes de promovê-la").
- Login do painel: mensagem em PT-BR para 403 `ACCOUNT_INACTIVE`.

**O que o mobile precisa mudar (`apps/mobile`)**
- `features/account/delete-account.ts` (e teste): trocar `deleteUser` por `deactivateMe` (sem senha; não há mais `SESSION_EXPIRED`/`INVALID_PASSWORD`). No 204, remover o token push e a sessão local e voltar ao login, como hoje.
- Tela `/excluir-conta` vira "Inativar conta": textos dizendo que a conta fica inativa, que reservas e mensalistas **não** são cancelados (o espaço trata) e que só o suporte/espaço reativa; tirar o aviso de cancelamento de reservas da 6.3. Tratar 409 `LAST_OWNER` (como hoje) e 409 `SUPER_ACCOUNT`. Avaliar renomear a rota/arquivos e o item do Perfil.
- Login (e-mail, telefone, social) e respostas 403 das rotas autenticadas: mensagem própria para `ACCOUNT_INACTIVE` (diferente de `USER_BLOCKED`), sem oferecer nova tentativa; sessão local deve ser descartada.
- Lembrete (decisão 29): Apple e Google exigem exclusão dentro do app; resolver antes da publicação nas lojas (pergunta 10).

### 6.6 · Web: conta inativa no Super
- **Agente:** `web-engineer`
- **Branch:** `feat/web-inactive-account`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web, aplique a lista "O que o web precisa mudar" da seção 6.5 de docs/tarefas/fase-1.md (status INACTIVE no Super, filtro, botão Reativar conta, 409 USER_IS_INACTIVE e mensagem de ACCOUNT_INACTIVE no login). O packages/api-client já está atualizado no main. Typecheck, lint (pnpm lint na raiz) e testes do web, inclusive o e2e com API simulada, passando; atualize os mocks e2e. Não altere apps/api nem apps/mobile.
```

### 6.7 · Mobile: inativar conta
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-deactivate-account`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/mobile, aplique a lista "O que o mobile precisa mudar" da seção 6.5 de docs/tarefas/fase-1.md (deactivateMe no lugar de deleteUser, tela vira "Inativar conta", ACCOUNT_INACTIVE no login e nas rotas autenticadas). O packages/api-client já está atualizado no main (rode o build dos pacotes se o typecheck reclamar de dist). Atualize os testes e adicione teste da ação de inativar. Typecheck, lint (pnpm lint na raiz) e testes do app passando. Não altere apps/api nem apps/web.
```

## Prompt de revisão (para todas as tarefas)
- **Agente:** `code-reviewer`, no mesmo worktree da tarefa

```
Revise o branch atual contra o main (git diff main...HEAD). A tarefa está descrita em docs/tarefas/fase-1.md, seção <número>. Verifique se o escopo foi cumprido, se o código ficou dentro das pastas do agente, se lint, typecheck e testes passam (rode-os), e aplique o seu checklist. Liste os achados separando "bloqueia o merge" de "sugestão".
```

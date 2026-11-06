# Pagamentos 1 — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Checklist em `docs/06-roadmap.md`, seção "Pagamento online, carteira e taxa". Decisões 80 a 92 de `docs/07-perguntas-em-aberto.md`, especificação em `docs/13-pagamentos-online.md`, requisitos RF-ONPAY e RN-ONPAY (seção 11) de `docs/02-requisitos-funcionais.md` e tabelas propostas em `docs/04-modelo-de-dados.md`, seção "Pagamento online" (leia todos antes de começar).

**Plano padrão:** `forte`

**Ordem:** Onda 1 (PG.1 e PG.2 em paralelo) → merge, `openapi.json` e lockfile regenerados → Onda 2 (PG.3 e PG.4 em paralelo) → Onda 3 (PG.5) → revisão de cada tarefa → deploy no staging e conferência no emulador.

**Resumo do que entra:**
- Pagamento online de **reservas** e **mensalidades de aulas** por **Pix** e **cartão de crédito à vista**, com **split**: o espaço recebe na subconta dele e a plataforma fica com a **taxa de serviço, paga pelo espaço** (padrão Pix 4%, cartão 6%, mínimo R$ 1,00; editável no `/super`, com valor próprio por espaço).
- A plataforma não guarda saldo; **sem saldo pré-pago, crédito ou cashback** para o jogador (decisão 81). Pagar no local continua existindo.
- **Gateway desacoplado** atrás de uma interface, com um único adaptador **fake** (simulado). O provedor real será escolhido depois e não pode exigir mudança fora do adaptador.
- Modos por espaço (`ON_SITE`, `ONLINE_OPTIONAL`, `ONLINE_REQUIRED` só em reservas), cadastro do espaço no gateway (KYC), carteira do espaço (livro-razão, a liberar, repasses), estorno, chargeback, receita da plataforma no Super e simulador para testes.

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz, `docs/13-pagamentos-online.md` e as decisões 80 a 92 antes de começar. Documentação em português (BR); código em inglês.
- Dinheiro sempre em centavos (inteiro), percentuais em pontos-base (inteiro); nada de ponto flutuante em valores. Datas em UTC e exibição em `America/Sao_Paulo`.
- Nenhum dado de cartão passa pela API (só token). Documento e conta bancária só mascarados no banco e nas respostas. Nenhum segredo no repositório.
- Máquina com pouca RAM. Máximo de 2 workers nos testes, SEMPRE explícito na linha de comando (API e web: `--maxWorkers=2`; mobile: `npx jest --maxWorkers=2`), `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados, Playwright com 1 worker e só das specs afetadas. Durante o trabalho, rode só os testes afetados; a suíte completa da sua área, uma vez no final. Não rode `next build` sem necessidade. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333 e 8081; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Contrato OpenAPI muda só em tarefa de API, com o cliente regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo branch. Depois de trazer o `main`, rode `pnpm install` e `pnpm --filter @space-sports/shared build`.
- Migrações: a PG.2 usa `0025`. Ao terminar, traga o `main`; se outra migração entrou antes, regenere a sua com o próximo número livre, para o `_journal` e os snapshots ficarem em cadeia.
- Sem cor fixa nas telas: tudo por `packages/ui-tokens`, nos temas claro e escuro, seguindo o kit `docs/brand/kit/`.
- Web: sem testes de CSS ou classe (`toHaveClass`, `toHaveCSS`, `toHaveStyle`, `getComputedStyle`, `cn()`); teste só comportamento.
- Atualize `docs/02-requisitos-funcionais.md`, `docs/04-modelo-de-dados.md`, `docs/05-design-system.md` e `docs/13-pagamentos-online.md` com o que mudou na implementação. Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português) e com typecheck, `pnpm lint` na raiz e os testes da sua área passando. Relate o que ficou de fora.

## Onda 1 — Especificação e API

### PG.1 · Design: checkout, carteira, configurações e Super
- **Agente:** `ui-designer`
- **Branch:** `feat/payments-design`

**Prompt**
```
Especifique o visual e os fluxos do pagamento online (decisões 80 a 92 de docs/07-perguntas-em-aberto.md; docs/13-pagamentos-online.md; RF-ONPAY e RN-ONPAY da seção 11 de docs/02-requisitos-funcionais.md). Leia o kit docs/brand/kit/ (pranchas 01 a 07, inclusive o dark mode), docs/05-design-system.md, packages/ui-tokens e as telas atuais: app — apps/mobile/src/features/booking/ (fluxo de reserva), src/features/bookings/ (detalhe), src/features/classes/ (Meu plano e mensalidades) e src/app/(tabs) (Perfil); web — apps/web/src/app/painel/recebimentos, painel/reservas, painel/aulas/mensalidades, painel/espaco e super/financeiro. Não implemente as telas: PG.3 (web) e PG.4 (mobile) implementam a partir do seu documento.

Entregue em docs/05-design-system.md (seção nova "Pagamento online"), com medidas, tokens e estados nos temas claro e escuro, e mockups simples (ASCII ou SVG em docs/pagamentos/):
App
(1) Etapa "Pagamento" do fluxo de reserva: opções conforme o modo (no local, Pix, cartão), resumo do valor (sem taxa para o jogador: decisão 82), selo "Ambiente de teste" quando o gateway for fake.
(2) Tela do Pix: QR, copia e cola com feedback de copiado, contagem regressiva (15 min na reserva obrigatória; 24 h na mensalidade), estado aguardando, confirmado (sucesso), vencido e erro; o que acontece ao sair e voltar.
(3) Cartão: formulário (número, nome, validade, CVV) com máscara e validação, estado processando, recusado com nova tentativa, aprovado; nada de salvar cartão.
(4) Reserva "Aguardando pagamento" na lista e no detalhe (prazo, botão pagar), cancelada por falta de pagamento, e o bloco de pagamento no detalhe (pago online, estornado, estorno parcial).
(5) "Pagar agora" na mensalidade de aula.
(6) "Meus pagamentos" no Perfil: lista, filtros simples, detalhe/comprovante, estornos. Deixe claro que não há saldo.
Painel web
(7) Recebimentos online: cadastro no gateway (só Dono) em etapas, com os estados NOT_STARTED, PENDING, APPROVED e REJECTED (motivo, reenviar); modos de pagamento de reservas e de aulas (bloqueados sem cadastro aprovado) com a taxa vigente somente leitura e uma explicação curta de como a taxa funciona.
(8) Carteira: cartões de saldo disponível, a liberar e repassado; gráfico ou lista do a liberar por data (siga a skill de visualização se usar gráfico); lançamentos com filtros e CSV; repasses; chargebacks com prazo e contestação.
(9) Pagamento online no detalhe da reserva e da mensalidade (meio, valor, taxa, líquido, status) e o diálogo de estorno (total/parcial, motivo, efeito na taxa).
Super
(10) Taxas (padrão e por espaço), receita da plataforma (volume, taxa bruta, tarifa do gateway, taxa devolvida, líquido, por espaço/mês/meio, CSV), cadastros no gateway e o simulador de pagamentos (com aviso forte de que só existe no ambiente de teste).
Defina os status (PENDING, PAID, EXPIRED, FAILED, CANCELLED, PARTIALLY_REFUNDED, REFUNDED, CHARGEBACK; cadastro; repasse) com rótulos em português e cores por token (crie tokens que faltarem em packages/ui-tokens, com contraste AA, e gere as saídas como os outros tokens). Textos de interface prontos, curtos e sem jargão financeiro desnecessário.
```

### PG.2 · API: gateway desacoplado, cobranças, carteira, taxas e Super
- **Agente:** `api-engineer`
- **Branch:** `feat/payments-api`

**Prompt**
```
Em apps/api e packages/shared, implemente o pagamento online (decisões 80 a 92 de docs/07-perguntas-em-aberto.md; docs/13-pagamentos-online.md; RF-ONPAY-01 a 12 e RN-ONPAY-01 a 10 da seção 11 de docs/02-requisitos-funcionais.md; tabelas propostas em docs/04-modelo-de-dados.md, seção "Pagamento online", que você pode ajustar documentando). Leia antes src/bookings/ (bookings.service, payments.service, statement.service, space-statement.controller, availability.service e a ocupação da agenda), src/classes/ (subscription-charges.service, subscription-billing.ts, subscriptions.jobs.ts), src/super/ (guards, financeiro, auditoria), src/notifications/, a configuração de filas BullMQ e src/config/env.ts.

(1) Gateway desacoplado: módulo src/payments/ com a interface PaymentGateway (criar/consultar subconta, cobrança Pix, cobrança de cartão por token, estorno total/parcial, consulta de cobrança, verificar e traduzir webhook para eventos internos) e um registro por PAYMENTS_PROVIDER (`fake` | `none`). O domínio só conhece a interface e os eventos internos; nenhum tipo do fake vaza para fora do adaptador. Adaptador fake: estado nas próprias tabelas ou num namespace dele, Pix com copia e cola e QR em SVG gerados localmente, cartões de teste (4111111111111111 aprova; 4000000000000002 recusa; 4000000000000259 aprova e gera chargeback em seguida), aprovação automática da subconta (documento de teste que termina em 0000 é recusado), liberação de saldo Pix D+1 e cartão D+30 (configurável), repasse diário, tarifa simulada configurável (padrão Pix 0,99% e cartão 3,49% + R$ 0,39) e webhooks assinados (HMAC, PAYMENTS_FAKE_WEBHOOK_SECRET) enviados à própria API pela fila. `fake` recusado em production na validação do env; `none` desliga tudo (RN-ONPAY-09). Atualize .env.example, infra/staging/compose.yml (staging usa fake) e docs/09-infra-aws.md.

(2) Schema e migração 0025: tabelas de docs/04 (platform_fee_settings com o padrão da decisão 83, space_payment_settings, merchant_accounts, online_charges, online_refunds, gateway_events, space_ledger_entries, payouts) e as alterações (`PENDING_PAYMENT` em booking_status, `payment_due_at`, motivo `PAYMENT_EXPIRED`, `payment_records.channel`, `online_charge_id`, `recorded_by` nulo). Confira todos os lugares que fazem switch/filtro por booking_status (agenda, disponibilidade, listas, lembretes, contatos, Super, recentes, exclusão de conta) para tratar PENDING_PAYMENT: ocupa a agenda e bloqueia o horário, não dispara lembrete, aparece para o organizador e para a gestão como aguardando pagamento.

(3) Taxa (RN-ONPAY-01): função pura e testada; resolução padrão → espaço; snapshot na cobrança; split calculado (space_net = amount − fee; gateway_cost do lado da plataforma).

(4) Painel: cadastro no gateway (só Dono, RF-ONPAY-01; dados mascarados), modos de pagamento (Dono/Admin, RF-ONPAY-02; só com APPROVED), carteira (RF-ONPAY-07: saldo disponível, a liberar por data, repassado, lançamentos paginados com filtros e CSV, repasses), pagamento online no detalhe da reserva e da mensalidade (RF-ONPAY-08), estorno manual (RN-ONPAY-05) e chargebacks com contestação (RF-ONPAY-09). Use @SpacePermission e o padrão de rotas /v1/manage/spaces/:spaceId/... existentes; o Professor não vê valores.

(5) Jogador: a criação de reserva aceita a forma escolhida (ON_SITE | ONLINE_PIX | ONLINE_CARD + token) conforme o modo (ONLINE_REQUIRED → PENDING_PAYMENT com hold de 15 min; ONLINE_OPTIONAL → CONFIRMED com cobrança); endpoints para criar/consultar a cobrança da reserva (só o organizador) e da mensalidade (só o aluno), com Pix válido por 24 h na mensalidade; uma cobrança aberta por item (RN-ONPAY-03); `GET /v1/me/payments` (Meus pagamentos, paginado) e detalhe/comprovante. O espaço público (`GET /v1/spaces/:slug`) informa os meios disponíveis por serviço, para o app montar a etapa de pagamento.

(6) Ciclo de vida: webhook `POST /v1/webhooks/payments/:provider` (assinatura, `gateway_events` idempotente, processamento na fila, status só avança — RN-ONPAY-07); pagamento confirmado cria payment_record ONLINE pelo mesmo serviço do registro manual (RN-ONPAY-04) e grava SALE e PLATFORM_FEE no livro-razão; job a cada minuto expira holds e cobranças vencidas (PAYMENT_EXPIRED, RN-ONPAY-02); pagamento que chega para reserva já cancelada é estornado; cancelamento dentro do prazo e cancelamento pelo espaço estornam automaticamente (RN-ONPAY-05); chargeback (RN-ONPAY-06); reconciliação periódica; repasses e liberação de saldo pelos eventos do gateway; espaço suspenso cancela as cobranças abertas. Notificações (push e central): pagamento confirmado, Pix vencido, estorno, cadastro aprovado/recusado, chargeback. Tudo auditado (payment.online.*, merchant_account.*, payment_settings.*, super.payment_fee.*).

(7) Super (só papel da plataforma): taxas padrão e por espaço (RF-ONPAY-10), cadastros no gateway por status, receita da plataforma com relatório mensal por espaço e CSV (RF-ONPAY-11), e o simulador (RF-ONPAY-12, rotas só registradas com PAYMENTS_PROVIDER=fake; 404 caso contrário). O financeiro consolidado existente passa a distinguir no local × online.

(8) Seed: dev/demo com um espaço com cadastro APPROVED, modos ativos e algumas cobranças pagas/estornadas para a carteira não ficar vazia; o seed do e2e (apps/api/test/e2e-seed) com o mesmo cenário mínimo. Idempotente; nada de dado inventado dos espaços parceiros reais (docs/08).

Testes de integração (vitest `--maxWorkers=2`): cálculo da taxa (arredondamento, mínimo, teto no valor, por espaço), modos e permissões (Dono/Admin/Professor/jogador/Super/modo suporte), hold e expiração (concorrência: duas pessoas no mesmo horário, pagamento depois do vencimento), webhook duplicado, fora de ordem e com assinatura inválida, uma cobrança aberta por item, estorno automático e manual (total, parcial, acima do saldo), chargeback, livro-razão (saldo, a liberar, repasse), mensalidade paga online saindo de PAST_DUE, provider none, fake recusado em production, simulador ausente sem fake. Atualize o OpenAPI, regenere o api-client e atualize docs/02, docs/04 e docs/13.
```

## Onda 2 — Telas

### PG.3 · Web: recebimentos online, carteira, estorno e Super
- **Agente:** `web-engineer`
- **Branch:** `feat/payments-web`

**Prompt**
```
Antes de tudo: rode `git merge --ff-only main` (o worktree pode ter nascido do origin/main, sem a PG.1 e a PG.2), depois `pnpm install` e `pnpm --filter @space-sports/shared build`. Confira que docs/13-pagamentos-online.md tem as seções 12 e 13 (expectativas da interface e tabela de rotas).
Em apps/web, implemente as telas do pagamento online a partir da especificação da PG.1 (docs/05-design-system.md, seção "Pagamento online", e docs/pagamentos/) e do contrato da PG.2 (api-client gerado; docs/13-pagamentos-online.md; RF-ONPAY e RN-ONPAY de docs/02). Leia antes as telas de painel/recebimentos, painel/reservas (detalhe e PaymentDialog), painel/aulas/mensalidades, painel/espaco (configurações), super/financeiro e super/espacos, e os padrões de permissão do menu.

Painel: (1) "Recebimentos online" (novo item, Dono/Admin): cadastro no gateway em etapas só para o Dono (Admin vê o status), estados e reenvio; modos de pagamento de reservas e aulas, bloqueados sem cadastro aprovado, com a taxa vigente somente leitura. (2) Carteira: saldo disponível, a liberar, repassado, lançamentos com filtros, paginação e CSV, repasses, chargebacks com contestação. (3) Detalhe da reserva e da mensalidade: bloco do pagamento online (meio, valor, taxa, líquido, status, estornos) e diálogo de estorno total/parcial com motivo; reservas PENDING_PAYMENT com rótulo e filtro na lista e na agenda; extrato e "a receber" distinguem no local × online.
Super: (4) Taxas padrão e por espaço (pontos-base exibidos como %, centavos como R$), (5) receita da plataforma com filtros e CSV (siga a skill de visualização se houver gráfico), (6) cadastros no gateway, (7) simulador de pagamentos, só quando a API expõe as rotas (aviso forte de ambiente de teste).
Formatação de dinheiro e data pelos utilitários existentes; erros da API em português. Testes de componente e E2E (Playwright, 1 worker, só as specs novas em apps/web/e2e) cobrindo permissões (Dono x Admin x Professor), cadastro, ativar modo, estorno e Super. Sem testes de CSS. Não altere a API: relate o que faltar no contrato.
Ajustes vindos da revisão da API: o typecheck do web quebra com o contrato novo até você terminar (rótulo de PENDING_PAYMENT em src/lib/painel/labels.ts; recordedBy/recordedByName nulos em pagamento online); "Estornar" aparece por refundableCents, não pelo status (CHARGEBACK com contestação ganha aceita estorno); estornos PENDING aparecem na lista da cobrança; erro 409 ONLINE_CHARGE_ALREADY_PAID no registro manual; no /super, a coluna de taxa recobrada na receita e no relatório (base da nota = bruta − devolvida + recobrada) e o documento completo só no relatório fiscal.
```

### PG.4 · Mobile: pagar reserva e mensalidade, Meus pagamentos
- **Agente:** `mobile-engineer`
- **Branch:** `feat/payments-mobile`

**Prompt**
```
Antes de tudo: rode `git merge --ff-only main` (o worktree pode ter nascido do origin/main, sem a PG.1 e a PG.2), depois `pnpm install` e `pnpm --filter @space-sports/shared build`. Confira que docs/13-pagamentos-online.md tem as seções 12 e 13 (expectativas da interface e tabela de rotas).
Em apps/mobile, implemente o pagamento online do jogador a partir da especificação da PG.1 (docs/05-design-system.md, seção "Pagamento online", e docs/pagamentos/) e do contrato da PG.2 (api-client gerado; docs/13-pagamentos-online.md; RF-ONPAY-03 a 06 e RN-ONPAY de docs/02). Leia antes src/features/booking/ (fluxo de reserva), src/features/bookings/ (lista e detalhe), src/features/classes/ (Meu plano e mensalidades), o Perfil em src/app/(tabs) e src/features/notifications/.

(1) Etapa de pagamento do fluxo de reserva com as opções do modo do espaço (no local, Pix, cartão); ONLINE_REQUIRED leva à tela de pagamento antes de mostrar a reserva confirmada.
(2) Pix: QR (SVG da API), copia e cola (expo-clipboard), contagem regressiva, consulta periódica do status enquanto a tela está em foco e atualização pelo push de pagamento confirmado; estados vencido e erro; voltar à tela retoma a cobrança aberta.
(3) Cartão: formulário com máscara e validação (Luhn, validade, CVV) que gera o token sem enviar dados do cartão à API (no fake, o token de teste definido pela PG.2); recusado permite nova tentativa dentro do prazo.
(4) Reserva "Aguardando pagamento" na lista e no detalhe, com prazo e botão pagar; cancelada por falta de pagamento; bloco de pagamento no detalhe (pago online, estornado).
(5) "Pagar agora" na mensalidade em aberto quando o modo de aulas permite.
(6) "Meus pagamentos" no Perfil com lista paginada, detalhe/comprovante e estornos; nada de saldo.
(7) Selo "Ambiente de teste" quando a API indicar gateway fake. Notificações novas abrem a tela certa.
Testes (`npx jest --maxWorkers=2`, só os afetados e a suíte uma vez no fim): escolha da forma por modo, contagem e expiração do Pix, validação do cartão, retomada da cobrança aberta, estados da reserva, Meus pagamentos. Fluxos Maestro novos em apps/mobile/.maestro (reserva com Pix pago pelo simulador, reserva obrigatória que expira, mensalidade paga com cartão de teste) com testID nos elementos (não execute). Não altere a API: relate o que faltar no contrato.
Ajustes vindos da revisão da API: o typecheck do app quebra com o contrato novo até você terminar (features/booking/labels.ts com PENDING_PAYMENT, features/notifications/labels.ts com os tipos novos, features/classes/test-fixtures.ts com discountCents e openOnlineCharge, features/space/space-screen.test.tsx com onlinePayments e paymentEnvironment); trate 422 BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT e 409 PAYMENT_IN_PROGRESS; no 502 com verification PENDING, consulte a cobrança em vez de criar outra; o prazo do hold pode ser menor que 15 min: use sempre paymentDueAt e serverTime; Idempotency-Key por tentativa; tokenização de cartão pelo contrato do sandbox exposto em paymentEnvironment (packages/shared fake-card.ts).
```

### PG.2b · API: ajustes do contrato pedidos pela Onda 2
- **Agente:** `api-engineer`
- **Branch:** `fix/payments-api-contract`

**Prompt**
```
Antes de tudo: rode `git merge --ff-only main`, `pnpm install` e `pnpm --filter @space-sports/shared build`. Leia docs/13-pagamentos-online.md (seções 12 a 14), as decisões 93 a 98 de docs/07 e a seção 11 de docs/02. Ajustes no contrato do pagamento online pedidos pelo web (PG.3) e pelo app (PG.4), em apps/api e packages/shared, com testes de integração (vitest `--maxWorkers=2`), OpenAPI e api-client regenerados (`pnpm generate:api-client`, `generate:check`):
(1) SpaceSubscriptionCharge.payments (e os pagamentos de mensalidade em todas as respostas da gestão e do aluno) com channel e onlineChargeId, como os da reserva.
(2) Lançamentos da carteira: filtro por meio (PIX/CARD) e total de itens (ou de páginas) na resposta paginada; CSV respeitando os filtros.
(3) Cadastro no gateway: CPF do responsável (obrigatório com CNPJ), guardado como o documento (cifrado, decisão 97; mascarado nas respostas).
(4) Decisão 98: o submit do cadastro é recusado (409, código estável) quando o espaço já tem approvedAt; a troca de conta recusada volta para a conta aprovada anterior (status APPROVED, repasses retomados, pagamento online segue), guarda o motivo da última troca recusada para a tela e avisa os Donos.
(5) SpacePaymentSettings expõe onlineReady (a mesma regra que a API usa para aceitar cobranças) para as telas não reimplementarem a condição.
(6) Estorno manual: amountCents sempre obrigatório (inclusive em "tudo o que falta"); se for maior que o reembolsável atual, 422 com o reembolsável na resposta.
Atualize docs/02, docs/04 e docs/13 (remova da seção 14 o que for resolvido). Commit no branch.
```

### PG.3c · Web: usar o contrato da PG.2b
- **Agente:** `web-engineer`
- **Branch:** `fix/payments-web-contract`

**Prompt**
```
Antes de tudo: rode `git merge --ff-only main`, `pnpm install` e `pnpm --filter @space-sports/shared build`. Em apps/web, use o que a PG.2b acrescentou ao contrato do pagamento online (docs/13-pagamentos-online.md, seções 9, 13 e 14; decisões 97 e 98 de docs/07): (1) diálogo de pagamentos da mensalidade esconde o "Estornar" manual e mostra "Online" quando channel === ONLINE (o código já está preparado; ajuste os mocks); (2) carteira com o filtro "Meio" (Pix/cartão), "Página X de N" pelo total e CSV com os filtros; (3) cadastro com o CPF do responsável (obrigatório com CNPJ, máscara e validação de CPF), mascarado na exibição; (4) modos de pagamento liberados por onlineReady (troque a regra local); (5) troca de conta recusada: aviso com o motivo de lastRejectedPayoutChange, sem refazer o cadastro (decisão 98), e o rótulo da notificação MERCHANT_PAYOUT_CHANGE_REJECTED onde o web lista notificações. Testes de comportamento e E2E das specs afetadas (Playwright 1 worker), sem testes de CSS. Atualize docs/05 e a seção 14 de docs/13. Não altere a API. Commit no branch.
```

## Onda 3 — Qualidade

### PG.5 · QA: pagamento online de ponta a ponta
- **Agente:** `qa-engineer`
- **Branch:** `test/payments`

**Prompt**
```
Antes de tudo: rode `git merge --ff-only main`, `pnpm install` e o build de packages/shared, packages/ui-tokens e packages/api-client. Leia também as decisões 93 a 98 de docs/07 e as seções 12 a 15 de docs/13 (inclui PG.2b, PG.3c e os ajustes da revisão).
Escreva e rode testes que verificam RF-ONPAY-01 a 12 e RN-ONPAY-01 a 10 de docs/02-requisitos-funcionais.md, já implementados no main (tarefas PG.2, PG.2b, PG.3, PG.3c e PG.4 de docs/tarefas/pagamentos-1.md; especificação em docs/13-pagamentos-online.md). Não altere código de produção: relate os bugs com passos para reproduzir.

(1) API (integração, vitest `--maxWorkers=2`): complete o que a PG.2 não cobriu, com foco em dinheiro e concorrência: soma do livro-razão sempre igual a vendas − taxas − estornos + taxas devolvidas − chargebacks − repasses; taxa em todos os limites (valor menor que o mínimo, arredondamento, por espaço); hold disputado por duas reservas; pagamento depois do vencimento estornado; webhook repetido, fora de ordem, com assinatura errada e de provedor desconhecido; estorno parcial seguido de total; chargeback depois de estorno parcial; mensalidade online saindo de PAST_DUE; permissões de todas as rotas novas (Dono, Admin, Professor, jogador, outro espaço, Super, modo suporte); simulador ausente sem fake; troca de conta (decisão 98: recusa volta à conta anterior, dois webhooks de recusa em paralelo, duas trocas seguidas, webhook antes do commit local); IDEMPOTENCY_KEY_REUSED; exclusão de conta com pagamentos online; documento cifrado (decisão 97) nunca exposto fora do relatório fiscal.
(2) Web E2E real (apps/web/e2e/real, Playwright 1 worker, só as specs novas): Dono faz o cadastro, ativa os modos, o simulador paga um Pix, a carteira mostra a venda e a taxa, o Admin estorna e a carteira reflete; Super altera a taxa de um espaço e vê a receita.
(3) Mobile: revise os fluxos Maestro de pagamento em apps/mobile/.maestro (não execute; não há emulador nesta máquina).
Relate a cobertura e as lacunas para a sessão principal.
```

## Prompt de revisão

```
Revise o branch da tarefa <número> de docs/tarefas/pagamentos-1.md contra o main: correção, aderência às decisões 80 a 92 de docs/07-perguntas-em-aberto.md, a docs/13-pagamentos-online.md e às RF/RN de docs/02 (RF-ONPAY, RN-ONPAY), com atenção especial a dinheiro (só inteiros, arredondamento, soma do livro-razão, taxa e líquido consistentes, nenhum caminho que cobre duas vezes ou estorne mais do que foi pago), concorrência (hold de horário, webhooks duplicados ou fora de ordem, idempotência), segurança (assinatura dos webhooks, simulador inacessível sem fake e em produção, nenhum dado de cartão na API, documento e conta mascarados, permissões Dono/Admin/Professor/Super, isolamento entre espaços), gateway realmente desacoplado (nada do fake fora do adaptador), contrato OpenAPI e api-client em sincronia, temas claro/escuro sem cor fixa e testes. Somente leitura: não altere arquivos. Liste os achados por gravidade, com arquivo e linha.
```

## Correções da CI (2026-11-04)

### CI.1 · Mobile: payment-screen.test.tsx estável na CI
- **Agente:** `mobile-engineer`
- **Branch:** `fix/ci-payment-screen-test`

**Prompt**
```
Antes de tudo: `git merge --ff-only main`, `pnpm install` e o build de packages/shared, packages/ui-tokens e packages/api-client. A CI do main (GitHub Actions, run 41905647769, job "Lint, typecheck, unit tests e build") falhou em apps/mobile: src/features/payments/payment-screen.test.tsx estoura 5000 ms no primeiro teste ("Pix (RF-ONPAY-03) › retoma o Pix aberto…") e os seguintes caem em cascata (timeouts e asserções de contagem, ex.: "502 pendente de verificação" com 0 chamadas). Localmente passa; a CI é mais lenta. Descubra por que o primeiro teste é lento (import/render inicial pesado, fake timers com waitFor, QueryClient) e torne o arquivo robusto: sem vazamento entre testes, timers avançados de forma determinística, aquecimento no beforeAll se for custo de import, timeout maior só onde fizer sentido. Rode o arquivo 3 vezes seguidas com `npx jest --maxWorkers=2 src/features/payments/payment-screen.test.tsx` e uma vez com `taskset -c 0 npx jest --runInBand` no arquivo, para simular CPU lenta; depois a suíte do mobile uma vez (`npx jest --maxWorkers=2`). Não mude código de produção sem necessidade. Commit no branch.
```

### CI.2 · API: teste de anúncios "payload trocado" na CI
- **Agente:** `api-engineer`
- **Branch:** `fix/ci-ads-delivery-test`

**Prompt**
```
Antes de tudo: `git merge --ff-only main`, `pnpm install` e o build de packages/shared. A CI do main (run 41905647769, job "Testes de integração/e2e da API") falhou em apps/api/test/ads/delivery-qa.int.test.ts › "RF-ADS-08 / RN-ADS-04: tokens › payload trocado (outra peça) com a assinatura original é descartado, e nada é contado": esperado { accepted: 0 }, veio { accepted: 1 }. O teste passava antes do pagamento online (PG.2 mexeu em apps/api/src/common/json-body.middleware.ts para guardar o corpo bruto). Descubra se é intermitente (rode o arquivo 10 vezes, `--maxWorkers=2`) ou efeito das mudanças, e corrija a causa: no código de produção se for bug (o token adulterado nunca pode ser aceito — RN-ADS-04), ou no teste se for instabilidade (ex.: payload trocado que, por acaso, gera a mesma peça), explicando no commit. Rode test/ads e test/payments. Commit no branch.
```

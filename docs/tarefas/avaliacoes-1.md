# Avaliações 1 — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Checklist em `docs/06-roadmap.md`, seção "Avaliações de espaços". Decisões 99 a 106 de `docs/07-perguntas-em-aberto.md` e requisitos RF-REVIEW-01 a 09 e RN-REVIEW-01 a 07 (seção 12 de `docs/02-requisitos-funcionais.md`): leia os dois antes de começar.

**Plano padrão:** `forte`

**Ordem:** Onda 1 (AV.1 e AV.2 em paralelo) → revisão, merge, `openapi.json` e lockfile regenerados → Onda 2 (AV.3 e AV.4 em paralelo) → Onda 3 (AV.5) → deploy no staging, APK novo e conferência no emulador → Onda 4, acabamento (AV.6a, depois AV.6b e AV.6c em paralelo).

**Resumo do que entra:**
- Só avalia quem usou o espaço: reserva terminada (organizador ou participante aceito, sem cancelamento nem no-show) ou aula com presença, nos últimos 6 meses. A equipe do espaço não avalia o próprio espaço. Uma avaliação por pessoa por espaço, editável (decisão 99).
- Estrelas de 1 a 5, chips de destaque opcionais e comentário de até 500 caracteres (decisão 100).
- Pedido por push cerca de 2 h depois do uso (com limite de frequência), card na reserva ou aula passada, botão na página do espaço e central de notificações (decisão 101).
- Média a partir de 5 avaliações no card da vitrine, no mapa e na página do espaço (app e web, com JSON-LD); abaixo disso, selo "Novo" (decisão 102).
- Publicação na hora, com denúncia e moderação no Super (que oculta só o comentário); resposta pública do Dono ou Admin (decisões 103 e 104).
- Na exclusão da conta, a nota fica anônima e o texto sai (decisão 105). Filtro e ordenação por nota no Explorar ficam fora desta entrega (decisão 106).

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz, a seção 12 de `docs/02-requisitos-funcionais.md` e as decisões 99 a 106 antes de começar. Documentação em português (BR); código em inglês.
- Máquina com pouca RAM. Máximo de 2 workers nos testes, SEMPRE explícito na linha de comando (API e web: `--maxWorkers=2`; mobile: `npx jest --maxWorkers=2`), `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados, Playwright com 1 worker e só das specs afetadas. Durante o trabalho, rode só os testes afetados; a suíte completa da sua área, uma vez no final. Não rode `next build` sem necessidade. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333 e 8081; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Contrato OpenAPI muda só em tarefa de API, com o cliente regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo branch (skill `contrato-api`). Depois de trazer o `main`, rode `pnpm install` e `pnpm --filter @space-sports/shared build`.
- Migrações: a AV.2 usa `0029`. Ao terminar, traga o `main`; se outra migração entrou antes, regenere a sua com o próximo número livre, para o `_journal` e os snapshots ficarem em cadeia.
- Datas em UTC e exibição em `America/Sao_Paulo`. Sem cor fixa nas telas: tudo por `packages/ui-tokens`, nos temas claro e escuro, seguindo o kit `docs/brand/kit/`. Nas telas, confira com a skill `verificar-visual`.
- Web: sem testes de CSS ou classe (`toHaveClass`, `toHaveCSS`, `toHaveStyle`, `getComputedStyle`, `cn()`); teste só comportamento.
- Dados dos espaços parceiros: nunca invente avaliações para espaços reais em seed de staging. Avaliações de demonstração só no seed de dev/e2e, com usuários fictícios.
- Atualize `docs/02-requisitos-funcionais.md`, `docs/04-modelo-de-dados.md` e `docs/05-design-system.md` com o que mudou na implementação. Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português) e com typecheck, `pnpm lint` na raiz e os testes da sua área passando. Relate o que ficou de fora.

## Onda 1 — Especificação e API

### AV.1 · Design: avaliar, resumo, lista, painel e moderação
- **Agente:** `ui-designer`
- **Branch:** `feat/reviews-design`

**Prompt**
```
Especifique o visual das avaliações de espaços (decisões 99 a 106 de docs/07-perguntas-em-aberto.md; RF-REVIEW-01 a 09 e RN-REVIEW-01 a 07, seção 12 de docs/02-requisitos-funcionais.md). Leia o kit docs/brand/kit/ (pranchas 01 a 07, inclusive o dark mode), docs/05-design-system.md (em especial "Explorar e anúncios"), packages/ui-tokens e as telas atuais: apps/mobile/src/features/discovery/space-card.tsx, a página do espaço em apps/mobile/src/app/espaco/[slug], o detalhe da reserva em apps/mobile/src/app/reserva, a página pública do espaço em apps/web/src/app/(public)/espacos e o layout do /painel e do /super. Não implemente as telas: AV.3 (web) e AV.4 (mobile) implementam a partir do seu documento.

Entregue em docs/05-design-system.md (seção nova "Avaliações"), com medidas, tokens, estados e textos, nos temas claro e escuro:
(1) Estrela: ícone (de onde vem: biblioteca de ícones já usada ou SVG novo em packages/ui-tokens), cheia/meia/vazia, tamanhos (selo, resumo, entrada), cor. Se faltar token (cor da estrela nos dois temas, com contraste AA contra o fundo e o card), crie em packages/ui-tokens e gere as saídas como os outros tokens.
(2) Selo no card da vitrine e no callout do mapa: "★ 4,8 (23)" e o selo "Novo" (menos de 5 avaliações); posição sem quebrar o card atual nem o card patrocinado.
(3) Tela de avaliar (app, tela cheia ou sheet: decida e justifique): nome e logo do espaço, 5 estrelas grandes com rótulo por nota ("Péssimo" a "Excelente"), chips que trocam entre positivos (4–5) e negativos (1–3), comentário com contador, enviar, editar e excluir; estados de envio, erro e sucesso. Defina os textos dos chips (catálogo fixo; a AV.2 cria o enum com os mesmos ids): positivos ex. "Quadra boa", "Bom atendimento", "Limpo", "Bom custo-benefício", "Fácil de reservar", "Boa iluminação"; negativos ex. "Quadra ruim", "Atraso", "Sujo", "Caro", "Iluminação ruim", "Atendimento ruim". Ajuste a lista e documente os ids em inglês (ex. `GOOD_COURT`).
(4) Card "Avalie sua experiência" no detalhe da reserva e da aula passadas, com estrelas que gravam com um toque e levam à tela de avaliar para completar.
(5) Bloco "Avaliações" na página do espaço (app e web pública): média grande, total, barras de distribuição 1–5, 3 chips mais citados, 3 comentários recentes, "Ver todas", botão "Avaliar"/"Editar minha avaliação"; estado sem resumo (menos de 5: "Novo · ainda poucas avaliações", com os comentários que houver). Item de avaliação: autor (primeiro nome + inicial, foto ou iniciais, selo "Jogou aqui"/"Aluno"), nota, data relativa, chips, comentário, comentário oculto pela moderação, resposta do espaço (recuada, com o nome do espaço), menu "Denunciar".
(6) Lista "Ver todas" (app e web): filtro por nota, paginação.
(7) Painel /painel/avaliacoes: cards de média, total e tendência de 90 dias, distribuição, chips mais citados, lista com filtros (nota, "sem resposta") e o compositor da resposta; visão só leitura do Professor.
(8) Super: fila de denúncias, ocultar/reexibir com motivo, avaliações por espaço.
(9) Denunciar (app e web): diálogo com os motivos `SPAM`, `OFFENSIVE`, `FALSE_INFO`, `PERSONAL_DATA`, `OTHER` e texto opcional.
(10) "Minhas avaliações" no Perfil do app.
Inclua mockups simples (ASCII ou SVG em docs/avaliacoes/) da tela de avaliar, do bloco da página do espaço e do painel.
```

### AV.2 · API: avaliações, pedidos, respostas e moderação
- **Agente:** `api-engineer`
- **Branch:** `feat/reviews-api`

**Prompt**
```
Em apps/api e packages/shared, implemente as avaliações de espaços (RF-REVIEW-01 a 09 e RN-REVIEW-01 a 07, seção 12 de docs/02-requisitos-funcionais.md; decisões 99 a 106 de docs/07-perguntas-em-aberto.md). Leia antes src/spaces/ (página pública, busca da vitrine e formato do card), src/bookings/ (status, participantes), o módulo de aulas e presenças (attendances, class_sessions), src/notifications/ (DomainEvents, tipos, preferências, filas `notifications` e `notification-schedules`, lembrete de reserva como modelo de job), src/super/ (guards, auditoria, modo suporte, listas paginadas) e o fluxo de exclusão/anonimização da conta (src/users/, deletion-pending.ts e src/super/users.service.ts).

(1) Schema e migração `0029` (documente em docs/04-modelo-de-dados.md):
  - `space_reviews`: space_id, user_id? (nulo depois da anonimização), rating smallint 1–5 (CHECK), tags (array de enum `review_tag`; até 5; os ids vêm da AV.1 em docs/05, seção "Avaliações" — se a AV.1 ainda não estiver no main, use os ids sugeridos no briefing da AV.1 e documente para alinhar), comment? (até 500), author_kind (`PLAYER|STUDENT`, do uso mais recente), comment_hidden_at?, comment_hidden_by?, comment_hidden_reason?, reply? (até 500), reply_by?, replied_at?, reply_updated_at?, created_at, updated_at; UNIQUE parcial (space_id, user_id) onde user_id não é nulo; índice para a lista pública (space_id, created_at desc, id).
  - `space_review_reports`: review_id, reporter_user_id, reporter_space_id? (denúncia da gestão), reason (`SPAM|OFFENSIVE|FALSE_INFO|PERSONAL_DATA|OTHER`), details?, status (`OPEN|RESOLVED|DISMISSED`), resolved_by?, resolved_at?; UNIQUE (review_id, reporter_user_id).
  - `review_prompts`: user_id, space_id, source_type (`BOOKING|CLASS_SESSION`), source_id, sent_at, notification_id?; UNIQUE (user_id, source_type, source_id) para nunca pedir duas vezes pelo mesmo uso.
  - Em `spaces`: `rating_count int not null default 0` e `rating_sum int not null default 0`.
(2) Regras puras em packages/shared (com testes): schemas Zod de criar/editar, catálogo de chips positivos/negativos, `REVIEW_SUMMARY_MIN_COUNT = 5`, cálculo da média (uma casa) e formatação do nome do autor (primeiro nome + inicial).
(3) Jogador (logado), em `/v1/spaces/:spaceId/reviews/...` e `/v1/me/reviews`:
  - `GET /v1/spaces/:spaceId/reviews/eligibility` → { canReview, reason?, myReview? } (para o botão da página e o card da reserva);
  - `PUT /v1/spaces/:spaceId/reviews/me` cria ou edita (RN-REVIEW-01: elegibilidade conferida com a mesma consulta; equipe ativa → 403 `REVIEW_NOT_ALLOWED`; sem uso → 403 `REVIEW_NOT_ELIGIBLE`; espaço fora da vitrine → 404); chips coerentes com a nota (positivos só com 4–5, negativos só com 1–3: 400 `REVIEW_TAGS_MISMATCH`); `DELETE` exclui;
  - `GET /v1/me/reviews` (Minhas avaliações, cursor);
  - `POST /v1/reviews/:reviewId/reports` (denúncia; não denuncia a própria; uma por pessoa).
  Contagem e soma do espaço atualizadas na mesma transação, com a linha do espaço travada (RN-REVIEW-03); usuários bloqueados não contam (ajuste a contagem ao bloquear/desbloquear no Super).
(4) Público (sem login, mesma visibilidade da página do espaço, RN-REVIEW-07): `GET /v1/spaces/:spaceId/reviews/summary` (count, average se count ≥ 5, distribuição, 3 chips mais citados) e `GET /v1/spaces/:spaceId/reviews?rating=&cursor=` (autor formatado, sem id de usuário; comentário nulo quando oculto, com `commentHidden: true`; resposta). Acrescente `rating: { count, average | null }` ao card de `GET /v1/spaces`, de `GET /v1/me/recent-spaces`, do destino `SPACE` dos anúncios e ao detalhe `GET /v1/spaces/:slug` (sem consulta extra por espaço: leia as colunas).
(5) Gestão (`/v1/manage/spaces/:spaceId/reviews/...`, guard por espaço): ver (Dono, Admin, Professor; lista com filtros nota e `unanswered`, resumo com tendência diária/semanal de 90 dias), responder/editar/remover resposta e denunciar (Dono e Admin; modo suporte vale como Dono), auditado (RN-REVIEW-05). Acrescente as permissões à matriz em packages/shared.
(6) Super (`/v1/super/reviews/...`, `@SuperOnly()`): fila de denúncias (cursor, filtro por status), avaliações por espaço, ocultar/reexibir comentário com motivo (resolve as denúncias abertas daquela avaliação), descartar denúncia; auditado (`review.hide`, `review.unhide`, `review.report_dismiss`).
(7) Pedidos (RN-REVIEW-02): job na fila `notification-schedules` (a cada 5 min, ligado por `JOBS_ENABLED`) que pega reservas e aulas elegíveis terminadas entre 24 h e ~2 h atrás (configurável em env, padrão 120 min), e para cada (pessoa, espaço) aplica: ainda não avaliou; sem pedido desse espaço nos últimos 30 dias; menos de 2 pedidos ignorados (pedido sem avaliação criada em até 7 dias); preferência `review.request` ligada. Grava `review_prompts` antes de emitir o evento (idempotente). Notificação com dados para o app abrir a tela de avaliar (`spaceId`, `slug`, `source`).
(8) Notificações: tipos `review.request`, `review.created` (Dono e Admin ativos do espaço) e `review.replied` (autor), com preferências e textos; acrescente ao enum de packages/shared/src/notifications.ts.
(9) LGPD (RN-REVIEW-06): na anonimização da conta, `user_id` vira nulo, comentário, resposta e denúncias da pessoa são apagados, a nota e os chips ficam; a contagem do espaço se mantém. Inclua no teste da exclusão.
(10) Seed de dev/e2e (não no staging dos parceiros reais): avaliações de usuários fictícios para um espaço de demonstração com ≥ 5 (resumo visível) e outro com 2 ("Novo"), com uma resposta e um comentário oculto.
Testes de integração (vitest `--maxWorkers=2`): elegibilidade (reserva terminada x futura, cancelada, no-show, participante aceito x convidado, presença x falta, 6 meses, equipe, espaço suspenso), uma por espaço e edição, chips x nota, média e contagem (criar/editar/excluir/bloquear/anonimizar, concorrência), resumo com < 5, lista pública sem dados internos, permissões da gestão e do Super, denúncia duplicada, moderação mantendo a nota, job de pedidos (2 h, 30 dias, 2 ignorados, preferência desligada, idempotência). Atualize o OpenAPI, regenere o api-client e atualize docs/02 e docs/04.
```

## Onda 2 — Telas

### AV.3 · Web: página pública, painel e moderação
- **Agente:** `web-engineer`
- **Branch:** `feat/reviews-web`

**Prompt**
```
Em apps/web, implemente as avaliações (RF-REVIEW-03 a 07 e RF-REVIEW-09; decisões 99 a 106 de docs/07-perguntas-em-aberto.md). A API está no main (tarefa AV.2 de docs/tarefas/avaliacoes-1.md): leia o OpenAPI regenerado em packages/api-client e os Zod de packages/shared. A especificação visual está em docs/05-design-system.md, seção "Avaliações" (AV.1): siga-a, com shadcn/ui e os tokens de packages/ui-tokens, nos temas claro e escuro, e os padrões das telas atuais.

(1) Página pública do espaço (apps/web/src/app/(public)/espacos): bloco "Avaliações" (resumo com média, distribuição e chips quando count ≥ 5; senão "Novo"; 3 comentários recentes) e "Ver todas" (rota ou sheet, com filtro por nota e paginação). Renderizado no servidor para SEO, com JSON-LD `AggregateRating` (e `Review` das recentes) só quando o resumo é exibido. "Denunciar" para quem está logado.
(2) /painel/avaliacoes (item novo no menu do painel, visível conforme a matriz de permissões): cards de média, total e tendência de 90 dias, distribuição, chips mais citados; lista com filtros por nota e "sem resposta"; responder, editar e remover a resposta (Dono/Admin); denunciar; Professor só lê.
(3) /super: item "Avaliações" com a fila de denúncias (filtro por status), detalhe com a avaliação e as denúncias, ocultar/reexibir comentário com motivo e descartar denúncia; avaliações por espaço (link a partir do detalhe do espaço no Super).
(4) Preferências de notificação, se o web as mostra, com os tipos novos.
(5) Erros da API com mensagens claras (códigos em docs/02, seção 12, e no OpenAPI).
(6) Pontos que vieram das revisões da Onda 1: os mocks da API simulada (apps/web/e2e/mock-*.mjs) precisam ganhar `rating` nos cards e no detalhe do espaço; o jogador não acessa o web logado (vai para /sem-acesso), então na página pública não há "a minha avaliação" nem avaliar: só "Denunciar" se a página enxergar uma sessão (confirme como o proxy e o layout público tratam a sessão e documente; sem sessão visível, esconda o "Denunciar"); notificações sem texto do usuário já vêm da API; a tendência usa os pontos semanais da API, quantos vierem; marca "editada" quando updatedAt > reply.repliedAt; selo "Autor bloqueado · fora da média" no Super (author.blocked/counted); páginas com ?cursor= com noindex e canonical para a primeira.
Testes de comportamento (vitest e Playwright com API simulada, 1 worker, só as specs afetadas): resumo x "Novo", JSON-LD presente só com resumo, filtros e paginação, responder/editar/remover, Professor sem ações, denúncia, ocultar/reexibir no Super. Confira o visual com a skill verificar-visual. Atualize docs/05 se a implementação mudar algo.
```

### AV.4 · Mobile: avaliar, pedidos, resumo e Minhas avaliações
- **Agente:** `mobile-engineer`
- **Branch:** `feat/reviews-mobile`

**Prompt**
```
Em apps/mobile, implemente as avaliações no app do jogador (RF-REVIEW-01 a 04, 08 e 09; decisões 99 a 106 de docs/07-perguntas-em-aberto.md). A API está no main (tarefa AV.2 de docs/tarefas/avaliacoes-1.md): leia o api-client regenerado. A especificação visual está em docs/05-design-system.md, seção "Avaliações" (AV.1): siga-a, com NativeWind, React Native Reusables e os tokens de packages/ui-tokens, nos temas claro e escuro.

(1) Tela de avaliar (rota `espaco/[slug]/avaliar`): estrelas, chips que mudam com a nota, comentário com contador, enviar/editar/excluir; trata `REVIEW_NOT_ELIGIBLE`, `REVIEW_NOT_ALLOWED` e `REVIEW_TAGS_MISMATCH`. Ao salvar, invalida o resumo, a lista, a elegibilidade e Minhas avaliações.
(2) Pedidos: toque no push `review.request` e no item da central abre a tela de avaliar (deep link `spacesports://espacos/<slug>/avaliar` também, deslogado guarda o destino e volta depois do login); card "Avalie sua experiência" no detalhe da reserva passada (reserva/[id]) e da aula passada, com as estrelas gravando com um toque e levando à tela para completar; some quando já avaliou (mostra "Sua avaliação: ★ 4" com editar); botão "Avaliar"/"Editar minha avaliação" na página do espaço conforme `GET .../reviews/eligibility`.
(3) Página do espaço: bloco "Avaliações" (resumo ou "Novo", 3 recentes, "Ver todas") e a lista completa (rota `espaco/[slug]/avaliacoes`, FlashList com cursor e filtro por nota), "Denunciar" com o diálogo de motivos.
(4) Selo "★ 4,8 (23)" ou "Novo" no card da vitrine, no card patrocinado de espaço, nos Espaços recentes (se a especificação pedir) e no callout do mapa, a partir de `rating` do card.
(5) "Minhas avaliações" no Perfil (lista, editar, excluir) e os tipos novos nas preferências de notificação.
(6) `review.created` não se aplica ao jogador; `review.replied` abre a avaliação na lista do espaço.
(7) Pontos que vieram das revisões da Onda 1: os rótulos dos tipos REVIEW_REQUEST, REVIEW_CREATED e REVIEW_REPLIED e o `rating` nos fixtures já estão no main (commit 5236178); na tela de preferências, esconda REVIEW_CREATED de quem não é Dono ou Admin de algum espaço, como já é feito com ONLINE_PAYMENTS_STAFF_TYPES em preferences-screen.tsx; estado só leitura quando `canEdit` é falso com `myReview` (eligibility e cada item de GET /v1/me/reviews); o toque nas estrelas do card da reserva/aula usa `PUT .../reviews/me?createOnly=true` e, com 409 REVIEW_ALREADY_EXISTS, recarrega e mostra "Sua avaliação"; "a minha" na lista vem de comparar com eligibility.myReview.id; "Denúncia enviada" é estado local.
Testes (`npx jest --maxWorkers=2`, só os afetados e a suíte uma vez no fim): chips por nota, envio/edição/exclusão, card da reserva passada (mostra, grava com um toque, some depois), botão conforme a elegibilidade, deep link e push abrindo a tela, selo x "Novo", lista com filtro, denúncia. Fluxos Maestro novos em apps/mobile/.maestro com `testID` (avaliar a partir da reserva passada; ver a lista) — não execute. Atualize docs/05 se a implementação mudar algo.
```

## Onda 3 — Qualidade

### AV.5 · QA: avaliações
- **Agente:** `qa-engineer`
- **Branch:** `test/reviews`

**Prompt**
```
Escreva e rode testes que verificam RF-REVIEW-01 a 09 e RN-REVIEW-01 a 07 (seção 12 de docs/02-requisitos-funcionais.md), já implementados no main (tarefas AV.2 a AV.4 de docs/tarefas/avaliacoes-1.md). Não altere código de produção: relate os bugs com passos para reproduzir.

(1) API (integração, vitest `--maxWorkers=2`): matriz de permissões de todas as rotas de avaliações (anônimo, jogador, autor, Dono, Admin, Professor, Super, modo suporte); elegibilidade em todos os casos de borda (limite de 6 meses, reserva que termina agora, participante convidado sem aceitar, aula cancelada, equipe removida pode avaliar); invariantes de `rating_count`/`rating_sum` contra a soma real depois de sequências de criar/editar/excluir/bloquear/desbloquear/anonimizar; lista pública sem ids nem dados internos; job de pedidos com o relógio controlado (janela de 2 h, 30 dias, 2 ignorados, idempotência, preferência). Complete o que a AV.2 não cobriu.
(2) Web E2E real (apps/web/e2e/real, Playwright 1 worker, só as specs novas): página pública com resumo e JSON-LD; Dono responde no painel e a resposta aparece na página pública; Professor sem ações; Super oculta comentário e a nota continua na média.
(3) Seed do e2e (apps/api/test/e2e-seed): reserva passada elegível sem avaliação para um jogador de teste (fluxo Maestro de avaliar) e avaliações suficientes para o resumo. Mudança só em dado de teste.
(4) Mobile: revise os fluxos Maestro de avaliações em apps/mobile/.maestro (não execute; não há emulador nesta máquina).
Relate a cobertura e as lacunas para a sessão principal.
```

## Onda 4 — Acabamento

Achados das revisões e da AV.5 (roadmap, item AV.6) e decisões 107 e 108.

### AV.6a · API: bug dos pedidos e ajustes de contrato
- **Agente:** `api-engineer`
- **Branch:** `fix/reviews-api-polish`

**Prompt**
```
Em apps/api e packages/shared, faça o acabamento das avaliações (seção 12 de docs/02-requisitos-funcionais.md; decisões 99 a 108 de docs/07-perguntas-em-aberto.md). Tudo já está no main (tarefas AV.2 e AV.5 de docs/tarefas/avaliacoes-1.md). Migração nova com o próximo número livre (provavelmente `0030`).

(1) BUG-AV5-2: em src/notifications/review-requests.service.ts (:114 e :125-137), a subconsulta "foi respondido" nunca é verdadeira para candidatos, então todo pedido com mais de 7 dias conta como ignorado; quem avalia logo depois do 1º pedido, exclui a avaliação e ignora o 2º nunca mais recebe pedidos. Grave `answered_at` em `review_prompts` quando a avaliação é criada até 7 dias depois do pedido daquele (usuário, espaço) e conte como ignorados só os pedidos sem a marca e com mais de 7 dias. Tire o `it.fails` de test/reviews/requests-clock.int.test.ts:230 (o teste tem que passar).
(2) Resumo da gestão (`getManageReviewSummary`): chips mais citados **por grupo**, até 5 positivos e até 5 negativos (com a contagem), em vez de 3 no total; e o agregado do período da tendência (`trend.count` e `trend.average` dos 90 dias, calculados no banco, sem arredondar médias semanais).
(3) Super: resumo próprio por espaço (`superGetSpaceReviewSummary` ou equivalente), que funcione para espaço fora da vitrine e mostre também quantas avaliações estão fora da média (autor bloqueado); e `rating: { count, average }` no detalhe do espaço do Super (superGetSpace).
(4) Descartar denúncia (`superDismissReviewReport`): corpo opcional `{ reason?: string }` (até 500), gravado e auditado.
(5) GET /v1/me/reviews: o espaço de cada item ganha bairro e cidade (os mesmos campos do card da vitrine), para "bairro · cidade" em Minhas avaliações.
(6) Decisões 107 e 108: confirme com teste que o Professor denuncia pela rota pública (sem marca de espaço) e que o espaço responde de novo a avaliação anonimizada; ajuste só se não estiver assim.
Testes de integração (vitest --maxWorkers=2) para cada item, OpenAPI e api-client regenerados (skill contrato-api), docs/02 e docs/04 atualizados. Rode `pnpm typecheck` na RAIZ antes de commitar e, se o contrato quebrar o web ou o mobile, diga no commit e no relato o que quebra (não edite apps/web nem apps/mobile).
```

### AV.6b · Web: acabamento das avaliações
- **Agente:** `web-engineer`
- **Branch:** `fix/reviews-web-polish`

**Prompt**
```
Em apps/web, faça o acabamento das avaliações (seção "Avaliações" e "Implementação no web (AV.3)" de docs/05-design-system.md; seção 12 de docs/02). A AV.6a (API) já está no main local, mas ainda não no remoto: antes de começar, rode `git merge main` (o worktree pode ter saído do origin/main), `pnpm install` e `pnpm --filter @space-sports/shared build`, e leia o api-client regenerado. O typecheck da sua área só fica verde depois dos seus ajustes (a AV.6a mudou o contrato).

(1) Card "Destaques" do painel (components/reviews/panel-parts.tsx): colunas "Elogios" e "Críticas" com até 5 chips cada, vindos dos grupos novos do resumo da gestão; "—" só quando o grupo vem vazio.
(2) "Últimos 90 dias" (avaliacoes-view.tsx e lib/reviews.ts trendTotals): use `trend.count` e `trend.average` da API; apague o cálculo a partir das médias semanais.
(3) Página pública (app/(public)/espacos/[slug]/page.tsx): o cabeçalho usa o mesmo resumo do bloco quando ele existe (space.rating só de reserva), para não divergir por causa dos caches diferentes.
(4) Super: /super/espacos/<id>/avaliacoes usa o resumo próprio do Super (funciona fora da vitrine e mostra quantas estão fora da média); o link "Avaliações" no detalhe do espaço mostra o número (rating do superGetSpace); o diálogo de descartar denúncia ganha o campo de motivo opcional.
(5) Remova de docs/05 ("Implementação no web (AV.3)") as divergências resolvidas.
Testes de comportamento (vitest --maxWorkers=2 e Playwright com API simulada, 1 worker, só as specs afetadas; atualize os mocks em e2e/mock-reviews.mjs). Confira o visual com a skill verificar-visual.
```

### AV.6c · Mobile: acabamento das avaliações
- **Agente:** `mobile-engineer`
- **Branch:** `fix/reviews-mobile-polish`

**Prompt**
```
Em apps/mobile, faça o acabamento das avaliações (seção "Avaliações" e "Implementação no app (AV.4)" de docs/05-design-system.md; seção 12 de docs/02). A AV.6a (API) já está no main local, mas ainda não no remoto: antes de começar, rode `git merge main` (o worktree pode ter saído do origin/main), `pnpm install` e `pnpm --filter @space-sports/shared build`, e leia o api-client regenerado. O typecheck da sua área só fica verde depois dos seus ajustes (a AV.6a mudou o contrato).

(1) iOS: em review-item.tsx:193 e my-reviews-screen.tsx:136, a ação escolhida no menu (BottomSheet/Modal) abre o Alert de excluir ou a ReportSheet no mesmo toque em que o menu fecha, o que no iOS falha sem erro. Dispare a ação depois que o menu fechar (onDismiss do Modal; InteractionManager como reserva) ou troque o conteúdo da própria sheet.
(2) reviews-block.tsx:304: "Ver todas as 1 avaliações" → use reviewsCountLabel(count).
(3) rating-badge.tsx:24: o selo "Novo" respeita o testID recebido (hoje fixa "selo-novo").
(4) Minhas avaliações com ?avaliacao=<id> (push review.replied): role até o item (scrollToIndex, como na lista do espaço); se ele não estiver carregado, carregue as páginas até achá-lo (com limite) ou mostre só o destaque.
(5) Depois de criar ou excluir uma avaliação, invalide também as consultas da busca do Explorar, do mapa e dos recentes (use-reviews.ts:56-70), para o selo dos cards atualizar.
(6) Minhas avaliações: "bairro · cidade" no card, com os campos novos do item.
(7) Maestro (apps/mobile/.maestro, não execute): desfaça a ambiguidade do tapOn "Excluir" (use testID); não dependa do texto "32/500" do contador (o accessibilityLabel o sobrepõe no iOS: use o testID e o label); avaliacoes-lista.yaml confere a média "4,2" e as 6 avaliações do seed.
(8) Atualize "Implementação no app (AV.4)" em docs/05.
Testes (npx jest --maxWorkers=2, só os afetados e a suíte uma vez no fim).
```

## Prompt de revisão

```
Revise o branch da tarefa <número> de docs/tarefas/avaliacoes-1.md contra o main: correção, aderência às decisões 99 a 106 de docs/07-perguntas-em-aberto.md e às RF-REVIEW/RN-REVIEW (seção 12 de docs/02), segurança e permissões (elegibilidade conferida no servidor; equipe não avalia o próprio espaço; só Dono/Admin respondem; só o Super oculta; nenhuma rota permite ao espaço apagar ou alterar a avaliação), privacidade (lista pública sem id de usuário nem sobrenome completo; anonimização da conta apagando comentário, resposta e denúncias), consistência de `rating_count`/`rating_sum` (mesma transação, concorrência), idempotência e limites do job de pedidos, contrato OpenAPI e api-client em sincronia, temas claro/escuro sem cor fixa e testes. Somente leitura: não altere arquivos. Liste os achados por gravidade, com arquivo e linha.
```

# Avaliações 2 — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Checklist em `docs/06-roadmap.md`, seção "Avaliações 2". Decisões 99 a 109 de `docs/07-perguntas-em-aberto.md` (em especial 102, 106 e 109) e a seção 12 de `docs/02-requisitos-funcionais.md`: leia antes de começar. A primeira entrega está em `docs/tarefas/avaliacoes-1.md` (AV.1–AV.6), toda no `main`.

**Plano padrão:** `forte`

**Ordem:** Onda 1 (AV2.1 e AV2.2 em paralelo) → revisão e merge da AV2.1 (contrato) → Onda 2 (AV2.3) → Onda 3 (AV2.4) → Maestro das avaliações, deploy no staging, APK novo e conferência no emulador (sessão principal).

**Resumo do que entra:**
- Filtro "4+ estrelas" e ordenação "Melhor avaliados" no Explorar do app, sobre a nota pública (decisão 109).
- Pendências pequenas da AV.6: textos do Super para espaço fora da vitrine, "(0)" no link de avaliações do Super, "Ver todas as 1 avaliação" no app e a folha "Foto do perfil" no iOS.

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz, a seção 12 de `docs/02-requisitos-funcionais.md` e as decisões 99 a 109 antes de começar. Documentação em português (BR); código em inglês.
- Máquina com pouca RAM. Máximo de 2 workers nos testes, SEMPRE explícito na linha de comando (API e web: `--maxWorkers=2`; mobile: `npx jest --maxWorkers=2`), `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados, Playwright com 1 worker e só das specs afetadas. Durante o trabalho, rode só os testes afetados; a suíte completa da sua área, uma vez no final. Não rode `next build` sem necessidade. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333, 8081 e 8082; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Contrato OpenAPI muda só em tarefa de API, com o cliente regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo branch (skill `contrato-api`). Se o `main` local estiver à frente do seu branch, faça `git merge main` antes de começar, depois `pnpm install` e `pnpm --filter @space-sports/shared build`.
- Sem migração nesta entrega, a não ser que um índice seja necessário para a ordenação (nesse caso, o próximo número livre, provavelmente `0031`).
- Sem cor fixa nas telas: tudo por `packages/ui-tokens`, nos temas claro e escuro, seguindo o kit `docs/brand/kit/` e a seção "Avaliações" de `docs/05-design-system.md`. Nas telas, confira com a skill `verificar-visual`.
- Web: sem testes de CSS ou classe (`toHaveClass`, `toHaveCSS`, `toHaveStyle`, `getComputedStyle`, `cn()`); teste só comportamento.
- Dados dos espaços parceiros: nunca invente avaliações para espaços reais. Avaliações de demonstração só no seed de dev/e2e, com usuários fictícios.
- Atualize `docs/02-requisitos-funcionais.md` e `docs/05-design-system.md` com o que mudou. Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português, assunto em minúsculas, cabeçalho até 100 caracteres) e com typecheck, `pnpm lint` na raiz e os testes da sua área passando. Relate o que ficou de fora.

## Onda 1

### AV2.1 · API: filtro e ordenação por nota na busca
- **Agente:** `api-engineer`
- **Branch:** `feat/reviews-search`

**Prompt**
```
Em apps/api e packages/shared, implemente a decisão 109 de docs/07-perguntas-em-aberto.md em GET /v1/spaces (spaceSearchQuerySchema em packages/shared/src/spaces.ts; apps/api/src/spaces/public-spaces.service.ts, public-spaces.controller.ts e spaces.openapi.ts). Leia antes como a busca pagina (cursor) e ordena hoje (distância com lat/lng, nome sem eles) e como o card monta `rating` e decide a nota pública (`isPublicSummaryVisible` em src/reviews/review-views.ts, `rating_count`/`rating_sum` em spaces, REVIEW_SUMMARY_MIN_COUNT).

(1) Query nova `minRating` (inteiro de 1 a 5, opcional; o app manda 4): só entram espaços com a nota pública visível (pelo menos REVIEW_SUMMARY_MIN_COUNT avaliações) e média >= minRating. Os espaços "Novo" ficam de fora, sem revelar a média escondida. A média comparada é a exibida no card (arredondada a 1 casa; decisão 109 revista em 2026-11-05).
(2) Query nova `sort`: `distance` (padrão; com lat/lng ordena pela distância, sem eles pelo nome, como hoje) ou `rating`: primeiro os espaços com nota pública, por média desc, depois total desc; em seguida os "Novo"; desempate pela distância (com lat/lng) ou pelo nome, e por id. O raio e os outros filtros (sport, service, amenities, q) continuam valendo.
(3) Cursor estável nas duas ordens: a paginação não repete nem pula espaço (o cursor da ordem `rating` carrega os campos da ordem; um cursor de uma ordem usado na outra dá 400 com código claro). Se precisar, índice/expressão no banco; não carregue tudo em memória.
(4) Se GET /v1/spaces/map (ou a rota do mapa, se existir) aceitar os mesmos filtros, aplique `minRating` lá também; `sort` não se aplica ao mapa.
Testes de integração (vitest --maxWorkers=2): filtro com espaços de 4,9 / 4,0 / 3,9 e um "Novo" de média 5 (fica de fora), ordenação com empates, paginação nas duas ordens sem repetição, combinação com raio e esporte, query inválida (minRating 0 ou 6, sort desconhecido). OpenAPI e api-client regenerados (skill contrato-api), docs/02 (RF-REVIEW e RF-SPACE da busca) atualizado. Rode `pnpm typecheck` na RAIZ antes de commitar.
```

### AV2.2 · Web: ajustes das avaliações no Super
- **Agente:** `web-engineer`
- **Branch:** `fix/reviews-super-polish`

**Prompt**
```
Em apps/web, feche as pendências da AV.6 nas avaliações do Super (docs/tarefas/avaliacoes-1.md, AV.6b; decisões 102 e 103):
(1) `averageVisibilityHint` em apps/web/src/lib/reviews.ts: para espaço fora da vitrine com menos de 5 avaliações, hoje diz "Aparece no app a partir de 5 avaliações (faltam N)", mas o público não veria a nota mesmo com 5. Fora da vitrine, o texto tem que dizer isso primeiro (ex.: "Não aparece no app nem no site: espaço fora da vitrine"), seja qual for o total. Para isso o hint precisa saber se o espaço está na vitrine: veja de onde o painel e o Super tiram esse dado (o resumo do Super, AV.6a, já funciona fora da vitrine) e ajuste as chamadas. O painel do espaço continua igual para espaço na vitrine.
(2) Link "Avaliações" do detalhe do espaço no Super (apps/web/src/components/super/spaces/space-detail.tsx, `ratingLink`): sem avaliações, mostra "(0)"; mostre só "Avaliações", sem contagem, e ajuste o aria-label.
(3) O mock da API dos testes e2e (apps/web/e2e, mocks do Super e do painel) não tem o caso de espaço fora da vitrine com avaliações: acrescente-o e cubra (1) e (2) com teste (unitário do hint e e2e do Super com o mock), só comportamento.
Confira as telas com a skill verificar-visual (claro e escuro).
```

## Onda 2

### AV2.3 · Mobile: filtros por nota no Explorar e ajustes
- **Agente:** `mobile-engineer`
- **Branch:** `feat/reviews-explore-mobile`

**Prompt**
```
Em apps/mobile, implemente a decisão 109 de docs/07-perguntas-em-aberto.md e feche as pendências da AV.6c. A AV2.1 (API: `minRating` e `sort` em GET /v1/spaces) já está no main: faça `git merge main`, `pnpm install` e `pnpm --filter @space-sports/shared build` antes de começar.
(1) Folha de filtros do Explorar (apps/mobile/src/features/discovery/filters-sheet.tsx, filters-store.ts, search-params.ts, use-spaces-search.ts): opção "4+ estrelas" (liga `minRating=4`) e "Ordenar por": "Mais perto" (padrão) / "Melhor avaliados" (`sort=rating`). Entram na contagem de filtros ativos, em "Limpar" e em tudo que hoje some com filtro (seções do Explorar, carrossel, recentes: siga o comportamento atual de filtro aplicado). No mapa, só o "4+ estrelas" vale. Estado vazio com "4+ estrelas" ligado: texto que explique que só entram espaços com nota (a partir de 5 avaliações) e ofereça tirar o filtro. Documente os controles e os textos em docs/05-design-system.md (seção "Avaliações" ou "Explorar e anúncios"), nos dois temas, com os componentes já usados na folha.
(2) "Ver todas as 1 avaliação" (apps/mobile/src/features/reviews/reviews-block.tsx:304 com `reviewsCountLabel`): com 1 avaliação, "Ver a avaliação" (como o web, apps/web/src/components/reviews/space-reviews-section.tsx:87); com mais, "Ver todas as N avaliações".
(3) Folha "Foto do perfil" em apps/mobile/src/features/account/edit-profile-screen.tsx (~:168, `choose` fecha a folha e abre o seletor na mesma hora): no iOS o seletor de imagem não abre enquanto a folha ainda fecha. Use o mesmo padrão da AV.6c (ação depois do fechamento, toques ignorados durante o fechamento; veja useMenuSheet e o menu da avaliação) e confira as outras ações da folha (remover foto).
Testes com jest (--maxWorkers=2) para cada item; testIDs nos controles novos seguindo apps/mobile/.maestro/README.md (prefixo `filtros-`). Confira com a skill verificar-visual só pelos testes e capturas que não exijam emulador (não suba emulador nem Metro; a sessão principal confere no emulador).
```

## Onda 3

### AV2.4 · QA: filtro e ordenação por nota
- **Agente:** `qa-engineer`
- **Branch:** `test/reviews-search`

**Prompt**
```
Teste a decisão 109 de docs/07-perguntas-em-aberto.md (AV2.1 e AV2.3 de docs/tarefas/avaliacoes-2.md, no main). Não altere código de produção; achou bug, descreva com arquivo, linha e reprodução (BUG-AV2-n) e escreva o teste que falha marcado como `it.fails`.
(1) Integração da API (vitest --maxWorkers=2), além do que a AV2.1 já cobre: invariantes da ordem `rating` com dados aleatórios (a lista paginada inteira é igual à lista ordenada em memória pelas regras da decisão 109), nota que muda entre páginas (avaliação criada/excluída no meio da paginação não quebra o cursor nem dá 500), espaço fora da vitrine nunca aparece, autor bloqueado fora da média, e que nenhum campo da resposta revela a média de espaço "Novo".
(2) Seed de e2e (apps/api/test/e2e-seed): garanta espaços fictícios suficientes para o filtro e a ordenação fazerem diferença (um com nota pública alta, um com nota pública abaixo de 4 e um "Novo"), sem quebrar os fluxos e specs que já usam o seed (rode as specs do Playwright real e os testes que leem o seed afetados).
(3) Maestro: fluxo novo apps/mobile/.maestro/flows/explorar-filtro-nota.yaml (só lê): liga "4+ estrelas", confere quem entra e quem sai, troca para "Melhor avaliados" e confere a ordem, "Limpar" volta ao normal. Atualize a tabela do apps/mobile/.maestro/README.md. Não execute (a sessão principal executa).
```

## Prompt de revisão

```
Revise o branch da tarefa <número> de docs/tarefas/avaliacoes-2.md contra o main: correção, aderência às decisões 102, 106 e 109 de docs/07-perguntas-em-aberto.md e à seção 12 de docs/02, privacidade (nenhuma resposta nem ordem que revele a média de espaço com menos de 5 avaliações ou fora da vitrine), paginação por cursor estável nas duas ordens, desempenho da consulta (sem carregar tudo em memória), contrato OpenAPI e api-client em sincronia, temas claro/escuro sem cor fixa e testes. Somente leitura: não altere arquivos. Liste os achados por gravidade, com arquivo e linha.
```

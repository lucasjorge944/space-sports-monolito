# Anúncios 1 — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Checklist em `docs/06-roadmap.md`, seção "Anúncios e novo Explorar". Decisões 73 a 79 de `docs/07-perguntas-em-aberto.md`, especificação em `docs/12-anuncios.md` e requisitos RF-ADS, RN-ADS, RF-SPACE-12 e RF-SPACE-13 em `docs/02-requisitos-funcionais.md` (leia os três antes de começar).

**Plano padrão:** `forte`

**Ordem:** Onda 1 (AD.1 e AD.2 em paralelo) → merge, `openapi.json` e lockfile regenerados → Onda 2 (AD.3 e AD.4 em paralelo) → Onda 3 (AD.5) → deploy no staging (CDK da mídia e seed), APK novo e conferência no emulador.

**Resumo do que entra:**
- Anúncios de venda direta, cadastrados só pelo `/super` (decisões 73 e 76), de empresas e de espaços parceiros (decisão 74). Bets e bebidas alcoólicas vetadas; suplementos permitidos (decisão 75).
- Duas vagas no Explorar do app: **carrossel de banners no topo** e **card patrocinado na lista** (decisão 77), também para quem não fez login (decisão 78).
- Explorar no estilo do iFood (`docs/12-anuncios.md`, seção 3): atalhos por esporte → carrossel patrocinado → **Espaços recentes** (decisão 79) → lista com cards patrocinados.
- Impressões e cliques somados por dia, sem dado pessoal; relatório com CSV no `/super`.
- Seed de demonstração com anúncios de teste de anunciantes fictícios; imagens CC0 já estão em `apps/api/src/db/demo-assets/ads/` (créditos em `CREDITOS.md`).

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz, `docs/12-anuncios.md` e as decisões 73 a 79 antes de começar. Documentação em português (BR); código em inglês.
- Máquina com pouca RAM. Máximo de 2 workers nos testes, SEMPRE explícito na linha de comando (API e web: `--maxWorkers=2`; mobile: `npx jest --maxWorkers=2`), `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados, Playwright com 1 worker e só das specs afetadas. Durante o trabalho, rode só os testes afetados; a suíte completa da sua área, uma vez no final. Não rode `next build` sem necessidade. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333 e 8081; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Contrato OpenAPI muda só em tarefa de API, com o cliente regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo branch. Depois de trazer o `main`, rode `pnpm install` e `pnpm --filter @space-sports/shared build`.
- Migrações: a AD.2 usa `0024`. Ao terminar, traga o `main`; se outra migração entrou antes, regenere a sua com o próximo número livre, para o `_journal` e os snapshots ficarem em cadeia.
- Datas em UTC e exibição em `America/Sao_Paulo`. Sem cor fixa nas telas: tudo por `packages/ui-tokens`, nos temas claro e escuro, seguindo o kit `docs/brand/kit/`.
- Web: sem testes de CSS ou classe (`toHaveClass`, `toHaveCSS`, `toHaveStyle`, `getComputedStyle`, `cn()`); teste só comportamento.
- Nenhum segredo no repositório. Nenhuma marca real nos anúncios de teste.
- Atualize `docs/02-requisitos-funcionais.md`, `docs/04-modelo-de-dados.md`, `docs/05-design-system.md` e `docs/12-anuncios.md` com o que mudou na implementação. Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português) e com typecheck, `pnpm lint` na raiz e os testes da sua área passando. Relate o que ficou de fora.

## Onda 1 — Especificação e API

### AD.1 · Design: Explorar, carrossel, card patrocinado e recentes
- **Agente:** `ui-designer`
- **Branch:** `feat/ads-explore-design`

**Prompt**
```
Especifique o visual do novo Explorar do app e das peças de anúncio (decisões 73 a 79 de docs/07-perguntas-em-aberto.md; estrutura e formatos em docs/12-anuncios.md, seções 3 e 4; referência do iFood em docs/anuncios/referencias/). Leia o kit docs/brand/kit/ (pranchas 01 a 07, inclusive o dark mode), docs/05-design-system.md, packages/ui-tokens e as telas atuais apps/mobile/src/app/(tabs)/index.tsx, src/features/discovery/space-card.tsx e search-header.tsx. Não implemente as telas: a AD.4 (mobile) implementa a partir do seu documento.

Entregue em docs/05-design-system.md (seção nova "Explorar e anúncios"), com medidas, tokens e estados, nos temas claro e escuro:
(1) Atalhos por esporte: chip ou ícone, estado selecionado, rolagem horizontal, ícones (diga de onde vêm: biblioteca de ícones já usada no app ou SVGs novos em packages/ui-tokens).
(2) Carrossel patrocinado (2:1): raio, margens, degradê de leitura sobre a imagem (que funcione com foto clara e escura), tipografia do título/texto/botão, selo "Patrocinado · <anunciante>", indicador de progresso em segmentos, comportamento (troca em 5 s, pausa ao toque, "reduzir movimento" desliga a troca automática), estado de carregamento (skeleton) e ausência (some sem deixar espaço).
(3) Card patrocinado na lista (4:5): como se diferencia do card de espaço sem perder o ritmo da lista; variante de anunciante `SPACE` (o card do espaço com o selo).
(4) Espaços recentes: card compacto (foto, logo, nome, bairro), título da seção, "Ver mais" se fizer sentido, skeleton.
(5) Títulos das seções e espaçamentos da tela inteira, em ordem (cabeçalho → atalhos → carrossel → recentes → "Espaços perto de você" → lista).
(6) Selo "Patrocinado": se faltar token (cor de fundo/texto do selo nos dois temas, com contraste AA), crie em packages/ui-tokens e gere as saídas como os outros tokens.
(7) Pré-visualização da peça no /super (AD.3): como mostrar o banner e o card nos dois temas lado a lado.
Inclua um mockup simples (ASCII ou SVG em docs/anuncios/) da tela inteira. Confira o contraste com as imagens de teste de apps/api/src/db/demo-assets/ads/.
```

### AD.2 · API: anúncios, métricas, recentes e seed
- **Agente:** `api-engineer`
- **Branch:** `feat/ads-api`

**Prompt**
```
Em apps/api, packages/shared e infra/, implemente os anúncios (RF-ADS-01 a 09 e RN-ADS-01 a 06 de docs/02-requisitos-funcionais.md; decisões 73 a 79 de docs/07-perguntas-em-aberto.md; especificação em docs/12-anuncios.md; tabelas em docs/04-modelo-de-dados.md, seção "Anúncios") e os espaços recentes (RF-SPACE-12). Leia antes src/super/ (guards, auditoria do Super, padrões de lista paginada), src/spaces/public-spaces.controller.ts e a busca da vitrine, src/spaces/space-logo.service.ts e space-uploads.ts (fluxo de upload com URL pré-assinada e registro), src/storage/, src/db/demo-seed.ts e infra/lib/media-storage.ts.

(1) Schema e migração `0024`: `advertisers`, `ad_campaigns`, `ad_creatives`, `ad_daily_stats` e `ad_event_receipts`, como em docs/04 (ajuste e documente o que mudar). Enums sem `BETTING` nem `ALCOHOL` (RN-ADS-01). Checks: `ends_at > starts_at`, `weight` 1–10, anunciante `SPACE` com `space_id`, peça com destino coerente com o tipo (URL https, WhatsApp E.164 com mensagem, espaço).

(2) Super (só papel da plataforma, RN-ADS-02; auditoria RN-ADS-06), em `/v1/super/ads/...`:
  - anunciantes: listar (busca, filtro por ativo/tipo/categoria), criar, editar, ativar/desativar;
  - campanhas: listar (filtro por anunciante, vaga, status, "no ar agora"), criar, editar, mudar status, duplicar; devolve se está no ar e por quê não (sem peça, fora do período, anunciante inativo);
  - peças: `POST .../creatives/uploads` `{ placement, contentType }` → URL pré-assinada em `uploads/ads/...`; criar/editar com a `key`, que é copiada para `ads/<campaignId>/<uuid>.<ext>` e conferida pelo image-info (proporção 2:1 para `EXPLORE_HERO` e 4:5 para `EXPLORE_FEED` com tolerância de 2%, tamanho mínimo e até 2 MB, como em docs/12, seção 4); trocar imagem apaga a anterior; ordenar; desativar;
  - relatório: `GET .../campaigns/:id/report?from=&to=` com totais e série diária (impressões, cliques, CTR) e `.../report.csv`.
  Validação com Zod em packages/shared (limites de texto de docs/12), erros com códigos estáveis.

(3) Entrega pública (RF-ADS-07, sem login): `GET /v1/ads?placement=&cityId=&lat=&lng=&sportId=`. Sem `cityId`, resolva a cidade pelas coordenadas (cidade do espaço da vitrine mais próximo num raio razoável, documente) e, sem nenhum dos dois, só entram campanhas sem filtro de cidade. Filtra campanhas no ar (status, período, anunciante ativo, peça ativa, destino `SPACE` só com espaço na vitrine — RN-ADS-05), sorteia por peso sem repetir campanha, até 5 (`EXPLORE_HERO`) ou 10 (`EXPLORE_FEED`). Cada peça vem com anunciante (nome, tipo), textos, imagem, destino (para `SPACE`, os dados do card do espaço: slug, nome, bairro, capa, logo, esportes, preço) e um `deliveryToken` assinado (HMAC com segredo por env, contendo um id de entrega, peça, campanha, vaga e validade de 2 h). Cache curto (Redis ou memória, ~60 s) da consulta das campanhas no ar. `Cache-Control: no-store` na resposta.

(4) Eventos (RF-ADS-08, RN-ADS-03 e 04): `POST /v1/ads/events` `{ events: [{ token, type: 'IMPRESSION'|'CLICK' }] }` (até 50), público, com limite de taxa por IP. Token inválido/vencido é descartado sem erro; cada token conta no máximo uma impressão e um clique (`ad_event_receipts` com único por `(delivery_id, kind)`); soma em `ad_daily_stats` por upsert, no dia de `America/Sao_Paulo`. Responde 202 com quantos foram aceitos. Job diário (BullMQ, como os outros) apaga recibos vencidos. Nada de usuário, aparelho ou IP gravado.

(5) Espaços recentes (RF-SPACE-12): `GET /v1/me/recent-spaces` (logado) com até 10 espaços da vitrine em que o usuário reservou (organizador ou participante confirmado) ou tem aula/assinatura, ordenados pela interação mais recente (data da reserva/aula já passada ou criada; documente o critério), no mesmo formato do card da vitrine (`GET /v1/spaces`). Sem tabela nova de visualização: as aberturas de página ficam só no aparelho (AD.4).

(6) Infra: em infra/lib/media-storage.ts, a política do bucket passa a liberar ao CloudFront também `ads/*` (nunca `uploads/*`); ajuste os testes do CDK. Novo segredo `ADS_DELIVERY_SECRET` em src/config/env.ts (obrigatório em production; gerado no dev/test), .env.example, infra/staging/compose.yml e o Parameter Store documentado em infra/README.md. Não rode `cdk deploy`.

(7) Seed de demonstração (src/db/demo-seed.ts, idempotente, só dev/staging): anunciantes fictícios e campanhas ativas por 90 dias a partir do seed, sem filtro de cidade, com as imagens de src/db/demo-assets/ads/ enviadas pelo mesmo serviço do upload (sem storage, pule as peças com imagem como as logos):
  - `EXPLORE_HERO`: "Rede Quadra Artigos Esportivos" (SPORTING_GOODS, rede-quadra-hero.jpg, "Raquetes de beach tennis com até 30% off"), "Areia Fit" (APPAREL, areia-fit-hero.jpg, coleção praia e quadra), "Força Total Equipamentos" (FITNESS, forca-total-hero.jpg, treino funcional) e um destaque de espaço parceiro (anunciante `SPACE` ligado à Astral Beach Sports, sem imagem própria, destino na página do espaço; textos sem inventar preço ou dado do espaço, decisão de docs/08: use só o que está cadastrado);
  - `EXPLORE_FEED`: "Pulso Nutrition" (SUPPLEMENTS, pulso-nutrition-feed.jpg, whey e pré-treino), "Passada Calçados" (SPORTING_GOODS, passada-feed.jpg), "Movimento Fisio" (HEALTH, movimento-fisio-feed.jpg, fisioterapia esportiva, destino WhatsApp com número fictício), "Verde Vida Sucos" (FOOD_BEVERAGE, verde-vida-feed.jpg), "Hidrata+" (SPORTING_GOODS, hidrata-feed.jpg, garrafas térmicas).
  Destinos URL apontam para `https://example.com/...` (domínio reservado). Textos curtos em português, dentro dos limites; nada de marca real. Registre no relatório do seed.

Testes de integração (vitest `--maxWorkers=2`): permissões (só Super; espaço não vê), categoria proibida recusada, validação de imagem por vaga, entrega filtrando período/status/cidade/esporte/anunciante inativo/espaço fora da vitrine, sorteio por peso sem repetir campanha, token (válido, vencido, adulterado, reuso não soma duas vezes), upsert diário no fuso de São Paulo, relatório e CSV, recentes (ordem, limite, espaço suspenso some, só do próprio usuário), seed idempotente. Atualize o OpenAPI, regenere o api-client e atualize docs/02, docs/04, docs/12 e docs/09-infra-aws.md (prefixo `ads/`).
```

## Onda 2 — Telas

### AD.3 · Web: anúncios no `/super`
- **Agente:** `web-engineer`
- **Branch:** `feat/ads-super-web`

**Prompt**
```
Em apps/web, implemente a gestão de anúncios no /super (RF-ADS-01, 02, 03 e 09; decisões 73 a 76 de docs/07-perguntas-em-aberto.md; docs/12-anuncios.md). A API está no main (tarefa AD.2 de docs/tarefas/anuncios-1.md): leia o OpenAPI regenerado em packages/api-client e os Zod de packages/shared. A especificação visual da pré-visualização está em docs/05-design-system.md, seção "Explorar e anúncios" (AD.1). Siga shadcn/ui, os tokens de packages/ui-tokens e os padrões das telas atuais do /super (listas, filtros, formulários, sheets, auditoria).

(1) Menu do /super: item "Anúncios" com as abas Campanhas e Anunciantes.
(2) Anunciantes: lista com busca e filtros (tipo, categoria, ativo), criar/editar (tipo Empresa ou Espaço; no tipo Espaço, seletor do espaço; categoria sem bets nem álcool; contato comercial; observações), ativar/desativar.
(3) Campanhas: lista com filtros (anunciante, vaga, status, "no ar agora") e um selo de situação ("No ar", "Agendada", "Encerrada", "Pausada", "Sem peças", "Anunciante inativo"); formulário com anunciante, nome, vaga (Carrossel do topo ou Card na lista, com a explicação de cada uma e o formato da imagem), período (datas e horas em America/Sao_Paulo, enviadas em UTC), cidades (catálogo /v1/cities, vazio = todas), esportes (vazio = todos), peso 1–10 e status; duplicar.
(4) Peças da campanha: lista ordenável; criar/editar com upload da imagem (recorte na proporção da vaga no navegador antes do upload, reaproveitando o recorte da foto de perfil/logo), título, texto e botão com contador de caracteres, destino (URL https, WhatsApp com máscara e mensagem, ou espaço da plataforma). Anunciante Espaço pode publicar sem imagem. **Pré-visualização** do banner ou do card como aparecem no app, nos temas claro e escuro lado a lado (AD.1, item 7).
(5) Relatório da campanha: período, totais (impressões, cliques, CTR) e tabela diária; gráfico simples de linha se o web já tiver uma biblioteca de gráficos (não adicione biblioteca só para isso); botão "Exportar CSV".
(6) Erros da API com mensagens claras: `AD_CATEGORY_FORBIDDEN`, imagem fora da proporção/tamanho, destino inválido (`AD_CREATIVE_INVALID`; URL só `https://` sem espaço), `AD_PLACEMENT_CHANGED` (409: a vaga mudou durante o envio, peça para enviar a imagem de novo), `AD_IMAGE_REQUIRED`, `AD_SPACE_NOT_FOUND` (inclusive ao reativar anunciante de espaço suspenso) e storage indisponível (503). Confira a lista completa no OpenAPI e em docs/12.
Testes de comportamento (vitest e Playwright com API simulada, 1 worker, só as specs afetadas): criar anunciante e campanha, recusa de categoria proibida, upload de peça (mock), pré-visualização, filtros e exportação do relatório. Atualize docs/05 (telas do /super) se couber.
```

### AD.4 · Mobile: novo Explorar com anúncios e recentes
- **Agente:** `mobile-engineer`
- **Branch:** `feat/ads-explore-mobile`

**Prompt**
```
Em apps/mobile, reestruture o Explorar ((tabs)/index.tsx) no estilo do iFood e exiba os anúncios (RF-ADS-04 a 08, RF-SPACE-12 e RF-SPACE-13; decisões 77 a 79 de docs/07-perguntas-em-aberto.md; estrutura em docs/12-anuncios.md, seção 3). A API está no main (tarefa AD.2 de docs/tarefas/anuncios-1.md): leia o api-client regenerado. A especificação visual está em docs/05-design-system.md, seção "Explorar e anúncios" (tarefa AD.1): siga-a, com NativeWind, React Native Reusables e os tokens de packages/ui-tokens, nos temas claro e escuro.

(1) Uma única lista (FlashList) com cabeçalho composto: busca/filtros atuais → atalhos por esporte (catálogo /v1/sports; tocar aplica o mesmo filtro de esporte do filters-store) → carrossel patrocinado → Espaços recentes → título "Espaços perto de você" (ou "Espaços" sem localização) → lista. Atalhos ficam visíveis com filtro ativo (mostram o esporte selecionado) e somem só com busca por nome; carrossel e recentes somem com busca por nome ou filtro ativo (esporte, serviço ou infraestrutura); o título vira "Resultados" nesses casos. O raio de distância não conta como filtro: não esconde seção nem troca o título (não use o countActiveFilters, que inclui o raio). Card patrocinado em vagas fixas (3ª posição e a cada 8 espaços); anúncio que chega atrasado só entra em vaga que ainda não apareceu na tela.
(2) Anúncios: `GET /v1/ads` por vaga com cidade/coordenadas e esporte atuais (TanStack Query, cache de alguns minutos; falha, 429 `TOO_MANY_REQUESTS` ou lista vazia não mostram erro nem seguram a lista, e o 429 não dispara nova tentativa imediata). Carrossel `EXPLORE_HERO`: troca a cada 5 s, pausa ao toque/arrasto, desliga a troca com "reduzir movimento" (AccessibilityInfo), indicador em segmentos. Card `EXPLORE_FEED` intercalado na 3ª posição e depois a cada 8 espaços, sem repetir a mesma peça seguida, também na paginação infinita; anunciante `SPACE` sem imagem usa o SpaceCard com o selo. Todo anúncio com "Patrocinado · <anunciante>" e `accessibilityLabel` próprio. Imagens com expo-image.
(3) Destinos: URL externa no navegador do sistema (expo-web-browser ou Linking, só https), WhatsApp pelo link `https://wa.me/<telefone>?text=<mensagem>`, espaço pela rota interna `espaco/[slug]`.
(4) Métricas: impressão quando a peça fica ≥50% visível por 1 s (onViewableItemsChanged da lista e o slide ativo do carrossel, só com o Explorar em foco), uma vez por peça por abertura do Explorar; clique ao tocar. Fila em memória enviada em lote para `POST /v1/ads/events` a cada ~10 s, ao sair da tela e ao ir para segundo plano (AppState); falha descarta em silêncio. Nada de id de usuário ou aparelho.
(5) Espaços recentes: histórico local das páginas de espaço abertas (AsyncStorage ou o storage que o app já usa; até 10, por slug, com os dados do card) gravado ao abrir espaco/[slug]; logado, junte com `GET /v1/me/recent-spaces` (mais recente primeiro, sem repetir). Faixa horizontal de cards compactos; tocar abre o espaço. A entrada sai do histórico local quando espaco/[slug] responder 404 ou mostrar o espaço suspenso/fora da vitrine. O histórico local é apagado ao sair da conta e na exclusão/inativação da conta.
(6) Skeletons para atalhos, carrossel e recentes; pull-to-refresh recarrega tudo.
Testes (`npx jest --maxWorkers=2`, só os afetados e a suíte uma vez no fim): intercalação dos cards (posições, paginação, sem repetição, anúncio atrasado pula a vaga já vista), visibilidade das seções (atalhos ficam com filtro e somem com busca por nome; carrossel e recentes somem com busca ou filtro; o raio sozinho não esconde nada nem troca o título), fila de eventos (lote, uma impressão por peça, envio no background), histórico local (limite, ordem, remoção do espaço que responde 404 ou suspenso, limpeza no logout e na exclusão/inativação da conta), destinos. Fluxo Maestro novo em apps/mobile/.maestro para o Explorar com `testID` no carrossel, nos cards patrocinados e nos recentes (não execute). Atualize docs/05 e docs/12 se a implementação mudar algo.
```

## Onda 3 — Qualidade

### AD.5 · QA: anúncios e Explorar
- **Agente:** `qa-engineer`
- **Branch:** `test/ads`

**Prompt**
```
Escreva e rode testes que verificam RF-ADS-01 a 09, RN-ADS-01 a 06, RF-SPACE-12 e RF-SPACE-13 de docs/02-requisitos-funcionais.md, já implementados no main (tarefas AD.2 a AD.4 de docs/tarefas/anuncios-1.md). Não altere código de produção: relate os bugs com passos para reproduzir.

(1) API (integração, vitest `--maxWorkers=2`): matriz de permissões (Super sim; Dono/Admin/Professor/jogador/anônimo não) em todas as rotas de /v1/super/ads; categorias proibidas; entrega pública sem login com todos os filtros e o sorteio por peso (estatístico, com semente ou muitas rodadas); limites por vaga; tokens adulterados, vencidos, de outra peça e reutilizados; limite de taxa dos eventos; virada de dia em America/Sao_Paulo no upsert diário; relatório e CSV batendo com os eventos; recentes; seed idempotente. Complete o que a AD.2 não cobriu.
(2) Web E2E real (apps/web/e2e/real, Playwright 1 worker, só as specs novas): Super cria anunciante, campanha e peça (upload real só se houver storage no ambiente; senão, documente), vê a campanha "No ar" e o relatório zerado; categoria proibida não aparece nem é aceita.
(3) Mobile: revise o fluxo Maestro do Explorar em apps/mobile/.maestro (não execute; não há emulador nesta máquina).
(4) Seed do e2e (apps/api/test/e2e-seed): inclua anúncios no ar nas duas vagas (ao menos um com imagem e um de anunciante SPACE sem imagem), para os fluxos Maestro e os e2e do web terem carrossel e card patrocinado. Mudança só em dado de teste, não em código de produção.
Relate a cobertura e as lacunas para a sessão principal.
```

## Prompt de revisão

```
Revise o branch da tarefa <número> de docs/tarefas/anuncios-1.md contra o main: correção, aderência às decisões 73 a 79 de docs/07-perguntas-em-aberto.md, a docs/12-anuncios.md e às RF/RN de docs/02 (RF-ADS, RN-ADS, RF-SPACE-12 e 13), segurança (rotas de anúncios só para o Super; entrega e eventos públicos sem vazar dados internos nem permitir inflar métricas; token de entrega assinado e verificado; nada público em `uploads/`; URLs só https; nenhum segredo commitado), privacidade (nenhum dado pessoal, aparelho ou IP nos eventos; histórico de recentes local limpo no logout), selo "Patrocinado" sempre visível, contrato OpenAPI e api-client em sincronia, temas claro/escuro sem cor fixa e testes. Somente leitura: não altere arquivos. Liste os achados por gravidade, com arquivo e linha.
```

# 12 · Anúncios e Explorar

Venda de espaço publicitário dentro do app (decisões 73 a 79 de `07-perguntas-em-aberto.md`). Requisitos em `02-requisitos-funcionais.md`, seção 10 (ADS) e RF-SPACE-12; dados em `04-modelo-de-dados.md`, seção "Anúncios"; briefing em `tarefas/anuncios-1.md`.

## 1. Modelo

- **Venda direta.** A equipe do Space Sports vende, cadastra e publica pelo `/super`; a cobrança acontece fora da plataforma, como a do SaaS. Sem AdMob nem outra rede: nada de SDK de rastreamento, e a identidade visual fica sob controle.
- **Anunciantes:** empresas (artigos esportivos, moda fitness, suplementos, saúde, alimentação, eventos, serviços) e **os próprios espaços parceiros** (decisão 74).
- **Proibidos:** apostas (bets) e bebidas alcoólicas (decisão 75). Suplementos podem.
- **Sem dados pessoais na segmentação:** só cidade, esporte e período. Os anúncios aparecem também para quem não fez login (decisão 78).
- **Selo "Patrocinado" sempre visível** (CDC e código do CONAR: a publicidade tem de ser identificável como tal).

## 2. Referência: Explorar do iFood

Capturas da App Store em `anuncios/referencias/` (só referência interna, não usar como asset).

| Captura | O que aproveitar |
|---|---|
| `ifood-home-atalhos.jpg` | Grade de **atalhos por categoria** logo abaixo do cabeçalho; **banner largo em carrossel** com indicador de progresso em segmentos; seção **"Últimas lojas"** com "Ver mais". |
| `ifood-home-banner.jpg` | O banner ocupa a largura toda, com cantos arredondados, e muda sozinho. |
| `ifood-tela-cheia.jpg` | Promoção em tela cheia com botão "Aproveitar". **Não copiar:** anúncio que cobre a tela atrapalha a busca do jogador (decisão 77). |

O que o iFood faz bem e vamos seguir: a home tem uma ordem fixa (atalhos → banner → últimas lojas → lista), a área paga fica concentrada no banner e em cards marcados dentro da lista, e a pessoa volta rápido ao que já usou.

## 3. Estrutura nova do Explorar (app)

De cima para baixo, numa única lista rolável:

1. **Cabeçalho** atual (busca, filtros, localização). Sem mudança.
2. **Atalhos por esporte:** faixa horizontal com os esportes do catálogo (ícone e nome); tocar aplica o filtro do esporte. Substitui a necessidade de abrir os filtros para o caso mais comum.
3. **Carrossel patrocinado** (`EXPLORE_HERO`): de 1 a 5 banners 2:1, largura total menos as margens, cantos `rounded-xl` (24); troca sozinho a cada 5 s e pausa enquanto a pessoa toca ou arrasta; indicador em segmentos (como o iFood). Cada banner mostra a imagem, um degradê para leitura, título, texto curto, botão e o selo "Patrocinado · <anunciante>". O texto é desenhado pelo app (tokens de `packages/ui-tokens`, claro e escuro), não vem dentro da imagem. Sem anúncio ativo, o carrossel some.
4. **Espaços recentes** (RF-SPACE-12): faixa horizontal de cards compactos (foto, logo, nome, bairro). Só aparece com pelo menos um espaço.
5. **Título "Espaços perto de você"** (ou "Espaços" sem localização) e a **lista vertical** atual, com o **card patrocinado** (`EXPLORE_FEED`) na 3ª posição e depois a cada 8 espaços, sem repetir a mesma peça seguida.

Visibilidade das seções (decisão da sessão principal na revisão da AD.1; detalhes em `05-design-system.md`, "Explorar e anúncios"):

- **Atalhos (2):** visíveis com filtro ativo, mostrando o esporte selecionado, que se desfaz com outro toque. Somem só com a busca por nome.
- **Carrossel (3) e recentes (4):** somem com busca por nome ou com filtro ativo. A lista continua podendo ter cards patrocinados.
- **Título (5):** "Espaços perto de você" (ou "Espaços" sem localização) sem busca nem filtro; "Resultados" com busca por nome ou filtro ativo.
- **O que é filtro aqui:** esporte, serviço e infraestrutura. **O raio de distância não conta**: mudá-lo não esconde seção nem troca o título.

A vaga não segura o carregamento: os anúncios chegam numa chamada separada e, se ela falhar, o Explorar segue sem eles. **Vagas fixas no feed:** a 3ª posição e depois a cada 8 espaços. Se os anúncios chegarem depois de a lista aparecer, entram só nas vagas que ainda não apareceram na tela; a vaga que a pessoa já viu fica vazia até a próxima abertura do Explorar ou o puxar para atualizar, para nenhum card já visto ser empurrado.

## 4. Formatos

| Vaga | Onde | Imagem | Textos |
|---|---|---|---|
| `EXPLORE_HERO` | Carrossel do topo | 2:1, mínimo 960×480, até 2 MB | título até 40, texto até 90, botão até 20 caracteres |
| `EXPLORE_FEED` | Card na lista de espaços | 4:5 (como o card de espaço), mínimo 480×600, até 2 MB | título até 40, texto até 90, botão até 20 caracteres |

- Anúncio de **espaço parceiro** pode dispensar a imagem: usa a capa e a logo do espaço, e no feed vira o próprio card do espaço com o selo "Patrocinado".
- **Destinos:** URL externa (só `https`), WhatsApp (telefone E.164 e mensagem pronta) ou página de um espaço da plataforma.

## 5. Segmentação, rotação e métricas

- Campanha: anunciante, vaga, período (início e fim em UTC), cidades (vazio = todas), esportes (vazio = todos), peso de 1 a 10 e status.
- O app pede os anúncios da vaga com a cidade e o esporte atuais. A API sorteia as campanhas ativas, ponderadas pelo peso, e devolve até 5 peças para o carrossel e até 10 para o feed.
- **Impressão:** peça pelo menos 50% visível por 1 s, contada uma vez por peça a cada abertura do Explorar. **Clique:** toque no banner ou no card.
- Os eventos vão em lote, com um token assinado de cada entrega (impede inflar números com chamadas forjadas), e viram contadores diários por peça. Nada fica ligado ao usuário.
- O `/super` mostra impressões, cliques e CTR por campanha e por dia, com exportação em CSV para enviar ao anunciante.

## 6. API (implementação, tarefa AD.2)

Contrato no OpenAPI (`packages/api-client/openapi.json`, tags `super-ads` e `ads`); schemas Zod em `packages/shared/src/ads.ts`; código em `apps/api/src/ads/`.

### Super (`/v1/super/ads`, só o papel da plataforma)

| Rota | O que faz |
|---|---|
| `GET/POST /advertisers`, `GET/PATCH /advertisers/:id` | Anunciantes com busca (`q`) e filtros (`active`, `kind`, `category`). `PATCH` edita e ativa/desativa (`active`). Tipo e espaço não mudam. Categoria de apostas ou álcool: `AD_CATEGORY_FORBIDDEN` (422). Um anunciante ativo por espaço: `ADVERTISER_SPACE_TAKEN` (409). Criar ou reativar anunciante `SPACE` exige o espaço ativo: `AD_SPACE_NOT_FOUND` (422). |
| `GET/POST /campaigns`, `GET/PATCH /campaigns/:id` | Campanhas com filtros (`advertiserId`, `placement`, `status`, `onAir`, `q`). Cada uma traz `delivery.onAir` e os motivos de não estar no ar: `NOT_ACTIVE`, `NOT_STARTED`, `ENDED`, `ADVERTISER_INACTIVE` e `NO_CREATIVES` (nenhuma peça ativa entregável, com a mesma regra da entrega: peça com destino em espaço fora da vitrine não conta, nem peça sem imagem que não tenha destino em espaço). O detalhe traz as peças. A vaga só muda sem peças (`AD_PLACEMENT_LOCKED`). |
| `POST /campaigns/:id/status` | `DRAFT` → `ACTIVE`/`ARCHIVED`; `ACTIVE` ↔ `PAUSED`; qualquer um → `ARCHIVED`, que é final (`AD_INVALID_STATUS_TRANSITION`). |
| `POST /campaigns/:id/duplicate` | Cópia em `DRAFT`, " (cópia)" no nome, com as peças e cópias das imagens. |
| `POST /creatives/uploads` | `{ placement, contentType, size? }` → URL pré-assinada em `uploads/ads/<vaga>/<uuid>.<ext>` e o `format` da vaga. |
| `POST /campaigns/:id/creatives`, `PATCH /campaigns/:id/creatives/:creativeId` | Peça com `imageKey` (a chave do upload): a API copia para `ads/<campaignId>/<uuid do upload>-<uuid novo>.<ext>`, apaga o upload e confere a cópia (tipo pelos bytes, até 2 MB, proporção da vaga com 2% de tolerância, tamanho mínimo). Erros: `AD_IMAGE_KEY_INVALID`, `AD_IMAGE_NOT_UPLOADED`, `AD_IMAGE_TOO_LARGE`, `AD_IMAGE_INVALID`, `AD_IMAGE_WRONG_ASPECT`, `AD_IMAGE_TOO_SMALL`, `AD_IMAGE_REQUIRED`, `AD_DESTINATION_SPACE_NOT_FOUND`, `AD_CREATIVE_INVALID` (check do banco que escape da validação, 422), `AD_PLACEMENT_CHANGED` (a vaga da campanha mudou entre a conferência da imagem e a gravação, 409) e `STORAGE_UNAVAILABLE` (503). URL de destino só `https://` minúsculo e sem espaços, como o check do banco. Sem imagem, só peça de anunciante `SPACE` com destino no próprio espaço (`AD_IMAGE_REQUIRED`). Trocar a imagem apaga a anterior; `imageKey: null` tira a imagem (com a mesma regra); `active` desativa. |
| `PUT /campaigns/:id/creatives/order` | Nova ordem com todos os ids. A ordem organiza a lista do /super; a entrega sorteia uma peça por campanha. |
| `GET /campaigns/:id/report`, `GET /campaigns/:id/report.csv` | Totais, série diária (com os dias zerados) e por peça; período em dias de `America/Sao_Paulo`, padrão do início da campanha até hoje (ou até o último dia), até um ano. CSV com `dia, impressoes, cliques, ctr_percentual` e a linha `total`. |

Tudo que escreve vai para a auditoria (`super.advertiser.*`, `super.ad_campaign.*`, `super.ad_creative.*`, inclusive `super.ad_campaign.export_csv`).

### Telas do `/super` (web, tarefa AD.3)

Menu **Anúncios** (`/super/anuncios`) com as abas Campanhas e Anunciantes; detalhe da campanha com Peças e Relatório; editor da peça com recorte da imagem na proporção da vaga e pré-visualização nos temas claro e escuro. Descrição das telas em `05-design-system.md` ("Estrutura de navegação e telas" e "Pré-visualização no `/super`"); código em `apps/web/src/components/super/ads/` e regras em `apps/web/src/lib/super/ads.ts`. O relatório não tem gráfico (o web não tem biblioteca de gráficos).

- **Limitação conhecida (revisão da AD.3):** os seletores de anunciante (filtro da lista de campanhas e formulário da campanha) carregam só os 100 primeiros anunciantes (`pageSize: 100`). Com mais que isso, o anunciante que ficar de fora não aparece no seletor (o filtro por `?anunciante=` continua funcionando). Resolver com busca no seletor quando a base passar desse tamanho.

### Entrega e eventos (públicos, sem login)

- **`GET /v1/ads?placement=&cityId=&lat=&lng=&sportId=&sport=`**: peças de campanhas `ACTIVE` dentro do período, de anunciante ativo, peça ativa e, com destino em espaço, espaço na vitrine (RN-ADS-05). Cada peça traz o anunciante (nome e tipo, para o selo), textos, imagem (nula na peça de espaço sem imagem própria), destino (`URL`; `WHATSAPP` com o link `wa.me` pronto; `SPACE` com o card do espaço no formato de `GET /v1/spaces`) e o `deliveryToken`. Limite de 60 entregas por minuto por IP (429 `TOO_MANY_REQUESTS` com `X-Retry-After`): cada entrega gera tokens novos, então o teto limita também o que um IP consegue somar.
- **Cidade:** `cityId`; sem ele, a do espaço da vitrine mais próximo de `lat`/`lng`, num raio de 50 km (a cidade onde a pessoa está procurando quadra); sem nenhum dos dois, ou sem espaço perto, só campanhas sem filtro de cidade.
- **Esporte:** `sportId` ou o slug em `sport` (o mesmo filtro do Explorar). Sem esporte, só campanhas sem filtro de esporte: a campanha de um esporte aparece para quem está olhando aquele esporte.
- **Sorteio:** ponderado pelo peso e sem repetir campanha (corrida exponencial de Efraimidis–Spirakis); de cada campanha sorteada sai uma peça ao acaso entre as entregáveis. A ordem da resposta é a do sorteio. Até 5 no carrossel e 10 no card.
- **Cache:** as peças no ar de cada vaga ficam 1 minuto em memória por instância (as escritas do Super limpam o cache da própria instância); a resposta vai com `Cache-Control: no-store`.
- **Token de entrega:** `<payload>.<HMAC-SHA256>` em base64url com a chave `ADS_DELIVERY_SECRET`; o payload tem um id aleatório da entrega, a peça, a campanha, a vaga e a validade (2 h). Nada de quem recebeu.
- **`POST /v1/ads/events`** `{ events: [{ token, type }] }` (até 50): token inválido, adulterado ou vencido é descartado sem erro; o recibo `(id da entrega, tipo)` faz cada token contar uma impressão e um clique no máximo; o clique de uma entrega sem impressão contada grava a impressão junto (o lote da impressão pode ter se perdido ou chegar depois), então os cliques nunca passam das impressões; a soma vai para `ad_daily_stats` por upsert, no dia de `America/Sao_Paulo` em que o evento chegou. Responde 202 com `accepted` (os eventos do lote contados; a impressão gravada com o clique não entra). Limites por IP: 120 envios e 600 eventos por minuto, com o lote consumindo o número de eventos que traz (o IP só entra na chave do contador no Redis). O job diário `ads-maintenance` (04:00) apaga os recibos vencidos.

### Espaços recentes (`GET /v1/me/recent-spaces`, logado)

Até 10 espaços da vitrine com reserva (organizador ou participante que aceitou), aula (presença confirmada, presente ou falta) ou assinatura não recusada, pela interação mais recente: a data da reserva ou da aula quando já passou, a data em que foi feita quando ainda vai acontecer, e a data do pedido da assinatura. Canceladas não contam. As páginas só abertas ficam no aparelho (AD.4).

### Seed de demonstração

`pnpm db:seed:demo` cria os anunciantes fictícios de `apps/api/src/db/demo-ads.ts` (Rede Quadra, Areia Fit, Força Total, Pulso Nutrition, Passada, Movimento Fisio, Verde Vida, Hidrata+) e o destaque da Astral Beach Sports (anunciante `SPACE`, sem imagem, destino na página do espaço, textos só com nome, cidade e esportes de `08-espacos-parceiros.md`), com campanhas `ACTIVE` por 90 dias a partir do seed, sem filtro de cidade nem de esporte. As imagens passam pelo mesmo fluxo do upload; sem storage, as peças com imagem são puladas e entram no próximo seed com storage. Destinos em `https://example.com/...` e WhatsApp com número fictício. O destaque da Astral só é entregue quando o espaço estiver na vitrine (preço e quadra ativa). O anunciante do espaço é achado pelo espaço, ativo ou não (o mais recente): o seed não recria nem reativa o destaque que o Super desativou.

## 7. App (implementação, tarefa AD.4)

Código em `apps/mobile/src/features/explore/` (a rota `(tabs)/index.tsx` só reexporta `ExploreScreen`).

- **Lista:** uma `FlashList` com as seções no `ListHeaderComponent` e os cards patrocinados nos dados (`getItemType`: `space`, `ad`, `sponsored-space`). Vagas na 3ª, 12ª, 21ª… posição (8 espaços entre dois patrocinados), pela ordem do sorteio em rodízio e sem a mesma peça em vagas seguidas (com uma peça só, vagas alternadas). Anúncio atrasado: a vaga cujo espaço seguinte já apareceu fica vazia. Nova entrega na mesma "sessão" da lista (mesma busca e filtros, até o puxar para atualizar) só entra nas vagas que ainda não passaram pela tela; as vagas vistas mantêm a peça (com o token novo, se a peça veio de novo na entrega).
- **Visibilidade das seções:** `hasContentFilters` (esporte, serviço, infraestrutura) e a busca por nome com o mesmo debounce da lista; o raio não conta.
- **Entrega:** `GET /v1/ads` por vaga com `lat`/`lng` arredondados para 2 casas (a API acha a cidade; o app não conhece o `cityId`) e o slug do esporte do filtro, sempre sem `Authorization`, mesmo logado (RN-ADS-03; o mesmo vale para `POST /v1/ads/events`). Cada abertura do Explorar (a aba ganhar o foco ou o app voltar do segundo plano com ela em foco; o `inactive` do iOS não conta) busca as duas vagas de novo, uma vez por vaga (junta com a busca que já estiver em andamento), para respeitar o limite de 60 `GET /v1/ads` por minuto; assim campanha encerrada ou pausada e espaço fora da vitrine saem na abertura seguinte. Com o Explorar aberto, uma nova entrega também é buscada 5 min antes de o primeiro token vencer. Fora isso, TanStack Query com 5 min de cache (troca de esporte e volta, por exemplo) e sem busca extra por foco da janela ou volta da rede; 4xx (inclusive o 429) não tenta de novo, nem ao remontar a tela; rede e 5xx, uma vez. O carrossel só é pedido quando aparece (sem busca nem filtro). Falha, 429 ou lista vazia: a vaga some, sem erro.
- **Métricas:** impressão com a peça ≥ 50% visível por 1 s (`onViewableItemsChanged` com 50% e um temporizador de 1 s; o banner ativo do carrossel com ele ≥ 50% na tela), só com a aba em foco e o app em primeiro plano. Cada abertura (e cada puxar para atualizar) traz uma entrega nova, com tokens novos; quando ela chega, a peça (`creativeId`) volta a poder contar uma impressão, com o token novo (antes disso, o token antigo já contou a dele). Assim cada abertura soma uma impressão por peça no servidor; se a busca falhar, o token antigo vai de novo e a API o descarta. Clique: um por entrega, contado só se o destino abriu, e enviado na hora (o destino costuma levar o app para segundo plano). Fila em memória enviada em lotes de até 50 a cada 10 s, ao perder o foco e ao ir para segundo plano (`AppState`); falha descarta o lote. Evento de token vencido nem entra na fila.
- **Destinos:** URL `https://` (conferida de novo no app) e WhatsApp pelo `destination.url` que a API monta (o app só confere o prefixo `https://wa.me/`) pelo `Linking`, que abre o navegador ou o app do sistema; espaço pela rota `espaco/[slug]`. Destino recusado ou sem app para abrir não conta o clique.
- **Espaços recentes:** histórico do aparelho num JSON nos documentos do app (até 10, por slug, com os dados do card), gravado quando `espaco/[slug]` carrega e removido quando ela responde 404 (a API devolve 404 também para espaço suspenso ou fora da vitrine). Logado, junta com `GET /v1/me/recent-spaces`: os do aparelho primeiro, depois os da conta, sem repetir, até 10. Apagado no fim da sessão (`endSession`): sair, excluir ou inativar a conta e sessão recusada pela API (401, conta inativa ou bloqueada).

## 8. Depois do MVP

Vaga na reserva confirmada e patrocínio de torneio; limite de exibições por pessoa; anúncio no web público quando existir vitrine web; preço por CPM; autoatendimento do anunciante.

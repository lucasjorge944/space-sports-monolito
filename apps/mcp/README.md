# @space-sports/mcp

Servidor MCP do Space Sports (`docs/14-mcp.md`): o jogador conecta o Space Sports ao assistente de IA dele (Claude e outros clientes MCP) e, pela conversa, busca espaços, vê horários livres, reserva e cancela quadra e confirma presença nas aulas. Na fase 2 (seção 8), Dono, Admin e Professor usam o mesmo conector para **ler e analisar** a gestão dos espaços (métricas prontas para tabela, gráfico e artifact), e o Super usa um conector próprio, **Space Sports · Plataforma**, para ler a plataforma inteira; nenhum dos dois grava nada.

- **Remoto e sem estado:** Streamable HTTP em `POST /mcp`, com o `@modelcontextprotocol/server` (SDK v2, protocolo 2026-07-28, e clientes 2025 atendidos pelo modo sem estado). Nada fica em memória entre requisições.
- **Sem poder próprio:** não acessa banco nem tem chave de serviço. Cada tool chama a API pelo `packages/api-client` (entrada `dist/fetch.js`, sem React) com o **mesmo Bearer do usuário** e `X-Client: mcp`. Regras (preço, disponibilidade, prazos) são da API.
- **OAuth:** servidor de recurso. O token (JWT do Better Auth da API, tarefa MCP.1) é validado pelo `createMcpProtectedRequestHandler` do `@better-auth/mcp`: assinatura pelo JWKS, `iss`, `aud` = a URL do recurso da superfície, `exp`, `sub` e `azp`.
- **Superfícies** (decisão 120): cada conector é uma superfície, com a sua URL de recurso (`aud`), o seu metadata RFC 9728, os seus escopos, tools e prompts (`src/surfaces`). `MCP_SURFACES` diz quais o processo serve (padrão `user`). Com mais de uma, a escolha é pelo host (e caminho) da requisição, e um token só vale na superfície da sua audiência. Superfícies: `user` (conector "Space Sports": jogador e gestão, `MCP_RESOURCE_URL`) e `admin` (conector "Space Sports · Plataforma": só Super, escopo `super:read`, `MCP_ADMIN_RESOURCE_URL`). Nenhuma tool de uma aparece na outra, um token de um recurso recebe 401 na outra e os logs levam `surface`.

## Conectar no Claude (conector personalizado)

O OAuth está na API (MCP.1); falta a MCP.3 (telas `/entrar` e `/autorizar` no web) e o deploy no staging (MCP.6).

1. No Claude (web ou desktop): **Configurações → Conectores → Adicionar conector personalizado**.
2. Nome: `Space Sports`. URL: `https://mcp-staging.spacesports.com.br/mcp` no staging (produção: `https://mcp.spacesports.com.br/mcp`).
3. **Conectar**: o Claude lê `/.well-known/oauth-protected-resource`, abre o login do Space Sports (`/entrar`) e o consentimento (`/autorizar`). Depois de **Permitir**, as tools aparecem na conversa.
4. Para desconectar: "Apps conectados" no app ou no web (revoga o acesso; o token em uso morre em até 15 minutos).

**Conector do Super** (só a equipe Super): outro conector personalizado, nome `Space Sports · Plataforma`, URL `https://mcp-admin-staging.spacesports.com.br/mcp`. O `client_id` do Claude precisa estar em `MCP_ADMIN_ALLOWED_CLIENT_IDS` na API (o primeiro "Conectar" aparece no log da API como recusado; ver `infra/README.md`). A conexão vale no máximo 24 horas; depois, conectar de novo.

## Rotas

| Rota | O que faz |
|---|---|
| `POST /mcp` (o caminho da URL do recurso da superfície) | MCP (Streamable HTTP sem estado). `Origin` fora de `MCP_ALLOWED_ORIGINS`: 403. Sem token (ou token que não é `at+jwt`, de outra audiência, como o do outro conector, com mais de uma audiência, ou sem usuário): 401 com `WWW-Authenticate` apontando para a metadata da superfície do host. Tool sem o escopo: 403 `insufficient_scope`. `MCP_ENABLED=false` (todas) ou a chave da superfície (`MCP_ADMIN_ENABLED=false`, só a `admin`): 503. `GET`/`DELETE`: 405. Host (ou caminho) sem superfície: 404. |
| `GET /.well-known/oauth-protected-resource` e `.../<caminho do recurso>` | Protected Resource Metadata (RFC 9728) da superfície do host: `resource`, emissor, `scopes_supported` (na `user`: os 5 de jogador + `manage:read` e `manage:finance:read`; na `admin`: `super:read`) e `resource_name`. Sem caminho, só quando o host tem uma superfície. Com a chave da superfície desligada (`MCP_ADMIN_ENABLED=false`): 503. |
| `GET /health` | Para o proxy e o `HEALTHCHECK` da imagem. |

## Tools

| Tool | Escopo | Tipo |
|---|---|---|
| `get_my_profile` (saudação, `GET /v1/me/summary`) | qualquer escopo do MCP | leitura |
| `search_spaces`, `get_space`, `check_availability`, `list_space_classes` | `spaces:read` | leitura |
| `list_my_bookings`, `get_booking` | `bookings:read` | leitura |
| `prepare_booking` | `bookings:write` + `spaces:read` | leitura (resumo + código) |
| `create_booking` | `bookings:write` + `spaces:read` | escrita com código de confirmação |
| `prepare_cancel_booking` | `bookings:write` + `bookings:read` | leitura (resumo + código) |
| `cancel_booking` | `bookings:write` + `bookings:read` | escrita com código de confirmação |
| `list_my_classes` | `classes:read` | leitura |
| `confirm_class_attendance`, `cancel_class_attendance` | `classes:write` | escrita (uma etapa) |

### Gestão em leitura (fase 2, `docs/14-mcp.md` 8.5)

| Tool | Escopo | Chama |
|---|---|---|
| `list_my_managed_spaces` | `manage:read` | `GET /v1/me/staff-spaces` (espaços, papel, se vê valores, movimento de hoje) |
| `get_space_today` | `manage:read` (valores com `manage:finance:read`, Dono/Admin) | agenda e aulas de hoje do `staff-spaces`, ocupação de hoje (`analytics/occupancy`) e, com valores, `receivables/today` + `analytics/revenue` de hoje |
| `list_space_bookings` | `manage:read` | `GET …/bookings` (período local, status, origem, quadra, nome do cliente, cursor) |
| `list_class_groups` | `manage:read` | `GET …/class-groups` |
| `get_reviews_summary` | `manage:read` | `GET …/reviews/summary` + as recentes (`GET …/reviews`) |
| `get_booking_metrics`, `get_occupancy`, `get_class_metrics`, `get_customer_metrics` | `manage:read` | `GET …/analytics/{bookings,occupancy,classes,customers}` |
| `get_revenue` | `manage:read` + `manage:finance:read` | `GET …/analytics/revenue` |
| `get_statement` | `manage:read` + `manage:finance:read` | `GET …/statement` (datas locais → instantes UTC) |
| `list_delinquents` | `manage:read` + `manage:finance:read` | `GET …/subscription-charges/delinquents` |
| `get_online_payments_summary` | `manage:read` + `manage:finance:read` | `GET …/online-payments/wallet` + `analytics/revenue` por canal |

- Todas com `readOnlyHint: true`, `openWorldHint: false`, `outputSchema` + `structuredContent` e um texto curto. Nada é gravado.
- **Espaço** por id, slug ou nome, só entre os que a pessoa administra (`GET /v1/me/staff-spaces`); opcional quando ela é da equipe de um espaço só. Nome ambíguo: `SPACE_AMBIGUOUS` com as opções; fora da lista: `SPACE_NOT_FOUND`; sem equipe: `NOT_STAFF`.
- **Métricas** no formato da API (`period`, `groupBy`, `timezone`, `columns`, `rows`, `totals`), com o texto em BRL ao lado de cada valor em centavos (`receivedCents` → `receivedFormatted`, indicado em `columns[].formattedKey`).
- **Valores** só quando a API manda (Dono e Admin com `manage:finance:read`, decisão 53): o Professor recebe nulos (com o motivo em `valuesNote`) ou a recusa `SPACE_FORBIDDEN`, e o MCP não reconstrói nada. O em aberto (`due`) segue a regra do "a receber" da API (confirmada, concluída ou não compareceu, ainda não quitada); no `get_space_today`, `paymentState` separa quitada (`SETTLED`), em aberto, aguardando pagamento online e indisponível.
- **Pessoas** pelo nome; telefone e e-mail nunca. A barreira é a API; o comentário de avaliação ainda passa pelo filtro de contato `redactContacts` (`src/shared/contacts.ts`, defesa parcial, também usado no Super).
- **Cache** de `GET /v1/me/staff-spaces` por 60 s (chave `sub` + hash do token, até 256 entradas, nada compartilhado entre usuários), só com id, slug, nome, papéis e fuso de cada espaço (nunca a agenda), para um prompt de relatório caber no limite de 60 leituras por minuto da API; `list_my_managed_spaces` e `get_space_today` leem sempre da API, e o resolvedor relê a lista da API antes de recusar um espaço com a lista do cache. Custo de cada prompt em `docs/14-mcp.md` 8.5.
- **Prompts** (`manage:read`): `relatorio_mensal_do_espaco` (`espaco`, `mes` AAAA-MM; padrão o mês passado) e `ocupacao_da_semana` (`espaco`; semana atual, segunda a domingo). Montam a mensagem que orienta o assistente a chamar as tools certas e montar um painel; o texto cita a receita só quando a conexão tem `manage:finance:read`.

### Plataforma em leitura (conector do Super, `super:read`; `docs/14-mcp.md` 8.5)

| Tool | Chama |
|---|---|
| `list_spaces` | `GET /v1/super/spaces` (nome ou slug, situação, esportes, página) |
| `get_space_details` | `GET /v1/super/spaces/:id` (espaço por id, slug ou nome, pela busca do Super) |
| `get_platform_metrics` | `GET /v1/super/analytics/platform` |
| `compare_spaces` | `GET /v1/super/analytics/spaces` (período anterior, ordem, situação, limite) |
| `get_platform_finance` | `GET /v1/super/finance/summary` (total e por espaço, serviço, forma e canal) |
| `get_online_payments_revenue` | `GET /v1/super/online-payments/revenue` (total e por espaço, forma e mês) |
| `get_reviews_reports` | `GET /v1/super/reviews/reports` (situação, cursor) |
| `search_audit_logs` | `GET /v1/super/audit-logs` (espaço, ator, ação, entidade, como Super, período, cursor) |
| `list_users` | `GET /v1/super/users` (só por nome, situação, papel, página) |

- Todas com `readOnlyHint: true`, `openWorldHint: false`, `outputSchema` + `structuredContent` e descrições que dizem "visão de plataforma, somente leitura, auditada". A API audita cada leitura (`mcp.admin_request`).
- **Saída em colunas e linhas**: as métricas no formato da API (com o BRL ao lado dos centavos); as listas e as quebras financeiras no mesmo formato (`columns` com `key`, `label`, `unit`; `rows` com `key` e `label`), com as unidades das métricas mais `NUMBER`, `TEXT`, `DATE`, `DATE_TIME` (locais de São Paulo) e `BOOLEAN` (`src/mcp/super/table.ts`). As linhas saem campo a campo: o que a API mandasse a mais não passa.
- **Sem contato** (decisão 122): pessoas só pelo nome. A API já reduz (`@OAuthView`); o MCP não reconstrói nem busca por contato: `q` de `list_users`, `actor` da auditoria e as buscas de espaço com e-mail ou telefone recebem `CONTACT_SEARCH_NOT_ALLOWED` sem chamar a API. Descrição do espaço e comentários de avaliação passam pelo `redactContacts`, que corta o texto em 2 mil caracteres antes de filtrar (a regex de e-mail é quadrática), e saem **marcados como texto de terceiros não confiável** (`description.untrusted`; coluna do comentário com `untrusted: true`); `includeComments=false` tira o comentário da fila de denúncias.
- **Espaço por id nos filtros** (finanças, receita online, auditoria) é conferido na API antes: id inexistente responde `SPACE_NOT_FOUND`, não zeros.
- **Prompt** `saude_da_plataforma` (`dias`, de 7 a 366; padrão 30): métricas da plataforma, quem caiu e quem cresceu, parados (chamada própria: `sort=bookings`, `order=asc`, `limit=200`, zero reserva nos dois períodos), finanças, online, a fila de denúncias em aberto sem os comentários e as sessões de suporte (`support.start`), seguindo o `nextCursor`, num painel.

Cada tool exige todos os escopos das rotas da API que chama (as de valores também resolvem o espaço pelo `manage:read`); só aparecem em `tools/list` as que o token cobre por inteiro. Reservar e cancelar são em duas etapas: `prepare_*` devolve o resumo e um código (HMAC-SHA256 com `MCP_CONFIRMATION_SECRET`, preso aos parâmetros, ao usuário e a 10 minutos); `create_booking`/`cancel_booking` recusam código ausente, vencido, adulterado, de outro usuário ou com outro parâmetro **sem chamar a API**. A `Idempotency-Key` da criação deriva do código. Em clientes do protocolo 2026-07-28 que declaram elicitation, o próprio servidor pede a confirmação ao usuário antes de gravar; a resposta só vale com o `requestState` assinado e preso ao usuário e ao código.

## Variáveis

Veja `.env.example`. Obrigatórias: `API_URL`, `WEB_URL`, `MCP_ISSUER`, `MCP_CONFIRMATION_SECRET` (32+ caracteres; `openssl rand -base64 32`) e a URL de recurso de cada superfície de `MCP_SURFACES`, com o caminho do endpoint (ex.: `/mcp`): `user` → `MCP_RESOURCE_URL`; `admin` → `MCP_ADMIN_RESOURCE_URL` (igual ao `MCP_ADMIN_RESOURCE_URL` da API). Opcionais: `MCP_SURFACES` (`user`; lista separada por vírgula, ex.: `user,admin`; superfície desconhecida ou repetida, ou duas com o mesmo host e caminho, recusa a subida), `MCP_ADMIN_ENABLED` (true; `false` responde 503 só na `admin`, endpoint e metadata; como o `MCP_ENABLED`, booleano da API: `false`, `0`, `off`, `no`, sem diferença de caixa), `PORT` (3340), `HOST`, `MCP_ENABLED` (true, todas as superfícies), `MCP_JWKS_URL` (`<MCP_ISSUER>/jwks`), `MCP_ALLOWED_ORIGINS` (hostnames aceitos no `Origin`; padrão nenhum em produção), `MCP_INTERNAL_HOSTS` (hosts aceitos com `http://` em produção, ex.: `api`), `LOG_LEVEL` (info). Em produção (`NODE_ENV=production`), `API_URL`, `MCP_ISSUER` e `MCP_JWKS_URL` precisam de HTTPS, salvo loopback ou host interno; fora dela, tudo tem padrão local e o servidor sobe sem `.env`.

### As duas superfícies num processo

Com `MCP_SURFACES=user,admin`, o mesmo processo serve os dois conectores e escolhe pelo **hostname** do `Host` e pelo caminho:

| Ambiente | `MCP_RESOURCE_URL` | `MCP_ADMIN_RESOURCE_URL` |
|---|---|---|
| Staging (um contêiner, o Caddy manda os dois hosts para ele) | `https://mcp-staging.spacesports.com.br/mcp` | `https://mcp-admin-staging.spacesports.com.br/mcp` |
| Local (mesmo host, caminhos diferentes) | `http://localhost:3340/mcp` | `http://localhost:3340/admin/mcp` |

A API precisa das mesmas URLs (`MCP_RESOURCE_URL` e `MCP_ADMIN_RESOURCE_URL`), mais `MCP_ADMIN_ALLOWED_CLIENT_IDS`. Em produção, a `admin` pode virar um contêiner próprio com a mesma imagem (`MCP_SURFACES=admin`).

## Rodar local

```bash
cp apps/mcp/.env.example apps/mcp/.env   # preencha MCP_CONFIRMATION_SECRET
pnpm --filter @space-sports/shared --filter @space-sports/api-client build
pnpm --filter @space-sports/mcp dev       # http://localhost:3340/mcp
```

Com a API rodando (com a MCP.1), dá para testar com o MCP Inspector (`npx @modelcontextprotocol/inspector`, transporte Streamable HTTP, URL `http://localhost:3340/mcp`), que faz o fluxo OAuth. Sem a MCP.1, os testes automatizados cobrem tudo com uma API simulada e um JWKS de teste.

## Testes

```bash
pnpm --filter @space-sports/mcp test      # vitest --maxWorkers=2
```

Os testes sobem o servidor de verdade (HTTP) e uma API simulada (`test/support/fake-api.ts`, que também serve o JWKS de teste; a gestão fica em `test/support/fake-manage.ts`, com os papéis pelo `sub` do token e respostas "cruas" com telefone e e-mail, para provar que as tools não os repassam), assinam tokens no formato da API (EdDSA, `at+jwt`, com `offline_access`) e usam o cliente MCP do SDK nas duas eras do protocolo. `test/manage-tools.test.ts` cobre a gestão (tools/list por escopo, cada tool feliz e com 403/404/5xx da API, Professor sem valores, privacidade, logs e prompts); `test/super-tools.test.ts`, o conector do Super (`test/support/fake-super.ts`: cada tool feliz e com erro, filtros e paginação, busca por contato recusada, nenhuma saída com contato, logs e o prompt); e `test/surfaces.test.ts`, as duas superfícies no mesmo processo (tools/list de cada uma, cruzamento de tokens, 503 só na `admin`, logs com a superfície).

Integração com a API real (Docker, Postgres do Testcontainers): `pnpm --filter @space-sports/api exec vitest run --project integration test/mcp/mcp-server.int.test.ts test/mcp/mcp-manage-server.int.test.ts test/mcp/mcp-admin-server.int.test.ts --maxWorkers=2`. O token sai do fluxo OAuth do plugin (na gestão, com os escopos que o papel permite; no Super, do recurso do Super) e o `apps/mcp` sobe por `test/support/real-server.ts` (opção `surface`): jogador (buscar → reservar → cancelar → aulas), gestão (a Dona pede receita e ocupação; a Professora pede presença e não vê valores) e Super (métricas → comparar espaços → auditoria, com cada leitura conferida no `audit_logs`, e o token de um recurso recusado na superfície do outro).

## Imagem

```bash
docker build -f apps/mcp/Dockerfile -t space-sports-mcp .
```

Mesmo padrão da API (`turbo prune` + `pnpm deploy --prod`). Logs em JSON no stdout, sem token nem dados pessoais: só a superfície, `sub`, id do cliente, tool (ou prompt), duração e resultado; nunca os argumentos.

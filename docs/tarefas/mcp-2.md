# Servidor MCP 2 — Gestão e Super em leitura — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Checklist em `docs/06-roadmap.md`, seção "Servidor MCP 2". Leia antes de começar: `docs/14-mcp.md` (inteiro, com atenção à **seção 8**, que é o plano desta fase), as decisões 110 a 125 de `docs/07-perguntas-em-aberto.md` (em especial 53 e 120 a 125) e a seção 13 de `docs/02-requisitos-funcionais.md` (RF-MCP-06 a 08, RN-MCP-06 a 09).

**Plano padrão:** `forte`

**Ordem:**
1. **Onda 1:** MCP2.1 e MCP2.2 em paralelo. A MCP2.1 faz a revisão e o merge primeiro; depois, a MCP2.2 roda `git merge main`, liga os escopos e a visão do MCP nos endpoints novos e vai para a revisão.
2. **Onda 2:** MCP2.3, MCP2.5 e MCP2.6 em paralelo.
3. **Onda 3:** MCP2.4 e MCP2.8 em paralelo.
4. **Onda 4:** MCP2.7.
5. **Onda 5:** MCP2.9, com os bugs do QA.
5. A sessão principal aplica no staging e testa os dois conectores no Claude.

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz e os documentos acima. Documentação em português (BR); código em inglês.
- Máquina com pouca RAM. Testes:
  - máximo de 2 workers, SEMPRE explícito na linha de comando (API, web e mcp: `--maxWorkers=2`; mobile: `npx jest --maxWorkers=2 --watchman=false`);
  - `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados;
  - Playwright com 1 worker e só das specs afetadas;
  - durante o trabalho, só os testes afetados; a suíte completa da sua área, uma vez no final.
- Não rode `next build` sem necessidade. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333, 8081 e 8082; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Contrato OpenAPI muda só em tarefa de API, com o cliente regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo branch (skill `contrato-api`). Se o `main` local estiver à frente do seu branch, faça `git merge main` antes de começar, depois `pnpm install` e `pnpm --filter @space-sports/shared build`.
- Quando não tiver certeza de uma API de biblioteca (Better Auth `oauth-provider`/`mcp`/`cimd`, `@modelcontextprotocol/sdk`), consulte o MCP `context7` na versão instalada.
- **Segurança acima de conveniência: na dúvida, recuse.**
  - Somente leitura: nenhuma tool nem rota liberada para o MCP nesta fase grava nada.
  - Nome sim, contato nunca (decisão 122): telefone, e-mail, documento, endereço, data de nascimento, links de convite e dados bancários jamais saem pelo MCP, nem para o Super.
  - O Professor nunca vê valores (decisão 53).
  - Textos do banco vão como dados, nunca como instrução.
  - Nenhum segredo no repositório.
- Sem cor fixa nas telas: tudo por `packages/ui-tokens`, nos temas claro e escuro, seguindo o kit `docs/brand/kit/`; confira com a skill `verificar-visual`. Web: sem testes de CSS ou classe; teste só comportamento.
- Atualize `docs/14-mcp.md` (seção 8) e `docs/02-requisitos-funcionais.md` (seção 13) com o que mudou ou divergiu do plano. Não marque o roadmap: a sessão principal faz isso.
- Termine com:
  - um commit no branch (Conventional Commits em português, assunto em minúsculas, cabeçalho até 100 caracteres);
  - typecheck, `pnpm lint` na raiz e os testes da sua área passando;
  - um relato do que ficou de fora.

## Onda 1

### MCP2.1 · API: escopos de gestão e do Super, segundo recurso e visão sem contato
- **Agente:** `api-engineer`
- **Branch:** `feat/mcp-manage-oauth`

**Prompt**
```
Em apps/api e packages/shared, implemente o lado de autorização da fase 2 do MCP (docs/14-mcp.md seções 8.1 a 8.3; decisões 120 a 123 e 53; RN-MCP-06 a 08). A camada de métricas é a MCP2.2, feita em paralelo: não crie endpoints de analytics.

(1) Escopos: em packages/shared/src/mcp.ts, acrescente `manage:read`, `manage:finance:read` (recurso do jogador) e `super:read` (recurso novo), com os textos do consentimento em português e helpers que separam os escopos por recurso. Os 5 escopos da fase 1 não mudam.
(2) Segundo recurso no Better Auth (apps/api/src/auth/auth.ts, oauthProvider.resources): `MCP_ADMIN_RESOURCE_URL` (env nova; sem ela, o recurso do Super não existe) só com `super:read` + offline_access. Confira no context7 como o oauth-provider 1.7.20 trata vários recursos (metadata, `resource` no authorize/token, `aud`). O token é emitido para um recurso só.
(3) Escopos concedidos = pedidos ∩ elegíveis, decididos no servidor (no hook do consentimento/emissão, não só na tela):
    - `manage:read` exige papel ativo (Dono, Admin ou Professor) em algum espaço;
    - `manage:finance:read` exige Dono ou Admin em algum espaço;
    - `super:read` exige ser Super.
    No recurso do Super, quem não é Super recebe `access_denied`. Exponha ao web o que ele precisa para mostrar só os escopos concedíveis e o nome do recurso (documente o contrato para a MCP2.5 em docs/14-mcp.md).
(4) Guard: a lista permitida passa a depender da audiência.
    - O token do recurso do jogador só vale nas rotas de jogador (fase 1) e de gestão.
    - O do Super, só nas rotas de super.
    - Token de um recurso numa rota do outro: 403 `OAUTH_ROUTE_NOT_ALLOWED`.
    - Gestão: marque com @OAuthScopes('manage:read') ou ('manage:finance:read') as rotas GET de /v1/manage/spaces/:spaceId que a seção 8.5 de docs/14-mcp.md precisa: espaço, quadras, reservas, bloqueios, a receber hoje (finance), extrato (finance), turmas, sessões, conflitos, presenças/frequência, planos de aula, mensalidades e inadimplência (finance), avaliações e resumo, equipe (sem contato), pagamentos online: charges, carteira e chargebacks (finance).
    - Gestão, fora da lista: CSV, escrita, settings sensíveis, conta do gateway/dados bancários, contatos e convites. Decida rota a rota e liste a decisão em docs/14-mcp.md.
    - O SpaceRolesGuard deixa de recusar o token do MCP só nas rotas com @OAuthScopes e aplica os papéis de sempre: Professor nunca recebe valores, nem com manage:finance:read.
    - Super: @OAuthScopes('super:read') nas GET de /v1/super necessárias para as tools da seção 8.5 (spaces e detalhe, metrics/spaces, finance/summary, online-payments revenue e reports/monthly, reviews reports/summary, audit-logs, users e detalhe). Nunca CSV, simulador, support-sessions, admins, deletion-requests, nem escrita.
    - Atualize o teste da lista exata (agora por recurso).
(5) Visão do MCP (decisão 122): nas rotas de gestão e de super, a resposta com contexto MCP passa por uma LISTA DE CAMPOS PERMITIDOS por rota (schema Zod reduzido ou serializador explícito; nunca uma lista do que remover). Nome sim; telefone, e-mail, documento, endereço, data de nascimento, tokens, links de convite e dados bancários nunca. A sessão normal do web não muda.
(6) Proteções do Super (decisão 123):
    - `MCP_ADMIN_ALLOWED_CLIENT_IDS` (lista separada por vírgula; vazia = recusa todos): o authorize do recurso do Super recusa outro cliente e loga o client_id recusado.
    - Sessão de no máximo 24 h desde o consentimento (token e refresh param de valer; descubra se o plugin permite TTL de refresh por recurso; senão, confira no guard e na renovação).
    - Auditoria de TODA leitura com token do Super (audit_logs: origem MCP, client id, método, rota, query; sem corpo de resposta; sem gravar o token).
    - `MCP_ADMIN_ENABLED` (padrão: ligado em dev/test; staging ligado se `MCP_ADMIN_RESOURCE_URL` existir; produção desligado), que desliga só o recurso do Super com 503 `MCP_DISABLED`, inclusive no metadata e no authorize desse recurso.
(7) Limites: os mesmos do RN-MCP-03 para gestão e Super.
Testes de integração (vitest --maxWorkers=2):
    - emissão por recurso e escopos concedidos por papel (jogador sem papel, Professor, Admin, Dono, Super);
    - cruzamento de audiências nos dois sentidos;
    - Professor com manage:finance:read pedido não recebe o escopo, e mesmo forçando, não vê valores;
    - Admin de A lendo espaço B (404/403 como no painel);
    - varredura de TODAS as rotas da lista (gestão e super) com o token do MCP procurando telefone, e-mail, documento e afins (deve falhar se aparecer);
    - cliente fora da lista no Super;
    - sessão de 24 h vencida;
    - auditoria de leitura;
    - MCP_ADMIN_ENABLED=false sem afetar o recurso do jogador.
OpenAPI e api-client regenerados (skill contrato-api), `.env.example` com as variáveis novas, docs/14-mcp.md seção 8 e docs/02 seção 13 atualizados. Rode `pnpm typecheck` na RAIZ antes de commitar.
```

### MCP2.2 · API: camada de métricas
- **Agente:** `api-engineer`
- **Branch:** `feat/analytics-api`

**Prompt**
```
Em apps/api e packages/shared, crie a camada de métricas da seção 8.4 de docs/14-mcp.md (decisão 124; RF-MCP-08; RN-MCP-09; ideia original em docs/11-ia-agentes.md §4.1).
Os 7 endpoints da tabela:
- manage: bookings, occupancy, classes, customers, revenue;
- super: platform, spaces.
Todos com:
- schemas Zod em packages/shared;
- query `from`/`to` (YYYY-MM-DD, máx. 366 dias, padrão últimos 30 dias) e `groupBy` (valores fechados por endpoint), mais filtros simples (quadra, esporte, turma) onde fizer sentido;
- resposta no formato `{ period, groupBy, timezone, columns: [{ key, label, unit }], rows, totals }`, em que unit é COUNT, HOURS, RATIO (0–1) ou BRL_CENTS;
- agrupamento de datas em America/Sao_Paulo;
- dados guardados em UTC.
Sem SQL livre: consultas Drizzle parametrizadas. Reaproveite a lógica de apps/api/src/bookings (statement.service, receivables), apps/api/src/classes (relatórios de presença/frequência) e apps/api/src/super/insights.service.ts em vez de duplicar regra.
Autorização (sessão normal, como o painel):
- manage/* com SpaceRolesGuard;
- revenue só Dono/Admin (decisão 53);
- classes para Professor só com as turmas dele (siga a regra que o painel já usa e cite-a no doc);
- super/* com SuperGuard.
customers: nome e contagens; nunca contato (decisão 122). Ocupação: horas reservadas ÷ horas de funcionamento das quadras no período, descontando bloqueios (confira como a disponibilidade calcula o funcionamento e reaproveite). Escreva as definições exatas de cada métrica (o que conta como reserva válida, que status entram, receita recebida × a receber) em docs/14-mcp.md seção 8.4.
Desempenho: índices se faltarem (migração com o próximo número livre), e uma consulta por endpoint sempre que possível; meça com o seed e anote o tempo.
A MCP2.1 (escopos e visão do MCP) está sendo feita em paralelo no branch feat/mcp-manage-oauth.
- Enquanto ela não entrar no main, não ponha @OAuthScopes.
- Quando ela entrar no main (a sessão principal avisa), faça `git merge main` e marque os endpoints com @OAuthScopes: manage:read em bookings, occupancy, classes e customers; manage:finance:read em revenue; super:read nos de super.
- Aplique também a visão de campos permitidos do MCP e inclua os endpoints novos no teste da lista exata e na varredura de contato.
Testes de integração (vitest --maxWorkers=2) com dados controlados:
- valores esperados de cada métrica;
- fuso (reserva às 23h30 de São Paulo cai no dia certo);
- limites de período;
- Professor sem revenue e só com as turmas dele;
- isolamento entre espaços;
- espaço sem dados.
OpenAPI e api-client regenerados (skill contrato-api). Rode typecheck e lint na RAIZ antes de commitar.
```

## Onda 2

### MCP2.3 · `apps/mcp`: superfícies e tools de gestão
- **Agente:** `api-engineer`
- **Branch:** `feat/mcp-manage-tools`

**Prompt**
```
Em apps/mcp, implemente a gestão em leitura (docs/14-mcp.md seções 8.1 e 8.5; decisões 120 a 122 e 124; RF-MCP-06 e 08). MCP2.1 e MCP2.2 já estão no main: faça `git merge main`, `pnpm install` e os builds de shared e api-client.
(1) Superfícies: refatore para `MCP_SURFACES` (lista; padrão `user`) em que cada superfície tem a sua URL de recurso, o seu metadata RFC 9728, o seu conjunto de tools e prompts, os seus escopos e a sua validação de token (aud própria). Escolha da superfície por host quando o processo servir mais de uma. Nesta tarefa só a superfície `user` existe (jogador + gestão). Prepare o terreno para a `admin` (MCP2.4) sem implementá-la. Não quebre nada da fase 1: rode a suíte existente.
(2) Tools de gestão da seção 8.5. Para cada uma:
    - readOnlyHint e openWorldHint false;
    - inputSchema Zod;
    - outputSchema + structuredContent;
    - texto curto em português;
    - escopos por tool como na fase 1: tool sem o escopo do token não aparece no tools/list, e get_revenue e afins exigem manage:finance:read.
    Espaço: resolvido entre os que a pessoa administra (list_my_managed_spaces/resolvedor; ambíguo devolve as opções).
    Métricas: repassam os endpoints analytics, mantendo o formato de colunas e linhas e acrescentando o BRL formatado ao lado dos centavos.
    get_space_today: compõe endpoints existentes; para Professor, sem valores (a API já não manda: não reconstrua).
    Descrições para o modelo: quando usar, o que devolve, período padrão e que os dados servem para tabela, gráfico ou artifact. Peça ao modelo para não inventar números ausentes.
(3) Prompts MCP: `relatorio_mensal_do_espaco` (espaço, mês) e `ocupacao_da_semana` (espaço), que orientam o Claude a chamar as tools certas e montar um painel. Confira no context7 como o SDK registra prompts.
(4) Logs como na fase 1 (sem dados pessoais).
Testes (vitest --maxWorkers=2):
- tools/list por combinação de escopos;
- cada tool feliz e com erro da API (403 de papel, 404 de espaço);
- Professor sem valores;
- nenhuma saída com telefone ou e-mail;
- prompts listados;
- integração com a API real (o padrão de apps/api/test/mcp/mcp-server.int.test.ts) numa jornada de gestão: Dono pede receita e ocupação; Professor pede presença.
Atualize README do apps/mcp e docs/14-mcp.md. Typecheck e lint na RAIZ antes de commitar.
```

### MCP2.5 · Web: consentimento com os escopos novos e o conector Plataforma
- **Agente:** `web-engineer`
- **Branch:** `feat/mcp-consent-manage-web`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/web, ajuste o consentimento e os apps conectados para a fase 2 do MCP (docs/14-mcp.md seção 8.1 e o contrato que a MCP2.1 documentou; decisões 120 a 123). A MCP2.1 está no main: `git merge main`, `pnpm install` e builds de shared e api-client.
(1) /autorizar:
    - mostra só os escopos que o servidor vai conceder, agrupados: "Como jogador", "Gestão dos seus espaços" (cite que vale para os espaços em que a pessoa é da equipe e que o Professor não vê valores) e "Painel da plataforma";
    - no recurso do Super, título e aviso próprios ("O assistente vai poder LER dados de todos os espaços da plataforma. Somente leitura; a conexão vale por até 24 horas.");
    - para quem não pode usar o recurso pedido, um estado claro de "sua conta não tem acesso", sem botão Permitir;
    - textos dos escopos vindos de packages/shared.
(2) Apps conectados: mostra a qual conector o app pertence (Space Sports × Space Sports · Plataforma) e os escopos novos. Desconectar continua igual.
Kit de marca nos dois temas, docs/05-design-system.md atualizado. Testes de componente e e2e com a API simulada (comportamento, não estilo): jogador sem papel, Professor, Dono, Super e não-Super no recurso da plataforma. Confira com a skill verificar-visual.
```

### MCP2.6 · Mobile: apps conectados com os escopos novos
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mcp-connected-apps-manage-mobile`
- **Plano:** `equilibrado`

**Prompt**
```
Em apps/mobile, ajuste "Apps conectados" da Conta para a fase 2 do MCP (docs/14-mcp.md seção 8.1; decisões 120 e 121). A MCP2.1 está no main: `git merge main`, `pnpm install` e builds de shared e api-client.
- A lista mostra os escopos novos com os textos de packages/shared e indica o conector (Space Sports × Space Sports · Plataforma), como a MCP2.5 faz no web.
- No estado vazio, para quem é da equipe de algum espaço, cite que pelo mesmo conector dá para consultar os dados do espaço.
Kit de marca nos dois temas. Testes com jest (npx jest --maxWorkers=2 --watchman=false), testIDs com o prefixo `apps-conectados-`. Não suba emulador nem Metro.
```

## Onda 3

### MCP2.4 · `apps/mcp`: superfície do Super
- **Agente:** `api-engineer`
- **Branch:** `feat/mcp-admin-surface`

**Prompt**
```
Em apps/mcp, implemente a superfície `admin` (conector "Space Sports · Plataforma"; docs/14-mcp.md seções 8.1, 8.3 e 8.5; decisões 120, 122 e 123; RF-MCP-07). A MCP2.3 está no main (superfícies): `git merge main`, `pnpm install` e builds.
(1) Superfície `admin`:
    - `MCP_ADMIN_RESOURCE_URL` como aud e metadata próprio;
    - token só do recurso do Super (token do recurso do jogador: 401 com WWW-Authenticate apontando o metadata certo);
    - escopo super:read;
    - `MCP_ADMIN_ENABLED=false` responde 503 só nessa superfície.
    Com `MCP_SURFACES=user,admin`, o mesmo processo serve as duas, escolhendo pelo host (documente as variáveis).
(2) Tools do Super da seção 8.5 e o prompt `saude_da_plataforma`. Para cada tool:
    - readOnlyHint;
    - saída estruturada no formato de colunas e linhas das métricas;
    - search_audit_logs com filtros (espaço, ator, ação, período) e paginação;
    - list_users e get_space_details sem contato (a API já reduz: não reconstrua nem busque por e-mail).
    Descrições deixando claro que é visão de plataforma e somente leitura.
(3) Isolamento entre as superfícies:
    - nenhuma tool de jogador ou gestão aparece na admin, e vice-versa;
    - um token não serve na outra;
    - logs indicam a superfície.
Testes (vitest --maxWorkers=2):
- tools/list de cada superfície;
- cruzamento de tokens;
- 503 isolado;
- cada tool feliz e com erro;
- nenhuma saída com contato;
- integração com a API real: Super faz a jornada métricas → comparar espaços → auditoria, e a leitura aparece no audit_logs.
README e docs/14-mcp.md atualizados. Typecheck e lint na RAIZ antes de commitar.
```

### MCP2.8 · Infra: `mcp-admin-staging.`
- **Agente:** `api-engineer`
- **Branch:** `feat/mcp-admin-staging`

**Prompt**
```
Prepare o staging para o conector do Super (docs/14-mcp.md seções 5 e 8.1; infra/README.md, seção "Servidor MCP"). Só código e documentação: NÃO rode cdk deploy, não crie parâmetros no Parameter Store nem mexa na AWS. Liste no fim os comandos exatos que a sessão principal precisa rodar.
(1) infra/lib/staging-stack.ts: registro `A` de `mcp-admin-staging` para o Elastic IP (subdomínio no cdk.json, como o `mcpSubdomain`). Testes do infra atualizados.
(2) infra/staging/compose.yml:
    - o serviço `mcp` existente passa a servir as duas superfícies (`MCP_SURFACES=user,admin`, `MCP_ADMIN_RESOURCE_URL=https://mcp-admin-staging.spacesports.com.br/mcp` e o que a MCP2.4 documentou), sem contêiner novo e sem aumentar a memória total (meça localmente o pico com as duas superfícies; se 96 MB não bastar, proponha o ajuste com números e NÃO mexa no Redis);
    - na API: `MCP_ADMIN_RESOURCE_URL` e `MCP_ADMIN_ALLOWED_CLIENT_IDS` vindo de parâmetro (`/space-sports/staging/api/MCP_ADMIN_ALLOWED_CLIENT_IDS`, opcional no fetch-env.sh; vazio recusa todos, o que é o esperado até o primeiro teste);
    - `MCP_ADMIN_ENABLED` fora do compose, como chave de emergência pelo parâmetro.
(3) infra/staging/Caddyfile: bloco `mcp-admin-staging.spacesports.com.br` para o mesmo serviço, igual ao `mcp-staging.` (sem encode, sem flush_interval, X-Robots-Tag).
(4) infra/README.md:
    - DNS, variáveis e parâmetro;
    - como descobrir o client_id do Claude no log da API depois da primeira tentativa e colocá-lo no parâmetro;
    - testes por curl: /health, metadata dos dois recursos, 401.
Rode os testes do infra, `pnpm typecheck` e `pnpm lint` na raiz e `docker compose -f infra/staging/compose.yml config` com variáveis fictícias. Commit no branch.
```

## Onda 4

### MCP2.7 · QA: segurança e jornadas de gestão e Super
- **Agente:** `qa-engineer`
- **Branch:** `test/mcp-manage-super`

**Prompt**
```
Teste a fase 2 do MCP (docs/14-mcp.md seção 8; decisões 120 a 125; RF-MCP-06 a 08 e RN-MCP-06 a 09). MCP2.1 a MCP2.6 estão no main. Não altere código de produção. Achou bug: descreva com arquivo, linha e reprodução (BUG-MCP2-n) e escreva o teste que falha, marcado como `it.fails`.
Estenda a suíte e2e de apps/mcp/e2e (run.sh, API e MCP reais, as duas superfícies no mesmo processo) com arquivos novos.
(1) Jornadas pelo SDK por HTTP:
    - Dono: receita do mês por forma de pagamento, ocupação por dia da semana, inadimplentes;
    - Admin: o mesmo;
    - Professor: presença das turmas dele;
    - Super: métricas da plataforma, espaços que caíram, auditoria.
    Confira os números contra o seed.
(2) Segurança:
    - escopos concedidos por papel (jogador sem papel não ganha manage:*, Professor não ganha manage:finance:read, não-Super não conecta na Plataforma);
    - Professor forçando rotas de valor;
    - Admin/Dono do espaço A com ids do espaço B, em todas as tools e rotas da lista;
    - cruzamento de audiências nos dois sentidos;
    - varredura de TODAS as operações do OpenAPI com o token de gestão e com o do Super (só as da lista por recurso respondem; nenhuma escrita);
    - varredura de contato (telefone, e-mail, documento, data de nascimento, convite) em todas as tools e rotas com dados do seed que tenham esses campos preenchidos;
    - cliente fora de MCP_ADMIN_ALLOWED_CLIENT_IDS;
    - sessão de 24 h do Super (com relógio controlado, se possível; senão, documente a lacuna);
    - auditoria de leitura do Super;
    - MCP_ADMIN_ENABLED=false sem afetar o conector do jogador;
    - injeção de prompt em textos do espaço lidos pela gestão;
    - períodos hostis nas métricas (367 dias, from > to, datas inválidas, fuso).
(3) Atualize a tabela da suíte em docs/14-mcp.md seção 7 e os comandos.
```

## Onda 5

### MCP2.9 · API: bugs do QA da fase 2
- **Agente:** `api-engineer`
- **Branch:** `fix/mcp2-qa-bugs`

**Prompt**
```
Corrija os 2 bugs que a MCP2.7 registrou (docs/14-mcp.md seção 7; testes it.fails em apps/mcp/e2e/ com BUG-MCP2-n). Ao corrigir cada um, troque o it.fails por it e rode os arquivos afetados do e2e do MCP (apps/mcp/e2e/run.sh com o filtro) e os testes de integração afetados da API.
(1) BUG-MCP2-1: em apps/api/src/auth/oauth-access.service.ts:229, o iat do token é comparado com o created_at do consentimento em segundos inteiros. Por isso, desconectar e reconectar em menos de 1 s não corta o token antigo emitido no mesmo segundo. Corrija sem depender da precisão do relógio. Por exemplo: uma claim própria no token com o id ou a versão do consentimento, conferida contra o consentimento atual; ou recusar o token com iat no mesmo segundo do created_at quando ele foi emitido antes do consentimento atual (decida e justifique em docs/14-mcp.md 3.3). Não quebre os tokens válidos emitidos logo depois de conectar (há teste disso na fase 1).
(2) BUG-MCP2-2: em packages/shared/src/time.ts:84-87 (addDays), o Date.UTC trata os anos 0 a 99 como 1900 a 1999, e o ano 10000 sai como +010000. Nas métricas, from/to extremos dão 500 ou calendário errado. Corrija o addDays (setUTCFullYear ou equivalente) e limite as datas aceitas no schema das métricas em packages/shared (ex.: de 2000-01-01 a 2100-12-31, com 400 VALIDATION_ERROR fora disso). Teste unitário no shared e os 4 casos do e2e.
Atualize docs/14-mcp.md (bugs corrigidos, seção 7) e docs/02 se a regra mudar. OpenAPI e api-client regenerados se o contrato mudar. Rode typecheck e lint na raiz e commite.
```

### MCP2.10 · Web: datas fora da faixa no painel
- **Agente:** `web-engineer`
- **Branch:** `fix/web-period-range`
- **Plano:** `equilibrado`

**Prompt**
```
Depois da MCP2.9, o addDays de packages/shared lança RangeError quando o resultado passa de 9999, e a API só aceita filtros de período de PERIOD_MIN_DATE a PERIOD_MAX_DATE (2000-01-01 a 2100-12-31, packages/shared/src/booking.ts). Duas telas do painel quebram:
- Sessões com ?data=9999-12-31 na URL (apps/web/src/components/painel/aulas/sessoes/sessoes-view.tsx:51 e :65, pelo weekDates);
- relatório de frequência ao digitar 01/01/9999 em "De" (frequencia-report.tsx:59).
A Agenda já quebrava com esse ano na URL.
(1) Ignore ?data= fora da faixa (caia em hoje) em Sessões, Agenda e onde mais ler data da URL (procure com grep).
(2) Dê min/max ao DateRangePicker/DatePicker com essa faixa nos filtros de período do painel e do /super, para um ano fora dela nem ser enviado.
Testes de comportamento (vitest e e2e com a API simulada das telas afetadas). Sem testes de CSS. Typecheck e lint na raiz, e commite.
```

## Prompt de revisão

```
Revise o branch da tarefa <número> de docs/tarefas/mcp-2.md contra o main com foco em SEGURANÇA e correção:
- aderência a docs/14-mcp.md seção 8, às decisões 53 e 120 a 125 de docs/07-perguntas-em-aberto.md e à seção 13 de docs/02;
- lista permitida por recurso sem brechas (rota nova sem decorador nunca aceita token do MCP; nenhuma escrita, CSV, modo suporte, admins ou dados bancários);
- escopos concedidos por papel decididos no servidor;
- cruzamento de audiências;
- isolamento entre espaços (IDOR) e Professor sem valores;
- visão por lista de campos permitidos (nenhum contato: telefone, e-mail, documento, endereço, nascimento, convite);
- proteções do Super (lista de clientes, 24 h, auditoria de leitura, MCP_ADMIN_ENABLED);
- métricas corretas (fuso, status, receita recebida × a receber) e sem SQL montado com texto;
- limites, injeção de prompt por dados do banco, contrato OpenAPI e api-client em sincronia, temas claro/escuro sem cor fixa e testes.
Somente leitura: não altere arquivos. Liste os achados por gravidade, com arquivo e linha.
```

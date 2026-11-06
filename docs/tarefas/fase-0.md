# Fase 0 — Briefings para o Orca

Cada seção abaixo é uma tarefa para uma sessão do Orca (um worktree por tarefa).

**Plano padrão:** `equilibrado` (planos e formato em `docs/tarefas/README.md`)

**Como usar**
1. No Orca, crie um worktree a partir do `main` com o nome de branch indicado.
2. Inicie o Claude Code no papel do agente: `claude --agent <agente>`. Se a sua versão não tiver `--agent`, comece o prompt com "Atue como o agente `<agente>` definido em `.claude/agents/<agente>.md`".
3. Cole o bloco **Prompt** da tarefa.
4. Ao terminar, abra uma sessão `code-reviewer` no mesmo worktree com o prompt de revisão (fim deste arquivo).
5. Faça o merge no `main`. Se houver conflito no `pnpm-lock.yaml`, aceite qualquer lado e rode `pnpm install` antes de commitar.

**Estado atual do `main`:** monorepo pnpm 12 + Turborepo, TypeScript 6.0.3 strict (`packages/config/tsconfig.base.json`), Biome, Husky + commitlint, Docker Compose (Postgres 17 + PostGIS, Redis, Mailpit) e `packages/shared` (Zod, regras de preço RN-BOOK-01 e RN-BOOK-09).

## Onda 1 — pode rodar em paralelo

As quatro tarefas mexem em pastas diferentes. O único ponto de conflito esperado é o `pnpm-lock.yaml`.

### 0.1 · Esqueleto da API
- **Agente:** `api-engineer`
- **Branch:** `feat/api-skeleton`
- **Roadmap:** "API NestJS: config por env, logger (pino), healthcheck, Swagger, tratamento de erro padrão"

**Prompt**
```
Crie apps/api com NestJS (versão estável mais recente compatível com Node 22+ e TypeScript 6.0.3), como pacote @space-sports/api do monorepo.

Inclua:
- Config por env validada com Zod no boot (falha rápido se faltar variável). Base: .env.example da raiz (DATABASE_URL, REDIS_URL, SMTP_*), mais PORT e NODE_ENV.
- Logger estruturado com pino (nestjs-pino): JSON em produção, pretty em dev, request id por requisição.
- GET /health retornando status e checagem de Postgres e Redis (pode usar @nestjs/terminus).
- Swagger/OpenAPI em /docs, e o JSON em /docs-json. Esse JSON será a fonte do orval depois.
- Filtro global de exceções com formato de erro padrão: { error: { code, message, details? }, requestId }. Erros de validação Zod viram 400 com details por campo.
- Prefixo global /v1.
- Scripts: build, dev, typecheck, test (Vitest), integrados ao turbo.
- Testes: unitário do filtro de erro e e2e do /health (pode usar os serviços do docker compose).

Fora do escopo agora: Drizzle/schema, auth, módulos de negócio.
Ao final: lint, typecheck e testes passando; marque o item no docs/06-roadmap.md; relatório final como definido no seu agente.
```

### 0.2 · Design tokens
- **Agente:** `ui-designer`
- **Branch:** `feat/ui-tokens`
- **Roadmap:** parte de "Definir nome/marca, identidade visual e tokens" (só os tokens; o nome/marca continua pendente)

**Prompt**
```
Crie packages/ui-tokens (@space-sports/ui-tokens) com os tokens do design system, a partir de docs/05-design-system.md (identidade praia/areia: primária quente areia/laranja-sol, secundária azul-mar, fundo claro, modo escuro desde o início; o /super tem cor de destaque própria).

Contrato (web e mobile vão consumir exatamente isto):
- Use os nomes de variáveis da convenção shadcn/ui (--background, --foreground, --primary, --primary-foreground, --secondary, --muted, --accent, --destructive, --border, --input, --ring, --radius, --chart-1..5, --sidebar-*), com valores para :root (claro) e .dark (escuro).
- Exporte: (1) um CSS com as variáveis para a web (Tailwind v4, @theme); (2) os mesmos valores em TS para o NativeWind/React Native; (3) uma variante de destaque para o /super.
- Escala tipográfica, espaçamentos e raios documentados.
- Contraste WCAG AA nos pares texto/fundo, nos dois temas. Inclua um teste (Vitest) que calcula o contraste dos pares principais e falha abaixo de 4.5:1.

Atualize a seção "Diretrizes visuais" do docs/05-design-system.md com a paleta final (hex) e as decisões tomadas.
Não invente nome ou logo da marca: use "Space Sports" como placeholder.
Relatório final como definido no seu agente.
```

### 0.3 · Esqueleto do web
- **Agente:** `web-engineer`
- **Branch:** `feat/web-skeleton`
- **Roadmap:** parte de "Web Next.js com shadcn/ui: layouts /painel (com seletor de espaço) e /super, middleware de acesso"

**Prompt**
```
Crie apps/web (@space-sports/web) com Next.js (App Router, versão estável mais recente), Tailwind v4 e shadcn/ui.

Inclua:
- Três áreas com layouts próprios: (public) com uma home simples; /painel com sidebar (seções do docs/05-design-system.md, só links e páginas vazias) e um seletor de espaço no topo com dados mockados; /super com sidebar e cor de destaque diferente.
- Tema claro/escuro com variáveis da convenção shadcn (--background, --primary etc.). Os tokens reais virão de @space-sports/ui-tokens em paralelo: use os nomes padrão do shadcn para que a troca seja só trocar o import do CSS.
- Middleware de acesso como stub: estrutura pronta para checar sessão e papel (Super para /super), por enquanto liberando tudo em dev, com um TODO apontando a tarefa de auth.
- Estados de carregamento e erro padrão (loading.tsx / error.tsx) nas áreas.
- Scripts build, dev, typecheck, test, integrados ao turbo. Um teste Playwright simples que abre /painel e /super.

Fora do escopo agora: chamadas à API, auth real, telas de negócio.
Relatório final como definido no seu agente.
```

### 0.4 · Esqueleto do mobile
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-skeleton`
- **Roadmap:** "App Expo com Expo Router, NativeWind, RN Reusables, tema claro/escuro"

**Prompt**
```
Crie apps/mobile (@space-sports/mobile) com Expo (SDK estável mais recente, New Architecture), Expo Router, NativeWind e React Native Reusables, funcionando dentro do monorepo pnpm (configure o Metro para workspaces).

Inclua:
- Barra inferior: Explorar · Mapa · Agenda · Torneios · Perfil (telas vazias com título). Deixe preparada uma aba Meu Espaço que só aparece para usuários de gestão (por enquanto, uma flag mockada).
- Tema claro/escuro seguindo o sistema, com os nomes de variáveis da convenção shadcn/RN Reusables. Os tokens reais virão de @space-sports/ui-tokens em paralelo, então isole a definição do tema num único arquivo para facilitar a troca.
- Importe algo de @space-sports/shared (por exemplo, formatCents) numa tela, para provar que o pacote do monorepo resolve no Metro.
- Scripts dev, typecheck, lint e test (jest-expo ou Vitest), integrados ao turbo.
- Confirme que o app sobe (npx expo start) e que o typecheck passa. Se possível, gere um export web ou rode no emulador para validar.

Fora do escopo agora: chamadas à API, auth, EAS.
Relatório final como definido no seu agente.
```

## Onda 2 — fundação de dados, auth e CI

A Onda 1 está no `main`: API (`apps/api`, com `infra/database.module.ts` e `infra/redis.module.ts`), web, mobile, `packages/ui-tokens` e `packages/shared` (preço proporcional).

Ordem:
- **2a (em paralelo, agora):** 0.5, 0.7a, 0.7b e 0.9.
- **2b:** 0.6, depois do merge da 0.5.
- **2c:** 0.8a (cliente orval) primeiro; depois 0.8b (web) e 0.8c (app) em paralelo.

**Estado em 2026-10-27:** 0.5, 0.6, 0.7a, 0.7b, 0.8a, 0.8b, 0.8c e 0.9 estão no `main`; a Onda 2 está concluída. Seguem para tarefas futuras: `GET /v1/auth/providers`, `api-client` em ESM (tirar o alias do react-query no web), job de e2e do web na CI e `BETTER_AUTH_URL` = origem pública do web no deploy. Notas que alimentaram os briefings (relatório e revisão da 0.6):
- Gerar o cliente orval com `SMS_PROVIDER=console`; senão as rotas `/phone-number/*` saem do OpenAPI.
- Web: passar `callbackURL` no cadastro e `redirectTo` no reset de senha; fazer proxy de `/v1` pelo Next (rewrites), porque o middleware não enxerga o cookie do domínio da API.
- App: guardar o token no SecureStore e enviar `Authorization: Bearer`; pedir o nome no primeiro acesso de conta criada por telefone; traduzir os erros do Better Auth pelo `code`.
- `/v1/me` (schema `meResponseSchema` em `@space-sports/shared`) decide `/painel`, `/super` e o modo gestão via `access.management` e `access.super`.

Para a Fase 1 (revisões): guard de espaço respeitar `spaces.status` (suspenso = só leitura, RF-SUPER-03); bloquear conta encerra as sessões; CHECK de `max_players <= 20` (decisão 18).

Fora desta onda, porque dependem de contas que ainda não existem: deploy de staging, Sentry, PostHog e EAS build.

### 0.5 · Schema, migrações e seed
- **Agente:** `api-engineer`
- **Branch:** `feat/db-schema`
- **Plano:** `forte`
- **Roadmap:** "Drizzle + migrações + seed (esportes, amenities, BH, 3 espaços parceiros, usuário Super)"

**Prompt**
```
Configure o Drizzle ORM + drizzle-kit em apps/api e modele o schema do banco a partir de docs/04-modelo-de-dados.md.

Escopo do schema (só o que a Fase 1 usa; Aulas e Torneios ficam para as fases deles):
- Identidade e acesso: users, user_sport_profiles, space_members, devices.
- Catálogo: cities, sports, amenities.
- Espaço: spaces, space_settings, space_opening_hours, space_photos, space_amenities, courts, court_sports, favorites.
- Agenda: court_occupations, com o enum kind completo (BOOKING|CLASS|TOURNAMENT|BLOCK) e a constraint EXCLUDE USING gist (court_id WITH =, period WITH &&) WHERE (active). Habilite as extensões postgis e btree_gist na migração.
- Aluguel: bookings, booking_participants, recurring_bookings, recurring_booking_charges, court_blocks.
- payment_records, onboarding_checklists, notifications, audit_logs.

Convenções (CLAUDE.md e docs/04):
- id uuid v7, created_at/updated_at; dinheiro em *_cents inteiro; datas em timestamptz (UTC).
- Enums do Postgres com os valores do doc.
- spaces.location geography(Point,4326) com índice GiST. A coluna deve ser NULLABLE: os espaços parceiros ainda não têm endereço levantado, e espaço sem localização simplesmente não aparece na busca geográfica.
- Índices para as consultas óbvias: FKs, (space_id, status), bookings por (court_id, starts_at).
- Não crie tabelas de sessão/conta de auth: a tarefa 0.6 (Better Auth) vai acrescentá-las e adaptar users por migração.

Integração:
- Conecte o Drizzle ao DatabaseModule existente (apps/api/src/infra/database.module.ts).
- Scripts no package da API e na raiz via turbo/pnpm: db:generate, db:migrate, db:seed.

Seed (idempotente, pode rodar várias vezes):
- sports: futevolei, beach-tennis, volei-praia.
- amenities: um catálogo genérico curto (ex.: vestiário, estacionamento, bar/lanchonete, iluminação, aluguel de equipamento).
- cities: Belo Horizonte/MG, timezone America/Sao_Paulo.
- Os 3 espaços parceiros de docs/08-espacos-parceiros.md (Astral Beach Sports, Arena Errejota, Arena 7) com SÓ nome, slug, cidade e status ACTIVE. Não invente endereço, localização, telefone, preço, horário nem quadras: esses campos ficam nulos/vazios até a implantação. space_settings pode ser criado com os campos de valor nulos.
- Usuário Super a partir de env (SEED_SUPER_EMAIL, SEED_SUPER_NAME), com platform_role SUPER e sem senha (a 0.6 cuida das credenciais). Documente as variáveis no .env.example.

Testes de integração com Postgres real (docker compose ou Testcontainers):
- a constraint de exclusão rejeita duas ocupações ativas sobrepostas na mesma quadra;
- aceita períodos adjacentes ([10:00,11:00) e [11:00,12:00));
- aceita sobreposição quando uma delas está active=false, e em quadras diferentes;
- o seed roda duas vezes sem duplicar nada.

Fora do escopo: endpoints de negócio, auth.
Ao final: lint, typecheck e testes passando; marque o item no docs/06-roadmap.md; relatório final como definido no seu agente (inclua o diagrama/lista final das tabelas e qualquer desvio do docs/04).
```

### 0.6 · Auth e autorização
- **Agente:** `api-engineer`
- **Branch:** `feat/auth`
- **Plano:** `forte`
- **Depende de:** 0.5 no `main`
- **Roadmap:** "Auth (Better Auth)…" e "Autorização: `platform_role` (Super) + guard por espaço/papel"

**Prompt**
```
Implemente autenticação e autorização na API (RF-AUTH-01, RF-AUTH-04, RN-AUTH-01 a RN-AUTH-04 de docs/02-requisitos-funcionais.md).

Autenticação (Better Auth, integrado ao NestJS):
- A tabela users do schema é a tabela de usuários do Better Auth. Adapte-a por migração do Drizzle (colunas exigidas, ex.: email_verified, image) e acrescente as tabelas de sessão, conta e verificação.
- E-mail + senha funcionando de ponta a ponta. E-mails transacionais (verificação, reset) via SMTP do .env (Mailpit em dev).
- Google, Apple e OTP por telefone: implemente a configuração, mas ligue cada provedor só quando as credenciais estiverem no env. As contas ainda não existem e o provedor de SMS não foi escolhido. Em dev, o OTP pode ser logado no console.
- Sessão por cookie para o web e por token bearer para o app Expo (plugin/adaptação do Better Auth para Expo).
- O seed passa a definir a senha do usuário Super a partir de SEED_SUPER_PASSWORD (documente no .env.example).
- Pontos herdados da revisão da 0.5 (apps/api/src/db/schema/identity.ts):
  - E-mail único sem diferenciar maiúsculas: normalize para minúsculas em todo caminho de escrita e garanta no banco (índice único em lower(email) ou CHECK email = lower(email)).
  - Login só por telefone (RF-AUTH-01): hoje users.email é obrigatório. Torne-o opcional (com unicidade só quando presente) e exija ao menos e-mail ou telefone por CHECK.
  - Exclusão lógica (deleted_at) + e-mail único impede o recadastro. Deixe pronto um helper de anonimização (e-mail/telefone) para a exclusão de conta da Fase 1.

Autorização:
- Guard de plataforma: só platform_role SUPER (RN-AUTH-02).
- Guard de espaço: resolve (userId, spaceId da rota) → papéis ativos em space_members e confere com decorator, ex.: @SpaceRoles('OWNER','ADMIN'). Siga a matriz de permissões de docs/02. Um usuário pode ter papéis diferentes em espaços diferentes (RN-AUTH-03).
- GET /v1/me: dados do usuário, platform_role e vínculos (espaço + papéis), que o web e o app usam para decidir /painel, /super e o modo gestão.
- Todas as rotas de auth e /v1/me precisam aparecer no OpenAPI (/docs-json): a 0.8 gera o cliente com orval a partir dele.

Testes: cadastro e login por e-mail, sessão por cookie e por bearer, guard Super (permite/nega), guard de espaço (papel certo no espaço certo, papel em outro espaço não vale), /v1/me.
Fora do escopo: telas de login (0.8), exclusão de conta (Fase 1).
Ao final: lint, typecheck e testes passando; marque os itens no docs/06-roadmap.md; relatório final como definido no seu agente (inclua as variáveis de env novas e o contrato de /v1/me).
```

### 0.7a · Tokens no web
- **Agente:** `web-engineer`
- **Branch:** `feat/tokens-web`
- **Plano:** `economico`
- **Roadmap:** sub-item "_(… tokens em 0.7)_" do esqueleto web

**Prompt**
```
Integre @space-sports/ui-tokens ao apps/web, substituindo as cores, tipografia, espaçamento e raios provisórios do tema shadcn/ui.

- Use o preset/variáveis gerados pelo pacote (veja packages/ui-tokens e docs/05-design-system.md); não edite packages/ui-tokens. Se faltar algo no pacote, registre no relatório em vez de contornar.
- Tema claro/escuro funcionando, e a variante Super aplicada nas rotas /super.
- Ajuste os componentes existentes que usam cor fixa para usar os tokens.
- Garanta que build, typecheck e lint passam.

Fora do escopo: telas novas, auth.
Ao final: marque o sub-item no docs/06-roadmap.md; relatório final como definido no seu agente.
```

### 0.7b · Tokens no mobile
- **Agente:** `mobile-engineer`
- **Branch:** `feat/tokens-mobile`
- **Plano:** `economico`
- **Roadmap:** item do app Expo (tema claro/escuro com os tokens reais)

**Prompt**
```
Integre @space-sports/ui-tokens ao apps/mobile, substituindo o placeholder em apps/mobile/src/theme/theme.ts.

- Use o que o pacote exporta para NativeWind/React Native Reusables (veja packages/ui-tokens e docs/05-design-system.md); não edite packages/ui-tokens. Se faltar algo no pacote, registre no relatório em vez de contornar.
- Tema claro/escuro seguindo o sistema, com tipografia, espaçamentos e raios dos tokens.
- Confirme que o Metro resolve o pacote (o app sobe com npx expo start) e que typecheck, lint e testes passam.

Fora do escopo: telas novas, auth.
Ao final: relatório final como definido no seu agente.
```

### 0.9 · CI
- **Agente:** `qa-engineer`
- **Branch:** `ci/github-actions`
- **Plano:** `economico`
- **Roadmap:** "CI GitHub Actions (lint, typecheck, test, build)" (sem deploy/EAS por enquanto)

**Prompt**
```
Crie a CI em .github/workflows para o monorepo (pnpm + Turborepo).

- Gatilhos: push no main e pull requests.
- Jobs: instalar com pnpm (lockfile congelado, cache do store), biome check, typecheck, test (unit) e build, via turbo com cache.
- Um job de testes de integração/e2e da API com services Postgres (imagem com PostGIS, igual ao docker-compose.yml) e Redis.
- Versões de Node e pnpm iguais às do package.json (engines/packageManager).
- O repositório ainda não tem remoto no GitHub: valide a sintaxe localmente (actionlint, se disponível) e rode os mesmos comandos localmente para garantir que passam.

Fora do escopo: deploy de staging, EAS build, Sentry e PostHog (as contas ainda não existem). Não altere código de produção; se algum comando falhar por causa do código, registre no relatório.
Ao final: marque o item como parcial no docs/06-roadmap.md (CI feita, deploy/EAS pendentes); relatório final como definido no seu agente.
```

### 0.8a · Cliente da API (orval + TanStack Query)
- **Agente:** `api-engineer`
- **Branch:** `feat/api-client`
- **Roadmap:** "Geração do cliente (orval) + hooks TanStack Query"

**Prompt**
```
Crie packages/api-client (@space-sports/api-client) com o cliente tipado gerado pelo orval a partir do OpenAPI da API (/docs-json), usado por web e mobile.

- Script `generate` que sobe/importa o OpenAPI da API com SMS_PROVIDER=console (senão as rotas /phone-number/* saem do documento) e gera o cliente. Prefira gerar a partir de um arquivo openapi.json exportado por um script da API (sem precisar de servidor no ar) e versionar o resultado gerado.
- Saída: funções fetch tipadas + hooks TanStack Query (react-query v5) por operação, incluindo /v1/me e as rotas de auth documentadas.
- Mutator de fetch customizado, configurável por quem usa: baseUrl, e um hook para injetar headers (o app manda `Authorization: Bearer`) ou usar `credentials: 'include'` (o web usa cookie). Erros seguem o formato padrão { error: { code, message, details? }, requestId } e viram uma classe ApiError tipada.
- Reexporte os schemas Zod relevantes de @space-sports/shared quando fizer sentido (ex.: meResponseSchema) em vez de duplicar tipos.
- Um check no CI/turbo (`generate:check`) que falha se o cliente versionado estiver desatualizado em relação à API.
- Teste (Vitest) do mutator: injeção de header, ApiError, baseUrl.

Fora do escopo: telas e integração nos apps (0.8b e 0.8c), better-auth client (cada app configura o seu).
Ao final: lint, typecheck e testes passando; marque o item no docs/06-roadmap.md; relatório final como definido no seu agente (inclua como usar o cliente em web e mobile).
```

### 0.8b · Login e sessão no web
- **Agente:** `web-engineer`
- **Branch:** `feat/auth-web`
- **Depende de:** 0.8a no `main`
- **Roadmap:** "Auth … sessão no app e na web" (lado web) e middleware de acesso real

**Prompt**
```
Integre a autenticação real da API (Better Auth, /v1/auth) ao apps/web, usando @space-sports/api-client e o better-auth client.

- Proxy de /v1 pelo Next (rewrites para a API): o middleware (proxy.ts) não enxerga o cookie do domínio da API, então o web fala com a API pelo mesmo domínio.
- Telas públicas: entrar (e-mail/senha; botões Google/Apple só aparecem se o provedor estiver habilitado), cadastro, esqueci/redefinir senha, verificação de e-mail. Passe `callbackURL` no cadastro e `redirectTo` no reset. Traduza os erros do Better Auth pelo `code` para PT-BR.
- proxy.ts real: sem sessão → /entrar; /super só com access.super; /painel só com access.management (via GET /v1/me, schema meResponseSchema). Redirecione conforme o perfil após o login.
- Seletor de espaço do /painel alimentado por /v1/me (substitui o mock). Sair (logout) no menu.
- QueryClientProvider e tema/tokens existentes preservados.
- Testes: unitários dos helpers e e2e Playwright do login (Mailpit para verificação, se prático), e do redirecionamento por perfil.

Fora do escopo: telas de negócio, exclusão de conta, OTP por telefone no web.
Ao final: lint, typecheck, testes e build passando; marque os itens no docs/06-roadmap.md; relatório final como definido no seu agente.
```

### 0.8c · Login e sessão no app
- **Agente:** `mobile-engineer`
- **Branch:** `feat/auth-mobile`
- **Depende de:** 0.8a no `main`
- **Roadmap:** "Auth … sessão no app e na web" (lado app)

**Prompt**
```
Integre a autenticação real da API (Better Auth, /v1/auth) ao apps/mobile, usando @space-sports/api-client e o plugin Expo do better-auth client.

- Guarde o token no expo-secure-store e envie `Authorization: Bearer` via o mutator do api-client.
- Fluxo no Expo Router: onboarding/entrar, cadastro, esqueci a senha, verificação de e-mail, OTP por telefone (código logado no console em dev). Google/Apple só aparecem se o provedor estiver habilitado. Peça o nome no primeiro acesso de conta criada por telefone. Traduza os erros do Better Auth pelo `code` para PT-BR.
- Rotas protegidas por sessão; use GET /v1/me (meResponseSchema) para decidir o modo gestão via access.management. Sair (logout).
- QueryClientProvider; tema/tokens existentes preservados.
- Testes (jest) de storage do token, mapeamento de erros e guarda de rotas.

Fora do escopo: telas de negócio, exclusão de conta, build EAS.
Ao final: lint, typecheck e testes passando; marque os itens no docs/06-roadmap.md; relatório final como definido no seu agente.
```

## Prompt de revisão (para todas as tarefas)
- **Agente:** `code-reviewer`, no mesmo worktree da tarefa

```
Revise o branch atual contra o main (git diff main...HEAD). A tarefa está descrita em docs/tarefas/fase-0.md, seção <número>. Verifique se o escopo foi cumprido, se o código ficou dentro das pastas do agente, se lint, typecheck e testes passam (rode-os), e aplique o seu checklist. Liste os achados separando "bloqueia o merge" de "sugestão".
```

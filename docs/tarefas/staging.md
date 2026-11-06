# Staging na AWS — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Contexto em `docs/09-infra-aws.md` e nas decisões 54 a 56 de `docs/07-perguntas-em-aberto.md`.

**Plano padrão:** `forte`

**Ordem:** Onda 1 (S.1 e S.2 em paralelo) → Onda 2 (S.3). A sessão principal cria os recursos na AWS depois da revisão da S.3.

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz e o `docs/09-infra-aws.md` antes de começar. Documentação em português (BR); código em inglês.
- Máquina com pouca RAM. Máximo de 2 workers nos testes, SEMPRE explícito na linha de comando, `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados, Playwright com 1 worker e só das specs afetadas. Nunca derrube nem reutilize processos nas portas 3000, 3333 e 8081; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Não crie recursos na AWS, não faça push e não mexa em regras de negócio.
- Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português) e relate o que ficou de fora.

## Onda 1 — Base do deploy

### S.1 · CI: Mailpit no E2E real do web
- **Agente:** `qa-engineer`
- **Branch:** `fix/ci-e2e-mailpit`

**Prompt**
```
A execução 41322022434 do CI (commit 223eb5e) falhou no job web-e2e-real de .github/workflows/ci.yml: 3 testes falharam com `connect ECONNREFUSED ::1:8025` e 17 não rodaram, porque os specs de apps/web/e2e/real leem e-mails pelo Mailpit e o job não sobe esse serviço. Os specs são pos-piloto-aulas.spec.ts:52, pos-piloto-contatos.spec.ts:240 e pos-piloto-equipe.spec.ts:84.

Adicione o Mailpit como serviço do job (imagem axllent/mailpit, portas 1025 e 8025), com healthcheck se a imagem permitir. Confira em apps/web/playwright.real.config.ts e em apps/web/e2e/real/support/env.ts se a API sobe com SMTP_HOST e SMTP_PORT apontando para ele e se os specs usam a porta certa; ajuste as variáveis do job se faltar algo. Veja também por que os 17 testes não rodaram (provavelmente specs em sequência) e confirme que nada mais depende de serviço ausente.

Valide localmente com o Mailpit do docker compose rodando as três specs citadas contra a API real, conforme a config, usando portas próprias e um banco terminado em _e2e. Não altere código de produção. A validação final no runner é feita pela sessão principal por PR.
```

### S.2 · Dockerfiles da API e do web
- **Agente:** `api-engineer`
- **Branch:** `feat/docker-images`

**Prompt**
```
Crie as imagens de produção da API e do web, que ainda não existem. Decisão 56 de docs/07-perguntas-em-aberto.md: elas vão para o ECR, construídas na CI, e rodam numa instância EC2 em Docker, junto com Redis e Caddy. Não crie compose de servidor nem infraestrutura: isso é de uma tarefa posterior.

apps/api/Dockerfile: build em múltiplos estágios a partir da raiz do monorepo (pnpm + Turborepo, versão do Node de .nvmrc, build com `pnpm deploy` ou equivalente, só o necessário na imagem final, usuário sem root). A mesma imagem precisa executar, além do `node dist/main.js`, as migrações e os seeds: `db:migrate`, `db:seed` e `db:seed:demo` hoje rodam com tsx a partir de src/db/scripts. Escolha o caminho mais simples, seja compilando esses scripts ou incluindo o tsx e as fontes necessárias, e documente o comando de cada um. A pasta drizzle/ com as migrações vai na imagem.

apps/web/Dockerfile: mesmo padrão, com Next em `output: 'standalone'`, sem quebrar `next dev` nem o E2E (next.config.ts usa distDir por variável). API_URL entra no rewrite no momento do build, então precisa ser build arg; confira também o uso em tempo de execução em src/lib/auth/server-session.ts e o SITE_URL. Inclua os assets estáticos e public/.

Adicione .dockerignore na raiz, sem levar .env, node_modules, dist nem .next. Nenhum segredo pode entrar em camada da imagem. Inclua HEALTHCHECK usando a rota de saúde existente na API e uma rota simples no web. As imagens precisam construir em amd64 e arm64: confira dependências nativas. Esta máquina tem `docker build` sem buildx.

Valide de verdade: construa as duas imagens, suba-as contra o Postgres e o Redis do docker compose (portas próprias, banco próprio), rode as migrações pela imagem da API, confira /health e o login por uma página do web passando pelo rewrite. Se a RAM não permitir o build do web, diga isso claramente, sem declarar validado. Remova contêineres e imagens de teste ao terminar. Documente em apps/api/README.md como construir e rodar. Rode lint e typecheck.
```

## Onda 2 — Infraestrutura do staging

### S.3 · CDK, compose do servidor e deploy do staging
- **Agente:** `api-engineer`
- **Branch:** `feat/staging-infra`

**Prompt**
```
Crie a infraestrutura como código do staging. Leia primeiro `git show main:docs/09-infra-aws.md`, `git show main:docs/tarefas/staging.md` (seção "Pontos para a tarefa de deploy") e a decisão 56 com `git show main:docs/07-perguntas-em-aberto.md`, porque esses docs podem não estar no seu branch. Leia também apps/api/README.md, seção das imagens, e os Dockerfiles.

NÃO rode `cdk deploy`, `cdk bootstrap` nem crie nada na AWS. Valide só com `cdk synth`, testes e `docker compose config`. Staging é pequeno e barato, só para testes, com dados descartáveis.

(1) Pasta infra/, pacote do workspace, CDK em TypeScript. Conta 123456789012, região sa-east-1, sem conta fixa no código de outra forma que não seja configuração. Recursos: uma EC2 t4g.small arm64 em subnet pública, SEM NAT Gateway, disco gp3 de 20 GB criptografado, Elastic IP, IMDSv2 obrigatório, security group só com 80 e 443 de entrada e sem SSH (acesso por SSM Session Manager); perfil IAM da instância com o mínimo para ECR, Parameter Store do prefixo /space-sports/staging/ e SSM; repositórios ECR space-sports/api e space-sports/web com lifecycle guardando poucas imagens; zona Route 53 de spacesports.com.br com registros A para staging. e api-staging. apontando para o Elastic IP; provedor OIDC do GitHub e papel de deploy restrito ao repositório Space-Sports-Apps/mobile-web, branch main, com permissões mínimas. O nome do repositório é exatamente esse. O bootstrap da instância instala Docker e cria 2 GB de swap.

(2) infra/staging/compose.yml para o servidor: api (nome do serviço `api`, porta 3333, com os workers por JOBS_ENABLED), web, redis (com `maxmemory-policy noeviction` e persistência), postgres e caddy, com volumes persistentes, restart, limites de memória coerentes com 2 GB e rede interna; só o Caddy expõe portas. O Postgres precisa de PostGIS e btree_gist na versão 17. ATENÇÃO: confira se a imagem postgis/postgis:17-3.5 tem arm64; se não tiver, escolha alternativa confiável (imagem própria com pacote do PostGIS, por exemplo) e registre o motivo. Caddyfile: staging.spacesports.com.br para o web, api-staging.spacesports.com.br para a API, HTTPS automático. Segredos vêm do Parameter Store em arquivos de env fora do repositório, nunca na imagem nem no compose. Em staging, ALLOW_DEMO_SEED=true só no env de seed, e NODE_ENV=production na API (veja no README como rodar o seed demo). Liste todas as variáveis e os parâmetros necessários em infra/README.md. O web é construído com API_URL=http://api:3333.

(3) .github/workflows/deploy-staging.yml: dispara depois do CI verde no main (workflow_run) e manualmente; assume o papel por OIDC, constrói as duas imagens em arm64 e publica no ECR com a tag do commit, e aplica por SSM Run Command, rodando as migrações pela imagem da API antes de trocar os serviços e parando se falharem. Confira se o runner ubuntu-24.04-arm está disponível para repositório privado de organização neste plano; se não, use QEMU e documente o tempo esperado. Pule o deploy sem falhar enquanto a variável de repositório AWS_DEPLOY_ROLE_ARN não existir.

(4) scripts simples para ligar e desligar a instância de staging, para economizar, e o passo a passo de primeiro deploy em infra/README.md, incluindo seed de demonstração, `CREATE EXTENSION` conferido e checagem de memória. Aponte o que depende do usuário: nameservers no Registro.br e credenciais do Resend.

Use pnpm install só se precisar e regenere o lockfile. Rode lint e typecheck na raiz e teste o CDK com asserções sobre o que importa: sem SSH, IMDSv2, sem NAT, OIDC restrito ao repositório e ao main.
```

## Pontos para a tarefa de deploy

- **TLS no RDS (só para production, o staging usa Postgres em Docker):** o código não configura `ssl` e a imagem não traz a CA do RDS. Incluir o bundle de CA da AWS, definir `NODE_EXTRA_CA_CERTS` e usar `sslmode=verify-full`, sem `no-verify`. O grupo de parâmetros padrão do Postgres 17 em `sa-east-1` traz `rds.force_ssl=1`; a conexão em si ainda não foi testada contra um RDS.
- **`API_URL` do web:** o rewrite é fixado no build. O compose do servidor precisa do serviço `api` na porta 3333, ou a imagem precisa ser reconstruída com outro valor.
- **arm64:** a instância prevista, `t4g`, é Graviton, e o build nessa arquitetura ainda não rodou. Fazer esse build antes do deploy.

## Prompt de revisão (para todas as tarefas)
- **Agente:** `code-reviewer`, no mesmo worktree da tarefa

```
Revise o branch atual contra o main (git diff main...HEAD). A tarefa está descrita em docs/tarefas/staging.md, seção <número>, com as decisões 55 e 56 de docs/07-perguntas-em-aberto.md. Verifique se o escopo foi cumprido, se lint e typecheck passam, se nenhum segredo entra em imagem ou log, e aplique o seu checklist. Liste os achados separando "bloqueia o merge" de "sugestão".
```

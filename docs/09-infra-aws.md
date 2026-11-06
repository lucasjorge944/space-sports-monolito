# 09 · Infraestrutura na AWS

Estado da conta AWS e ponto de partida para o plano de configuração do ambiente. A hospedagem na AWS é a decisão 55, e os serviços e a região são a decisão 56 de `07-perguntas-em-aberto.md`. A seção 4 registra o que foi escolhido.

Situação em 2026-11-02. Staging criado na conta-membro: instância `<id-da-instancia>`, IP `<ip-do-staging>`, com o primeiro deploy em arm64 aplicado, PostGIS 3.6.4 e seed de demonstração. Os registros do Resend foram criados à mão no Route 53, fora do CDK.

## 1. O que já foi feito

| Item | Estado |
|---|---|
| Conta AWS | `210987654321` |
| IAM Identity Center | Ativado em `sa-east-1` (São Paulo), instância de região única, com chave de propriedade da AWS. Sem réplica fora do Brasil e sem custo de KMS |
| AWS Organizations | Organização `o-1600p1azq9`, criada junto com o Identity Center. A conta acima é a **conta de gerenciamento** |
| Conta-membro | `123456789012` (`space-sports-workloads`), para os ambientes. E-mail root: `<e-mail-root-da-conta-membro>`. Criada em 2026-11-02 |
| Usuário administrativo | `lucas`, com o conjunto de permissões `AdministratorAccess` (sessão de 8 horas) |
| Portal de acesso | `https://d-946752b6a1.awsapps.com/start` |
| AWS CLI | v2 instalado na máquina de desenvolvimento, perfil `default` por SSO, região `sa-east-1` |
| Orçamento | `space-sports-mensal`: US$ 50/mês, avisos em 80% e 100% do gasto real para `<e-mail-do-responsavel>`. Só avisa, não bloqueia nada |
| Domínio | `spacesports.com.br` registrado (decisão 54), nameservers no Route 53 desde 2026-11-02 |
| GitHub | Repositório privado `Space-Sports-Apps/mobile-web`, `main` publicado. O OIDC do deploy usa esse nome exato |

### Como acessar
- Terminal: `aws sso login` renova a sessão (ela expira em 8 horas). Confira com `aws sts get-caller-identity`.
- `aws configure sso` é interativo: rode num terminal normal, não com `!` no Claude Code.
- Console: entre pelo portal de acesso. A conta root fica só para o que exige root.

## 2. Pendências antes do primeiro recurso

- [x] **Ativar o MFA da conta root.** Ativado em 2026-11-02.
- [x] **Decidir serviços e região.** Decisão 56.
- [x] **Conferir a versão 17 do Postgres no RDS e o custo em `sa-east-1`.** Ver a seção 4.
- [x] **Criar a conta-membro.** `123456789012`.
- [x] **Corrigir a CI.** Tarefa S.1, PR #1: 70 de 70 testes no E2E web. O deploy deve depender da CI verde.
- [x] **Criar os Dockerfiles** da API e do web. Tarefa S.2.

## 3. O que a AWS pode cobrir no projeto

| Necessidade | Serviço | Observações |
|---|---|---|
| DNS | Route 53 | Apontar os nameservers no Registro.br para ele |
| HTTPS | ACM, com ALB ou CloudFront; ou Caddy na própria instância | O ACM exige ALB ou CloudFront na frente |
| Postgres com PostGIS | RDS for PostgreSQL | Precisa de `postgis` e `btree_gist` (exclusão de horários em `court_occupations`). Conferir a disponibilidade da versão 17, usada no projeto |
| Redis | ElastiCache ou container | O BullMQ exige `maxmemory-policy noeviction` |
| API e workers | Lightsail, EC2 ou ECS Fargate | Mesmo processo; `JOBS_ENABLED` liga os workers |
| Web (Next.js) | Lightsail, EC2 ou ECS Fargate | A decisão 55 tira a Vercel do plano |
| Imagens Docker | ECR | Build na CI, sem instalar dependências no servidor |
| Fotos (espaços, perfil e anúncios) | S3 com CloudFront | Decisão 72. Bucket privado por ambiente em `sa-east-1`, lido pelo CloudFront com Origin Access Control só em `spaces/`, `users/` e `ads/`; `uploads/` expira em 1 dia. A API acessa por um papel IAM, sem chaves. Staging no domínio `*.cloudfront.net`, production em `media.spacesports.com.br`. Ver a seção 8 |
| Segredos | Systems Manager Parameter Store | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ADS_DELIVERY_SECRET` (tokens de entrega dos anúncios), `SMTP_*` etc. As fotos não precisam de segredo |
| Deploy pela CI | GitHub OIDC + papel IAM | Evita guardar chaves da AWS no GitHub |
| Logs e alarmes | CloudWatch | Complementa o Sentry, que ainda não está instalado |
| Backups | Backups automáticos do RDS | Dados reais de pessoas, sujeitos à LGPD |
| E-mail | SES (alternativa ao Resend) | A API usa SMTP, então a troca é só de configuração. O SES exige sair do sandbox |
| SMS do OTP | AWS End User Messaging | Exige código novo: `SMS_PROVIDER` só aceita `console` e `none` |

### O que continua fora da AWS
- **Fotos:** saíram do Cloudflare R2 para o **S3 com CloudFront** pela decisão 72 (2026-11-03), tarefas C.1 e C.3 de `docs/tarefas/conta-1.md`. O staging nunca teve R2 configurado, então não houve migração. Detalhes na seção 8.
- **E-mail:** Resend é a recomendação para o piloto, pela configuração mais simples e pelos eventos de entrega prontos.
- **Push:** Expo. **Builds do app:** EAS. **Erros e produto:** Sentry e PostHog.

## 4. Decisão 56

| Tema | Escolha | Motivo |
|---|---|---|
| Região | `sa-east-1` | Latência para BH e dados no Brasil, apesar de ser mais cara que as regiões dos EUA |
| Computação | Uma instância EC2 com API, workers, web e Redis em Docker, e Caddy para HTTPS | Simples e barata para 3 espaços; o perfil IAM da instância simplifica o ECR e o deploy |
| Banco | RDS com backups automáticos em production; Postgres em Docker no staging | Em production é o dado mais difícil de recuperar; no staging os dados são descartáveis |
| Contas | Uma conta-membro para os ambientes, fora da conta de gerenciamento | Recomendação da própria AWS, e o Organizations já existe |
| Evolução | ECS Fargate, ALB e ElastiCache quando o volume justificar | Custo bem maior, sem necessidade no piloto |

### Staging enxuto (2026-11-02)

O staging serve só para testes, então usa uma `t4g.small` com API, workers, web, Redis, Postgres com PostGIS e Caddy em Docker, sem RDS, e fica desligado quando não estiver em uso: desliga sozinho às 20h de Brasília e é ligado à mão. Os dados são descartáveis, sem backup. Com 3 horas por dia, o custo estimado é de cerca de US$ 10/mês.

| Situação | Mês |
|---|---|
| Ligado o mês todo (EC2, disco, IPv4 e Route 53) | cerca de US$ 27 |
| Desligado o mês todo (disco, IPv4 e Route 53) | cerca de US$ 7 |

Com o RDS, como em production, o ambiente custa o valor da tabela abaixo.

### Custo validado com RDS (AWS Price List, `sa-east-1`, 2026-11-02)

| Item | Preço | Mês (730 h) |
|---|---|---|
| EC2 `t4g.small` (2 GB, arm64) | US$ 0,0268/h | US$ 19,56 |
| RDS `db.t4g.micro`, Single-AZ | US$ 0,034/h | US$ 24,82 |
| Disco do RDS, 20 GB gp3 | US$ 0,219/GB-mês | US$ 4,38 |
| Disco da EC2, 20 GB gp3 | US$ 0,152/GB-mês | US$ 3,04 |
| IPv4 público | US$ 0,005/h | US$ 3,65 |
| Zona no Route 53 | US$ 0,50/mês | US$ 0,50 |
| **Total** | | **cerca de US$ 56/mês por ambiente** |

Não inclui transferência de dados, ECR e CloudWatch, que devem ser pequenos no piloto. Com `t4g.medium` (4 GB, US$ 39,13/mês), o total sobe para cerca de US$ 75. Esse valor passa do orçamento atual de US$ 50, o que importa quando production for criado.

### Conferido na conta (2026-11-02)
- RDS em `sa-east-1` oferece PostgreSQL 17.5 a 17.11 e as classes `db.t4g`.
- O grupo de parâmetros padrão do Postgres 17 traz `rds.force_ssl=1`, então a conexão exige TLS.
- As extensões `postgis` e `btree_gist` não foram testadas: confirmar com `CREATE EXTENSION` ao criar o banco.

## 5. Demais escolhas

- **Contas:** staging e production na mesma conta-membro.
- **Subdomínios:** `app.` e `api.` em produção; `staging.` e `api-staging.` no staging.
- **E-mail:** Resend.
- **Infraestrutura como código:** CDK em TypeScript.

## 6. Depois da infraestrutura

- **Aplicação:** preencher `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `WEB_URL`, `SITE_URL` e `SMTP_FROM` (ainda `spacesports.local`), e definir o `metadataBase` global do web.
- **E-mail:** SPF, DKIM e DMARC no domínio.
- **Mobile:** links universais (`associatedDomains`, `intentFilters`, `apple-app-site-association`, `assetlinks.json`).
- **Fotos:** a expiração de 1 dia em `uploads/` está no bucket do CDK (seção 8), sem passo manual.
- **Critério de saída da Fase 0:** login no app, no painel e no Super contra a API em staging, com a CI verde.

## 7. Login com Google (OAuth)

Configurado em 2026-11-03 no Google Cloud, projeto `space-sports-513612` (Google Auth Platform), para o **staging e o dev**. Decisão 71 e tarefa C.0 de `docs/tarefas/conta-1.md`.

| Item | Valor |
|---|---|
| Tela de consentimento | App "Space Sports", público **Externo**, em **modo de teste**: só os usuários de teste cadastrados (até 100) conseguem entrar |
| E-mail de notificações do projeto | `<e-mail-do-projeto>` |
| E-mail de suporte | `<e-mail-de-suporte>`. O Google só aceita a conta logada ou um Grupo do Google; para trocar por `<e-mail-do-projeto>`, dar a essa conta o papel de Proprietário no IAM e mudar em **Branding** logado com ela |
| Cliente OAuth | "Space Sports API", tipo **Aplicativo da Web**. O app usa o mesmo cliente, porque o login passa pelo navegador e pela API (plugin Expo do Better Auth) |
| Origens JavaScript | `https://staging.spacesports.com.br`, `http://localhost:3000` |
| URIs de redirecionamento | `https://api-staging.spacesports.com.br/v1/auth/callback/google`, `http://localhost:3333/v1/auth/callback/google` |
| Segredos | `/space-sports/staging/api/GOOGLE_CLIENT_ID` e `/space-sports/staging/api/GOOGLE_CLIENT_SECRET` no Parameter Store (`SecureString`) |
| Ligar nas telas | Web: `AUTH_PROVIDERS=google` no serviço `web` do compose. App: `EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS=google` no EAS |

### Pendente para production
- [ ] Criar um **cliente OAuth próprio de production** (não reutilizar o do staging), com origem `https://app.spacesports.com.br` e redirecionamento `https://api.spacesports.com.br/v1/auth/callback/google`.
- [ ] Gravar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` em `/space-sports/production/api/` no Parameter Store.
- [ ] Ligar `AUTH_PROVIDERS=google` no web de production e `EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS=google` no perfil `production` do EAS.
- [ ] **Publicar o app** na tela de consentimento (sair do modo de teste). O Google exige domínio verificado (`spacesports.com.br` no Search Console), página inicial, **política de privacidade** e termos de uso publicados (pendência da Fase 0) e logo. Os escopos usados (`openid`, `email`, `profile`) não são sensíveis: a verificação de marca costuma ser rápida, mas reserve alguns dias.
- [ ] Trocar o e-mail de suporte para `<e-mail-do-projeto>` (ver acima).
- [ ] Antes de publicar no iOS: **Entrar com Apple** é obrigatório quando há login com Google (diretriz 4.8 da App Store); o código existe (`APPLE_*`).

## 8. Fotos no S3 com CloudFront (decisão 72, 2026-11-03)

Criado pelo CDK na stack `SpaceSportsStaging` (tarefa C.3). Configuração, aplicação e conferência em `infra/README.md`, seção "Fotos (S3 e CloudFront)".

| Item | Staging | Production (a criar) |
|---|---|---|
| Bucket | `space-sports-media-staging-123456789012`, `sa-east-1` | `space-sports-media-production-<conta>` |
| Domínio | `*.cloudfront.net` (saída `MediaDistributionDomainName`) | `media.spacesports.com.br`, com certificado do ACM em `us-east-1` |
| CORS do upload pelo web | `https://staging.spacesports.com.br` e `http://localhost:3000` | `https://app.spacesports.com.br` |
| Acesso da API | Papel `space-sports-staging-media`, assumido pelo host e entregue ao contêiner | Mesmo esquema |

- **Bucket privado.** Block Public Access total, SSE-S3, TLS obrigatório, sem versionamento e mantido na conta se a stack for removida.
- **Prefixos.** A API envia para `uploads/` (expira em 1 dia), confere a imagem e copia para `spaces/` (fotos e logos dos espaços), `users/` (foto de perfil) ou `ads/` (imagens das peças de anúncio, em `ads/<campaignId>/`, decisões 73 a 79). Só esses três chegam ao CloudFront; `uploads/` nunca.
- **Sem chaves.** O papel da instância não chega aos contêineres (limite de saltos 1 no serviço de metadados), então o host assume um papel só das fotos e entrega à API credenciais de 1 hora, renovadas a cada 15 minutos.
- **Configuração da API.** A stack grava `S3_BUCKET`, `S3_REGION` e `S3_PUBLIC_URL` em `/space-sports/staging/api/` (tipo `String`), e o deploy os leva ao env da API. Os três chegam juntos, depois do `cdk deploy`; antes, o upload responde 503.
- **Foto apagada no cache: até 1 dia, sem invalidação por enquanto.** A política `CachingOptimized` guarda cada foto por 1 dia nos pontos de presença. Quando a API apaga uma foto (troca, remoção ou anonimização pela LGPD), o objeto sai do S3 na hora, mas a cópia em cache pode seguir acessível por até 1 dia, na mesma URL. A URL tem UUID e não é mais referenciada pela plataforma, e a API não invalida o cache por enquanto. Se um pedido do titular exigir remoção imediata, a invalidação é manual (`infra/README.md`, "Cache e remoção"; as primeiras 1.000 rotas por mês não são cobradas).

### Custo (AWS Price List, `sa-east-1`, 2026-11-03)

| Item | Preço |
|---|---|
| S3 Standard, armazenamento | US$ 0,0405 por GB-mês |
| S3, `PUT`, `COPY`, `POST` e `LIST` | US$ 0,007 por 1.000 |
| S3, `GET`, `HEAD` e demais | US$ 0,0056 por 10.000 |
| S3 para o CloudFront | Sem custo de transferência |
| CloudFront, transferência para a internet (América do Sul) | US$ 0,110 por GB, nos primeiros 10 TB |
| CloudFront, requisições HTTPS (América do Sul) | US$ 0,022 por 10.000 |

O CloudFront pago por uso tem um nível gratuito permanente de 1 TB e 10 milhões de requisições por mês, por conta, dividido entre staging e production. No piloto (3 espaços), as fotos somam bem menos de 1 GB, e mesmo 50 GB e 500 mil visualizações por mês ficam no nível gratuito; fora dele, seriam cerca de US$ 6,60/mês. **Estimativa: menos de US$ 0,10/mês por ambiente**, o que não muda os totais da seção 4.

## 9. Pagamento online no staging (decisões 80 a 97, 2026-11-04)

O gateway real ainda não foi escolhido (decisão 80): o staging usa o **gateway simulado** (`PAYMENTS_PROVIDER=fake`), que não cobra nada nem sai para a internet.

| Item | Como fica |
|---|---|
| Provedor | `PAYMENTS_PROVIDER: fake` e `DEPLOY_ENV: staging` em `infra/staging/compose.yml`. A API recusa subir com o fake e `NODE_ENV=production` sem `DEPLOY_ENV=staging`; em produção o padrão é `none` (pagamento online desligado) até o provedor real |
| Webhooks | O fake entrega os webhooks à própria API pela fila (`payments`, no Redis), em `http://127.0.0.1:3333/v1/webhooks/payments/fake`, dentro do contêiner. Nada de porta nova nem regra de segurança |
| Documento cifrado | `PAYMENTS_DATA_KEY` (32 bytes em base64, `openssl rand -base64 32`) em `/space-sports/staging/api/PAYMENTS_DATA_KEY` (`SecureString`), **obrigatório**: o staging roda com `NODE_ENV=production` e a API não sobe sem a chave (o `fetch-env.sh` para o deploy antes). Ela cifra o CPF/CNPJ do cadastro no gateway (AES-256-GCM, decisão 97), lido só no relatório fiscal do Super. Nunca trocar nem apagar: os documentos gravados ficariam ilegíveis |
| Segredo | `PAYMENTS_FAKE_WEBHOOK_SECRET` é opcional: sem ele, a API gera uma chave a cada boot (a assinatura é feita na entrega, então basta com uma instância). Se houver mais de uma instância, gravar em `/space-sports/staging/api/PAYMENTS_FAKE_WEBHOOK_SECRET` (`SecureString`) |
| Jobs | Com `JOBS_ENABLED`, a fila `payments` vence holds e Pix a cada minuto, reconcilia a cada 10 minutos e roda o repasse diário do fake às 06:00 (America/Sao_Paulo) |
| Seed | `docker compose run --rm seed` cria a "Arena Demonstração (fictícia)" com o cadastro aprovado, os modos ativos e cobranças pagas e estornadas (contas `dono.demo@exemplo.com` e `jogador.demo@exemplo.com`). Não toca nos parceiros de `08-espacos-parceiros.md` |
| Testes manuais | Cartões de teste e o documento de recusa vêm da API (`paymentEnvironment.sandbox`); o Pix é pago pelo simulador do `/super` |

### Pendente para production
- [ ] Escolher o provedor real (Asaas, Pagar.me, Mercado Pago…), implementar o adaptador em `apps/api/src/payments/gateways/<provedor>/` e acrescentar o valor em `PAYMENTS_PROVIDER`.
- [ ] Credenciais do provedor e a chave dos webhooks dele em `/space-sports/production/api/` no Parameter Store.
- [ ] `PAYMENTS_DATA_KEY` própria de production (`openssl rand -base64 32`) em `/space-sports/production/api/`, com cópia de segurança fora da AWS: perder a chave perde os documentos para a NFS-e.
- [ ] URL pública dos webhooks (`https://api.spacesports.com.br/v1/webhooks/payments/<provedor>`) cadastrada no painel do provedor.

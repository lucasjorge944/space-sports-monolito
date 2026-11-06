# Infraestrutura (`@space-sports/infra`)

Infraestrutura como código do staging na AWS: CDK em TypeScript, o compose do servidor e os scripts
de deploy. Contexto em `docs/09-infra-aws.md` e nas decisões 56 (staging) e 72 (fotos) de
`docs/07-perguntas-em-aberto.md`.

| Caminho | O que é |
|---|---|
| `cdk.json` | Conta, região, repositório do GitHub, AMI e domínios, de onde as stacks leem. O que roda fora do CDK repete parte desses valores, e `test/consistency.test.ts` confere que `staging/compose.yml`, `staging/Caddyfile`, `staging/fetch-env.sh`, `scripts/staging.sh` e `deploy-staging.yml` batem com ele. |
| `lib/shared-stack.ts` | `SpaceSportsShared`: zona DNS, repositórios ECR e provedor OIDC. Production vai usar os mesmos. |
| `lib/staging-stack.ts` | `SpaceSportsStaging`: VPC, EC2, Elastic IP, registros DNS, papéis IAM e as fotos. |
| `lib/media-storage.ts` | Bucket S3 e CloudFront das fotos de um ambiente. Ver [Fotos](#fotos-s3-e-cloudfront). |
| `staging/bootstrap.sh` | User data da instância: swap, Docker e plugin do Compose. |
| `staging/compose.yml`, `staging/Caddyfile` | Serviços do servidor. |
| `staging/deploy.sh`, `staging/fetch-env.sh` | Rodam no servidor, chamados pelo deploy. |
| `staging/media-credentials.sh` | Roda no servidor: credenciais temporárias do papel de mídia para a API. |
| `staging/postgres/Dockerfile` | Imagem própria do Postgres com PostGIS. |
| `scripts/apply-staging.sh` | Usado pelo `deploy-staging.yml`: envia a pasta `staging/` e acompanha o SSM Run Command. |
| `scripts/staging.sh` | Liga e desliga a instância. |

```bash
pnpm --filter @space-sports/infra test    # sem Docker e sem credenciais da AWS
pnpm --filter @space-sports/infra synth   # idem
```

## Decisões e motivos

- **Imagem própria do Postgres.** `postgis/postgis:17-3.5` só publica amd64 (conferido no Docker Hub
  em 2026-11-02), e a instância é arm64. A imagem parte da oficial `postgres:17.11-bookworm`, que é
  multiarquitetura, e instala o pacote do PGDG. O PGDG não tem mais PostGIS 3.5 para o Postgres 17,
  só 3.6 e 3.7, nas duas arquiteturas. Foi fixada a 3.6, a mais próxima da usada em dev e na CI. As
  migrações rodaram nela sem mudança, em amd64.
- **Terceiro repositório no ECR.** A imagem acima precisa morar em algum lugar, então existe
  `space-sports/postgres`, além de `api` e `web`. A tag vem do hash do Dockerfile: o contêiner só é
  recriado quando ele muda.
- **Runner `ubuntu-24.04-arm`.** Disponível em repositório privado desde 2026-01-29, com 2 vCPUs, e
  conta na cota do plano. Não foi preciso QEMU. O tempo de build ainda não foi medido.
- **Instância conferida antes do build.** O plano Free tem cota mensal de US$ 12, e os runners param
  quando ela acaba. Com o staging desligado, um push no main não constrói imagens. Depois de ligar,
  dispare o workflow à mão.
- **`sub` imutável no OIDC.** Repositórios criados depois de 2026-07-15 emitem
  `repo:<org>@<id>/<repo>@<id>:ref:...`, e o formato só com nomes é recusado pela AWS. O valor
  configurado veio de `gh api repos/Space-Sports-Apps/mobile-web/actions/oidc/customization/sub`. Não
  use `environment:` nos jobs: isso troca o sufixo do `sub`.
- **Negação no papel da instância.** A política `AmazonSSMManagedInstanceCore` libera
  `ssm:GetParameter` em `*`. Como production vai usar a mesma conta, uma negação explícita limita a
  leitura ao prefixo do staging.
- **Limite de saltos 1 no IMDS.** A AL2023 usa 2 por padrão, o que deixaria um contêiner obter as
  credenciais da instância.
- **Papel de mídia para a API, em vez do papel da instância.** Pelo item anterior, a API no contêiner
  não usa o papel da instância. O host assume `space-sports-staging-media`, que só grava, lê, apaga e
  lista o bucket das fotos, e entrega credenciais de 1 hora à API e ao seed. Não há chave de acesso,
  e quem invadir a API não obtém o papel da instância. Detalhes em [Fotos](#fotos-s3-e-cloudfront).
- **Créditos de CPU em `standard`.** A T4g nasce em `unlimited`, que cobra à parte o uso acima da
  linha de base. Em `standard` não há cobrança extra, mas a CPU cai para a linha de base quando os
  créditos acabam: se o staging ficar lento sob carga contínua, confira a métrica
  `CPUCreditBalance`.
- **AMI fixa.** Com o parâmetro público do SSM, uma AMI nova substituiria a instância no próximo
  `cdk deploy`, com o disco junto. Para atualizar, troque `amiId` no `cdk.json` sabendo que isso
  recria a instância:
  `aws ssm get-parameter --region sa-east-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text`.
- **Arquivos do servidor enviados no próprio comando.** `compose.yml`, `Caddyfile` e os scripts vão
  em um `tar` em base64 dentro do SSM Run Command, sem bucket extra. A AWS não documenta um limite
  para os parâmetros do comando. O pacote tem cerca de 5 KB, e um teste falha se passar de 16 KB.
- **Sem `AUTH_TRUSTED_PROXIES`.** O Caddy descarta o `x-forwarded-for` enviado pelo cliente e grava
  um único IP, e o rewrite do Next mantém esse valor. A API aceita esse caso sem a variável.

## Memória

Máquina de 2 GB com 2 GB de swap. Os limites somam 1.504 MB, e um teste falha se passarem de 1.600 MB.

| Serviço | Limite | Observação |
|---|---|---|
| `api` | 512 MB | Heap do Node em 384 MB. Inclui os workers. |
| `web` | 384 MB | Heap do Node em 256 MB. |
| `postgres` | 384 MB | `shared_buffers=96MB`, `max_connections=30`. |
| `redis` | 128 MB | `maxmemory 96mb`, `noeviction`, AOF. |
| `caddy` | 96 MB | |
| Sistema, Docker, agente do SSM | cerca de 400 MB | |

Os valores são estimativas: ainda não foram medidos em uma `t4g.small`. Confira no passo 8.

## Variáveis e parâmetros

Valores que não são segredo ficam em `staging/compose.yml`, versionados. Segredos ficam no Parameter
Store como `SecureString`, e cada parâmetro `/space-sports/staging/<grupo>/<VARIÁVEL>` vira uma linha
de `/opt/space-sports/env/<grupo>.env` no servidor, pasta só do root. O `fetch-env.sh` lê tudo a cada
deploy, então uma variável nova não exige mudar código. `NODE_ENV` nunca entra nos arquivos de env.

### Parâmetros

| Parâmetro (sob `/space-sports/staging/`) | Obrigatório | Valor |
|---|---|---|
| `postgres/POSTGRES_PASSWORD` | Sim | `openssl rand -hex 24`. Só vale na primeira criação do banco. |
| `api/DATABASE_URL` | Sim | `postgres://space_sports:<senha>@postgres:5432/space_sports` |
| `api/BETTER_AUTH_SECRET` | Sim | `openssl rand -base64 32` |
| `api/ADS_DELIVERY_SECRET` | Sim | `openssl rand -base64 32`. Chave HMAC dos tokens de entrega dos anúncios (RN-ADS-04); a API não sobe sem ela com `NODE_ENV=production`. Trocar a chave só invalida os tokens das últimas 2 horas. |
| `api/PAYMENTS_DATA_KEY` | Sim | `openssl rand -base64 32` (32 bytes). Chave AES-256-GCM do documento (CPF/CNPJ) do cadastro no gateway (decisão 97); a API não sobe sem ela com `NODE_ENV=production`. **Nunca trocar nem apagar**: sem ela, os documentos gravados ficam ilegíveis. |
| `api/SMTP_PASSWORD` | Para enviar e-mail | Chave de API do Resend. |
| `seed/ALLOW_DEMO_SEED` | Para o seed | `true` |
| `seed/SEED_DEMO_PASSWORD` | Para o seed | 8 a 128 caracteres. Vale para todas as contas de demonstração. |
| `seed/SEED_SUPER_EMAIL`, `seed/SEED_SUPER_NAME`, `seed/SEED_SUPER_PASSWORD` | Para o seed | Usuário Super. |
| `api/GOOGLE_CLIENT_ID`, `api/GOOGLE_CLIENT_SECRET`, `api/APPLE_CLIENT_ID`, `api/APPLE_CLIENT_SECRET`, `api/APPLE_APP_BUNDLE_IDENTIFIER` | Não | Login social. |
| `api/GOOGLE_MAPS_API_KEY`, `api/EXPO_ACCESS_TOKEN` | Não | Geocodificação e push com "enhanced security". |

O CDK cria parâmetros do tipo `String`, que não são segredo:

| Parâmetro (sob `/space-sports/staging/`) | Valor |
|---|---|
| `instance-id` | A instância, para a CI achá-la. |
| `api/S3_BUCKET` | `space-sports-media-staging-<conta>`. |
| `api/S3_REGION` | `sa-east-1`. |
| `api/S3_PUBLIC_URL` | `https://<domínio do CloudFront>`, a base pública das fotos. |

Os três `S3_*` ficam no grupo `api`, e o `fetch-env.sh` os leva ao `api.env` sem passo manual. Não
ficam no compose porque a API exige `S3_BUCKET` e `S3_PUBLIC_URL` juntos, e o domínio do CloudFront só
existe depois do `cdk deploy`: antes dele a API não recebe nenhum dos três e responde 503 no upload;
depois, recebe os três no deploy seguinte. As fotos não precisam de segredo: as credenciais vêm do
papel de mídia.

O deploy para com uma mensagem clara se faltar um parâmetro marcado com "Sim". Os valores não podem
ter quebra de linha.

### No `compose.yml`

| Serviço | Variáveis |
|---|---|
| `api` | `NODE_ENV=production`, `NODE_OPTIONS`, `JOBS_ENABLED=true`, `REDIS_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `WEB_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_FROM`, `AWS_CONFIG_FILE`, `AWS_EC2_METADATA_DISABLED` |
| `seed` | As da `api`, com `NODE_ENV=development`, que o seed de demonstração exige, mais o `seed.env` |
| `web` | `NODE_OPTIONS`, `SITE_URL`, `AUTH_PROVIDERS` (`google`) |
| `postgres` | `POSTGRES_USER`, `POSTGRES_DB` |

`ALLOW_DEMO_SEED` existe só no `seed.env`, lido apenas pelo serviço `seed`. O web é construído com
`API_URL=http://api:3333`. O `AUTH_PROVIDERS=google` está no serviço `web` desde 2026-11-03 (cliente OAuth em
`docs/09-infra-aws.md`, seção 7); ele é lido a cada requisição, sem rebuild.

### No GitHub

| Variável de repositório | Valor |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | Saída `DeployRoleArn` da stack. Sem ela, o `deploy-staging.yml` é pulado sem erro. |

Nenhuma chave da AWS fica no GitHub: o workflow usa OIDC.

## Primeiro deploy

Os passos 1 a 3 criam recursos na AWS, e o custo começa ali (cerca de US$ 27/mês com a instância
ligada e US$ 7/mês desligada).

### 1. Criar os recursos

O perfil `default` da máquina aponta para a conta de gerenciamento. Crie um perfil da conta-membro
`123456789012`, onde o usuário `lucas` já tem `AdministratorAccess`. O comando é interativo, então
rode em um terminal normal, não com `!` no Claude Code:

```bash
aws configure sso                         # conta 123456789012, região sa-east-1
export AWS_PROFILE=<perfil criado>
aws sts get-caller-identity               # precisa mostrar 123456789012

cd infra
pnpm cdk bootstrap aws://123456789012/sa-east-1
pnpm synth
pnpm cdk diff --all
pnpm cdk deploy --all
```

Anote as saídas `NameServers`, `DeployRoleArn` e `InstanceId`.

`SpaceSportsShared` tem proteção contra remoção, para a zona e as imagens não sumirem por acidente.

### 2. Apontar o domínio

No Registro.br, troque os nameservers de `spacesports.com.br` pelos quatro de `NameServers`. Se o
DNSSEC estiver ligado, desligue antes. Espere propagar:

```bash
dig +short NS spacesports.com.br
dig +short staging.spacesports.com.br      # o Elastic IP
```

O Caddy só consegue o certificado depois disso. Se o deploy vier antes, ele tenta de novo sozinho.

### 3. Criar os parâmetros

```bash
put() {
  aws ssm put-parameter --overwrite --type SecureString \
    --name "/space-sports/staging/$1" --value "$2" > /dev/null
}

db_password=$(openssl rand -hex 24)
put postgres/POSTGRES_PASSWORD "$db_password"
put api/DATABASE_URL "postgres://space_sports:$db_password@postgres:5432/space_sports"
put api/BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
put api/ADS_DELIVERY_SECRET "$(openssl rand -base64 32)"
put api/PAYMENTS_DATA_KEY "$(openssl rand -base64 32)"

put seed/ALLOW_DEMO_SEED true
put seed/SEED_SUPER_EMAIL '<e-mail do Super>'
put seed/SEED_SUPER_NAME '<nome do Super>'
read -rs -p 'Senha do Super: ' value && put seed/SEED_SUPER_PASSWORD "$value"; echo
read -rs -p 'Senha das contas de demonstração: ' value && put seed/SEED_DEMO_PASSWORD "$value"; echo
read -rs -p 'Chave do Resend: ' value && put api/SMTP_PASSWORD "$value"; echo
unset value db_password
```

A chave do Resend pode ficar para depois: veja [o que depende do usuário](#o-que-depende-do-usuário).

### 4. Ligar o deploy

```bash
gh variable set AWS_DEPLOY_ROLE_ARN --repo Space-Sports-Apps/mobile-web --body '<DeployRoleArn>'
gh workflow run deploy-staging.yml --repo Space-Sports-Apps/mobile-web --ref main
gh run watch --repo Space-Sports-Apps/mobile-web
```

A partir daqui, cada CI verde no `main` aplica o commit no servidor, se a instância estiver ligada. Push só de `docs/**` e `**/*.md` não roda a CI nem o deploy.
Este é o primeiro build em arm64: se uma dependência nativa falhar, é aqui que aparece.

### 5. Entrar no servidor

Não há SSH. Use o Session Manager pelo console da AWS ou pelo terminal, com o
[plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html):

```bash
aws ssm start-session --region sa-east-1 --target <InstanceId>
sudo -i
cd /opt/space-sports
cloud-init status                # status: done
docker compose ps                # todos healthy; caddy não tem healthcheck
```

Se o bootstrap falhou, veja `/var/log/cloud-init-output.log`. Corrija a causa, rode o script de novo
e reinicie:

```bash
bash /var/lib/cloud/instance/scripts/part-001 && reboot
```

O reboot é necessário porque `cloud-init status` só deixa de indicar a falha no boot seguinte, e o
`deploy.sh` para enquanto ela aparece. A sessão cai. Depois de voltar, dispare o workflow de novo.

### 6. Conferir as extensões

As migrações criam `postgis` e `btree_gist` (`apps/api/drizzle/0000_extensions.sql`), e o usuário do
banco é superusuário no contêiner. Confira que existem e que o PostGIS responde em arm64:

```bash
docker compose exec postgres psql -U space_sports -d space_sports -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis', 'btree_gist');"
docker compose exec postgres psql -U space_sports -d space_sports -c "SELECT postgis_full_version();"
docker compose exec postgres psql -U space_sports -d space_sports -c \
  "SELECT round(ST_Distance(ST_MakePoint(-43.9, -19.9)::geography, ST_MakePoint(-43.91, -19.9)::geography));"
```

O esperado é `postgis` 3.6 e `btree_gist` 1.7, e a distância da última consulta é 1047 (metros).

### 7. Rodar o seed de demonstração

```bash
docker compose run --rm seed
```

Roda o seed de produção e acrescenta a equipe dos parceiros, fotos ilustrativas e logos, estas só com
as fotos configuradas ([Fotos](#fotos-s3-e-cloudfront)). É idempotente, e as contas estão em `apps/api/README.md`. O serviço `seed` usa
`NODE_ENV=development` porque o script recusa `production`. A API segue em `production`.

### 8. Checar a memória

Use a API e o painel por alguns minutos e, com o sistema em uso:

```bash
free -m
swapon --show
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}'
dmesg -T | grep -i -E 'out of memory|oom' || echo 'sem OOM'
```

Sinais de que a `t4g.small` não basta: swap acima de 500 MB, contêiner perto de 100% do limite, OOM
no `dmesg` ou reinícios em `docker compose ps`. Ajuste os limites no `compose.yml`, ou passe para a
`t4g.medium` em `cdk.json`, que custa cerca de US$ 20/mês a mais ligada o mês todo.

### 9. Testar de fora

```bash
curl -fsS https://api-staging.spacesports.com.br/v1/health
curl -fsS https://staging.spacesports.com.br/health
```

Entre em `https://staging.spacesports.com.br/entrar` com uma das contas de demonstração, e no app
apontando para `https://api-staging.spacesports.com.br`.

## Ligar e desligar

A instância desliga sozinha todo dia às 20h de Brasília (`autoStopCron` em `cdk.json`), para um esquecimento não virar custo. Ligar é sempre manual. Esse desligamento não espera nada: se um teste ou deploy estiver rodando às 20h, ele é interrompido.

Com a instância desligada, o disco e o Elastic IP continuam cobrados. Os dados e os contêineres
ficam: eles voltam sozinhos ao ligar.

```bash
export AWS_PROFILE=<perfil da conta-membro>
pnpm --filter @space-sports/infra staging:status
pnpm --filter @space-sports/infra staging:start
pnpm --filter @space-sports/infra staging:stop
```

Commits do `main` feitos com ela desligada não são aplicados, e o workflow termina com um aviso.
Depois de ligar, aplique a versão mais recente:

```bash
gh workflow run deploy-staging.yml --repo Space-Sports-Apps/mobile-web --ref main
```

Disparar o workflow com a instância desligada falha de propósito.

## Fotos (S3 e CloudFront)

Decisão 72: as fotos dos espaços e de perfil ficam em um bucket privado por ambiente, com CloudFront na
frente. A API gera a URL pré-assinada para `uploads/`, confere a imagem e copia para `spaces/`,
`users/` ou `ads/` (anúncios). A URL gravada no banco é `S3_PUBLIC_URL` mais a chave.

| Recurso | Configuração |
|---|---|
| Bucket `space-sports-media-staging-<conta>` | `sa-east-1`. Block Public Access total, sem ACLs, SSE-S3, TLS obrigatório, sem versionamento. Fica na conta se a stack for removida. |
| Ciclo de vida | `uploads/` expira em 1 dia, e multipart incompleto é abortado em 1 dia. A AWS arredonda para a meia-noite UTC seguinte, então um envio abandonado some entre 1 e 2 dias depois. |
| CORS | `PUT` e `GET` de `https://staging.spacesports.com.br` e `http://localhost:3000`, só com `Content-Type`, preflight guardado por 1 hora. O app não precisa: CORS é coisa do navegador. |
| CloudFront | Domínio padrão `*.cloudfront.net`, Origin Access Control, só `GET` e `HEAD`, HTTP redirecionado para HTTPS, política `CachingOptimized` e cabeçalhos de segurança (`nosniff`). `PriceClass_All`, a única com pontos de presença na América do Sul. |
| Política do bucket | O CloudFront lê só `spaces/*`, `users/*` e `ads/*` (imagens dos anúncios), e só esta distribuição. `uploads/` nunca é servido: ali ficam os envios que a API ainda não conferiu. A origem pronta do CDK liberaria `<bucket>/*`, por isso `lib/media-storage.ts` tem a sua. |
| Papel `space-sports-staging-media` | `s3:PutObject`, `s3:GetObject` e `s3:DeleteObject` em `<bucket>/*`, e `s3:ListBucket` no bucket, para o HEAD de um objeto que não existe responder 404, e não 403. Só o papel da instância o assume, por até 1 hora. |

### Credenciais da API

O limite de saltos 1 do IMDS impede o contêiner de obter credenciais, então quem as busca é o host:

1. `media-credentials.sh` assume o papel de mídia com o papel da instância e grava
   `/opt/space-sports/aws/media.json`, no formato do `credential_process`, e `aws/config`.
2. O compose monta a pasta `aws/` em `/run/aws` na API e no seed, só para leitura, com
   `AWS_CONFIG_FILE=/run/aws/config`. O SDK roda `cat /run/aws/media.json` e relê o arquivo quando
   faltam 5 minutos para expirar. `AWS_EC2_METADATA_DISABLED=true` evita a espera pelo serviço de
   metadados quando o arquivo falta.
3. O timer `space-sports-media-credentials.timer` renova a cada 15 minutos. O serviço também roda no
   boot, antes do Docker, porque as credenciais da véspera já expiraram quando a instância liga.

A montagem é da pasta, não do arquivo: o `mv` troca o arquivo, e a montagem de um arquivo ficaria presa
na versão anterior. O `deploy.sh` instala o serviço e o timer a cada deploy, então a instância atual
não precisa de bootstrap novo. Se o `assume-role` falhar, o deploy segue com um aviso, e só o upload de
fotos falha.

### Aplicar

```bash
export AWS_PROFILE=<perfil da conta-membro>
cd infra
pnpm synth
pnpm cdk diff SpaceSportsStaging
pnpm cdk deploy SpaceSportsStaging
```

O diff deve mostrar só recursos novos (bucket e política, OAC, distribuição, papel de mídia e os
parâmetros `api/S3_BUCKET`, `api/S3_REGION` e `api/S3_PUBLIC_URL`) e o `sts:AssumeRole` acrescentado à
política do papel da instância, sem substituir a instância. A distribuição leva alguns minutos para
ficar pronta. Anote as saídas `MediaBucketName`, `MediaDistributionDomainName` e
`MediaDistributionId`.

Depois, com a instância ligada e a API já com o S3 (tarefa C.1), rode o workflow de deploy. É ele que
leva os três `S3_*` ao `api.env` e instala o timer. Um deploy automático antes do `cdk deploy` não
derruba a API: sem os parâmetros, só o upload responde 503.

### Conferir

```bash
bucket=space-sports-media-staging-123456789012
aws s3api get-public-access-block --bucket "$bucket"           # as quatro opções em true
aws s3api get-bucket-lifecycle-configuration --bucket "$bucket"
aws s3api get-bucket-cors --bucket "$bucket"
aws ssm get-parameters --query 'Parameters[].[Name,Value]' --output text --names \
  /space-sports/staging/api/S3_BUCKET /space-sports/staging/api/S3_REGION /space-sports/staging/api/S3_PUBLIC_URL
```

No servidor, em `/opt/space-sports`:

```bash
systemctl list-timers space-sports-media-credentials.timer
grep -o '"Expiration": "[^"]*"' aws/media.json                  # no futuro, em até 1 hora
grep '^S3_' env/api.env                                         # os três
docker compose exec api node -e '
const { S3Client, HeadBucketCommand } = require("@aws-sdk/client-s3");
new S3Client({ region: process.env.S3_REGION })
  .send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }))
  .then(() => console.log("S3 ok"), (e) => { console.error(e.name); process.exit(1); });'
```

Envie a logo de um espaço pelo painel e confira as respostas, com o domínio de `S3_PUBLIC_URL`:

```bash
curl -sI https://<domínio>/spaces/<spaceId>/logo/<arquivo> | head -1                   # 200
curl -sI https://<domínio>/uploads/qualquer | head -1                                  # 403
curl -sI "https://$bucket.s3.sa-east-1.amazonaws.com/spaces/<spaceId>/logo/<arquivo>" | head -1  # 403
```

### Cache e remoção

As chaves têm UUID e nunca são reescritas: uma foto trocada ganha outra URL, e o cache de 1 dia da
`CachingOptimized` não mostra foto velha. Uma foto apagada (troca, remoção ou anonimização) pode seguir
nos pontos de presença por até 1 dia, numa URL que nada mais referencia. Por enquanto a API não
invalida o cache ao apagar (`docs/09-infra-aws.md`, seção 8). Para tirar antes, à mão:

```bash
aws cloudfront create-invalidation --distribution-id <MediaDistributionId> --paths '/users/<userId>/*'
```

As primeiras 1.000 rotas invalidadas por mês não são cobradas.

### Bucket mantido e domínio do staging

- **Nome fixo com `RETAIN`.** Depois de um `cdk destroy`, o bucket fica, e um novo `cdk deploy` falha
  porque o nome já existe. Os dados do staging são descartáveis: esvazie e apague o bucket à mão, ou
  traga-o de volta com `cdk import`.
- **URLs com o domínio do CloudFront.** As URLs gravadas no banco levam o `*.cloudfront.net`. Se a
  distribuição for recriada, o domínio muda e as fotos antigas do staging deixam de abrir. Em
  production o domínio próprio evita isso.

### Production: `media.spacesports.com.br`

O `MediaStorage` serve para production com outros valores e três acréscimos:

- **Certificado.** O CloudFront só aceita certificado do ACM em `us-east-1`. Crie-o numa stack pequena
  em `us-east-1` (`env: { region: 'us-east-1' }`), validado por DNS na zona do `SpaceSportsShared`, e
  passe-o à stack de production com `crossRegionReferences: true` nas duas. Outra opção é criar o
  certificado à mão e guardar o ARN no `cdk.json`.
- **Distribuição.** `domainNames: ['media.spacesports.com.br']`, `certificate` e
  `minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021`. No domínio padrão do staging a AWS
  fixa a política de TLS, e ela não pode ser trocada.
- **DNS.** Registros `A` e `AAAA` de alias de `media` para a distribuição
  (`route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))`).

Bucket `space-sports-media-production-<conta>`, CORS só de `https://app.spacesports.com.br` (sem
`localhost`) e papel `space-sports-production-media`. Os três `S3_*` vão para o Parameter Store do
mesmo jeito, com `S3_PUBLIC_URL=https://media.spacesports.com.br`.

### Custo

Menos de US$ 0,10/mês no staging e no piloto, quase tudo dentro do nível gratuito do CloudFront.
Preços e cálculo em `docs/09-infra-aws.md`, seção 8.

## Operação

No servidor, em `/opt/space-sports`:

| Tarefa | Comando |
|---|---|
| Logs | `docker compose logs -f --tail 100 api` |
| Versão no ar | `cat .env` |
| Reiniciar um serviço | `docker compose restart api` |
| Trocar um segredo | Altere o parâmetro e rode o workflow. O `api.env` é regravado, e a API só é recriada se o env mudar. |
| Migrações à mão | `docker compose run --rm migrate` |
| Renovar as credenciais das fotos | `bash media-credentials.sh` (ou `systemctl start space-sports-media-credentials`) |

### Voltar a uma versão anterior

Refazer a execução de um deploy antigo aplica aquele commit, com o `compose.yml` e os scripts dele:

```bash
gh run list --repo Space-Sports-Apps/mobile-web --workflow deploy-staging.yml --limit 20
gh run view <id> --repo Space-Sports-Apps/mobile-web --log | grep -m1 'IMAGE_TAG:'  # commit da execução
gh run rerun <id> --repo Space-Sports-Apps/mobile-web
gh run watch <id> --repo Space-Sports-Apps/mobile-web
```

- O GitHub só permite refazer uma execução até 30 dias depois dela.
- A imagem é reaproveitada se estiver entre as 5 últimas do ECR. Se não estiver, é reconstruída a
  partir do commit.
- Depois de refazer, confira `IMAGE_TAG` no log e `cat .env` no servidor.
- Migrações não são desfeitas: a versão antiga roda sobre o esquema novo. Se não funcionar, corrija
  para a frente.
- Para voltar à versão mais recente do `main`, dispare o workflow.

Alterar `staging/bootstrap.sh` não afeta a instância que já existe: o script só roda no primeiro boot.

## O que depende do usuário

- **Nameservers no Registro.br:** passo 2. Sem isso, não há DNS nem certificado.
- **Credenciais do Resend:** crie a chave de API, valide `spacesports.com.br` no Resend e adicione na
  zona do Route 53 os registros de SPF e DKIM que ele indicar, além do DMARC. Depois grave
  `api/SMTP_PASSWORD` e rode o workflow. Até lá, o envio de e-mail falha, inclusive verificação de
  conta e redefinição de senha. O login com as contas do seed funciona, porque elas já têm o e-mail
  verificado.
- **Perfil da conta-membro no AWS CLI:** passo 1.

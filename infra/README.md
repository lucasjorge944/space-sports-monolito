# Infraestrutura (`@space-sports/infra`)

Infraestrutura como código do staging na AWS: CDK em TypeScript, o compose do servidor e os scripts
de deploy. Contexto em `docs/09-infra-aws.md` e nas decisões 56 (staging) e 72 (fotos) de
`docs/07-perguntas-em-aberto.md`.

| Caminho | O que é |
|---|---|
| `cdk.json` | Conta, região, repositório do GitHub, AMI e domínios, de onde as stacks leem. O que roda fora do CDK repete parte desses valores, e `test/consistency.test.ts` confere que `staging/compose.yml`, `staging/Caddyfile`, `staging/fetch-env.sh`, `scripts/staging.sh` e `deploy-staging.yml` batem com ele. |
| `lib/shared-stack.ts` | `SpaceSportsShared`: zona DNS, repositórios ECR (`api`, `web`, `postgres` e `mcp`) e provedor OIDC. Production vai usar os mesmos. |
| `lib/staging-stack.ts` | `SpaceSportsStaging`: VPC, EC2, Elastic IP, registros DNS (`staging`, `api-staging`, `mcp-staging` e `mcp-admin-staging`), papéis IAM e as fotos. |
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
  recriado quando ele muda. O quarto, `space-sports/mcp`, é o do servidor MCP, com a tag do commit,
  como `api` e `web` ([Servidor MCP](#servidor-mcp)).
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

Máquina de 2 GB com 2 GB de swap. Os limites somam 1.600 MB, e um teste falha se passarem disso.

| Serviço | Limite | Observação |
|---|---|---|
| `api` | 512 MB | Heap do Node em 384 MB. Inclui os workers. |
| `web` | 352 MB | Heap do Node em 224 MB. Eram 384/256 MB; os 32 MB foram para o `mcp` (MCP2.8). **Pico nunca medido: confira no passo 8.** |
| `mcp` | 128 MB | Heap do Node em 64 MB, como em produção. Serve os dois conectores. Medido: 62 MB parado, 91 MB de pico com 16 clientes e 100 MB com 32. |
| `postgres` | 384 MB | `shared_buffers=96MB`, `max_connections=30`. |
| `redis` | 128 MB | `maxmemory 96mb`, `noeviction`, AOF. |
| `caddy` | 96 MB | Medido: 15 MB parado. |
| Sistema, Docker, agente do SSM | cerca de 300 MB | Eram cerca de 400 MB antes do `mcp`. |

Medições em amd64 (a instância é arm64), com o `docker stats`:

- **`mcp`, com os dois conectores (2026-11-12, MCP2.8).** Imagem de produção com a superfície `admin`
  da MCP2.4 (as tools do Super carregadas), as restrições do compose (disco só de leitura, sem
  capabilities), `MCP_SURFACES=user,admin` e a API simulada dos testes. Cada cliente conecta de novo
  a cada rodada e chama sete tools: no host do jogador, cinco de jogador e duas métricas da gestão; no
  do Super, sete tools do Super. Metade dos clientes em cada host.

  | Heap / limite | Clientes em paralelo | Chamadas | Parado | Pico | Resultado |
  |---|---|---|---|---|---|
  | 48 MB / 96 MB | 2 + 2 | 3.325 até cair | 61 MB | 77 MB | heap esgotado |
  | 48 MB / 96 MB | 4 + 4 | 2.317 até cair | 71 MB | 80 MB | heap esgotado |
  | 56 MB / 96 MB | 1 + 1 | 29.379 em 45 s | 69 MB | 89 MB | ok, folga de 7 MB |
  | 56 MB / 96 MB | 4 + 4 | 36.407 em 60 s | 63 MB | 86 MB | ok, folga de 10 MB |
  | 56 MB / 96 MB | 8 + 8 | 35.385 em 60 s | 71 MB | 90 MB | ok, folga de 6 MB |
  | **64 MB / 128 MB** | 8 + 8 | 40.880 em 60 s | 62 MB | 91 MB | ok, folga de 37 MB |
  | **64 MB / 128 MB** | 16 + 16 | 27.734 em 60 s | 63 MB | 100 MB | ok, folga de 28 MB |

  O limite do contêiner bastou em todos. O que falhou foi o heap de 48 MB: o Node para com
  `JavaScript heap out of memory`, e o `restart: unless-stopped` religa o processo, mas as
  requisições em curso se perdem. Com 56 MB/96 MB, 16 clientes passam, mas a folga até o limite
  fica entre 6 e 10 MB, pouca para uma medição em amd64 que ainda não foi conferida na `t4g.small`.

  **Aplicado: 128 MB com heap de 64 MB, como em produção.** 16 clientes deixam 37 MB de folga e 32
  clientes, 28 MB, com mais vazão. A carga real do staging é de uma ou duas pessoas, e a API limita
  cada uma a 60 leituras por minuto. Para a soma seguir em 1.600 MB, os 32 MB saíram do `web`
  (384 → 352 MB, heap de 256 → 224 MB, os mesmos 128 MB fora do heap). Nem do Redis (motivo abaixo)
  nem do Caddy, que já não tem sobra. O pico do `web` nunca foi medido, nem localmente nem na
  instância: confira no passo 8 depois do primeiro deploy com estes limites.
- **`mcp`, regressão do heap (pendência antes da produção).** Rodando direto no Node, com a mesma
  carga (16 clientes, só tools de jogador, uma superfície), heap de 48 MB e a mesma API simulada: o
  código do deploy da MCP.6 (`fbd0280`) e o da MCP2.1 (`1043d1b`) aguentam (de 13.846 a 17.451
  chamadas em 45 s), e o da MCP2.2 (`db5c0c6`) e o da MCP2.3 caem por heap esgotado. A MCP2.2 não
  mexeu no `apps/mcp` nem nas dependências: mudou `packages/shared` (camada de métricas e
  `availability.ts`) e `packages/api-client` (endpoints de métricas). O heap depois de carregar o app
  quase não mudou (32,3 MB na MCP.6, 33,4 MB na MCP2.3, 34,3 MB na MCP2.4), e o `McpServer` montado a
  cada requisição aloca de 60 a 83 KB. A causa não apareceu num exame rápido: falta um heap snapshot
  sob carga em `db5c0c6` contra `1043d1b` e uma carga longa para descartar vazamento.
- **`redis`, mantido.** O cache de CEP guarda cada consulta por 30 dias, e o Redis cheio (com
  `noeviction`) recusa escritas: o rate limit da API deixa passar quando o Redis falha, então os
  limites param de valer. Por isso o `maxmemory` não foi reduzido para caber o `mcp`.
- **`caddy`, não reduzido.** Parado, 15 MB. Com 24 clientes abrindo uma conexão TLS nova por
  requisição e respostas comprimidas de 27 KB nos três domínios, passou de 96 MB e foi morto por
  falta de memória. É uma carga muito acima da do staging, mas mostra que o limite atual não tem
  sobra: se o `docker compose ps` mostrar o Caddy reiniciando, suba o limite dele.

Os valores ainda não foram medidos em uma `t4g.small`. Confira no passo 8.

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
| `api/MCP_ENABLED` | Não | Só para desligar o MCP: exatamente `false`, em minúsculas ([chave de emergência](#chave-de-emergência)). Um valor que não seja booleano impede a API de subir. Sem o parâmetro, a API liga o MCP no staging, porque o compose define `MCP_RESOURCE_URL` e `DEPLOY_ENV=staging`. |
| `api/MCP_ADMIN_ALLOWED_CLIENT_IDS` | Não | `client_id` dos clientes OAuth que podem pedir o recurso do Super (conector "Space Sports · Plataforma"), separados por vírgula. Sem o parâmetro, a API recusa todos, o esperado até o primeiro teste. Tipo `String`. Como descobrir o do Claude: [clientes do conector do Super](#clientes-do-conector-do-super). |
| `api/MCP_ADMIN_ENABLED`, `mcp/MCP_ADMIN_ENABLED` | Não | Só para desligar o conector do Super: exatamente `false`, em minúsculas, nos dois ([chave de emergência](#só-o-conector-do-super)). Um valor que não seja booleano impede a API ou o `mcp` de subir. Sem os parâmetros, ele fica ligado no staging, porque o compose define `MCP_ADMIN_RESOURCE_URL`. |
| `mcp/MCP_CONFIRMATION_SECRET` | Sim | `openssl rand -base64 48`. Chave HMAC dos códigos de confirmação de reserva e cancelamento do servidor MCP (decisão 114), no mínimo 32 caracteres. Vai só para o `env/mcp.env`. Trocar só invalida os códigos dos últimos 10 minutos. |
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
| `api` | `NODE_ENV=production`, `NODE_OPTIONS`, `JOBS_ENABLED=true`, `REDIS_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `WEB_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_FROM`, `DEPLOY_ENV=staging`, `PAYMENTS_PROVIDER=fake`, `AWS_CONFIG_FILE`, `AWS_EC2_METADATA_DISABLED`, `MCP_RESOURCE_URL`, `MCP_ADMIN_RESOURCE_URL` |
| `seed` | As da `api`, com `NODE_ENV=development`, que o seed de demonstração exige, mais o `seed.env` |
| `web` | `NODE_OPTIONS`, `SITE_URL`, `AUTH_PROVIDERS` (`google`) |
| `mcp` | `NODE_ENV=production`, `NODE_OPTIONS`, `API_URL`, `WEB_URL`, `MCP_ISSUER`, `MCP_JWKS_URL`, `MCP_SURFACES=user,admin`, `MCP_RESOURCE_URL`, `MCP_ADMIN_RESOURCE_URL`, `MCP_INTERNAL_HOSTS`, mais o `mcp.env` |
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
put mcp/MCP_CONFIRMATION_SECRET "$(openssl rand -base64 48)"

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

Depois do primeiro deploy com o `web` em 352 MB e o `mcp` em 128 MB (MCP2.8), confira os dois com o
site e os dois conectores em uso (navegue pelas páginas públicas, pelo `/painel` e pelo `/super`, e
faça a jornada do conector no Claude):

```bash
# Pico desde a criação do contêiner, pelo cgroup (memory.peak, cgroup v2).
for service in web mcp; do
  id=$(docker inspect -f '{{.Id}}' "$(docker compose ps -q "$service")")
  peak=$(cat "/sys/fs/cgroup/system.slice/docker-$id.scope/memory.peak")
  echo "$service: pico de $((peak / 1048576)) MB"
done
# Apoio: uso atual, reinícios e falta de memória.
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}' \
  $(docker compose ps -q web mcp)
docker inspect -f '{{.Name}} reinícios={{.RestartCount}} oom={{.State.OOMKilled}}' \
  $(docker compose ps -q web mcp)
docker compose logs --since 1h web mcp | grep -i -E 'heap out of memory|killed' || echo 'sem falta de memória'
```

O pico vem do `memory.peak` do cgroup, que guarda o máximo desde a criação do contêiner (um
`docker compose up` que recria o serviço zera a conta). O `docker stats` mostra só o uso do
momento, sem o cache de arquivos inativo, e serve de apoio. O `web` precisa ficar abaixo de cerca de
320 MB (90% de 352 MB) no `memory.peak`. Se passar disso, ou se reiniciar
por falta de memória, devolva os 32 MB ao `web` e leve o `mcp` de volta a 96 MB com heap de 56 MB,
que aguentou 16 clientes com 90 MB de pico. Registre os valores medidos na tabela acima.

### 9. Testar de fora

```bash
curl -fsS https://api-staging.spacesports.com.br/v1/health
curl -fsS https://staging.spacesports.com.br/health
curl -fsS https://mcp-staging.spacesports.com.br/health
curl -fsS https://mcp-admin-staging.spacesports.com.br/health
```

Entre em `https://staging.spacesports.com.br/entrar` com uma das contas de demonstração, e no app
apontando para `https://api-staging.spacesports.com.br`.

## Ligar e desligar

A instância desliga sozinha todo dia às 20h de Brasília (`autoStopCron` em `cdk.json`), para um esquecimento não virar custo. Ligar é sempre manual. Esse desligamento não espera nada: se um teste ou deploy estiver rodando às 20h, ele é interrompido.

Com a instância desligada, o disco e o Elastic IP continuam cobrados. Os dados e os contêineres
ficam: eles voltam sozinhos ao ligar.

O MCP (`mcp-staging.` e `mcp-admin-staging.`) roda nessa mesma instância e cai junto: os dois
conectores no Claude falham até ela ser ligada de novo. Não é preciso reconectar o do jogador, porque
os dados e o Elastic IP são os mesmos; o do Super vale por 24 horas de qualquer jeito
(`docs/14-mcp.md`, seção 8.1).

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

## Servidor MCP

O `apps/mcp` (docs/14-mcp.md) roda no mesmo host, atrás do Caddy, e um só contêiner serve os dois
conectores (seção 8.1 do `docs/14-mcp.md`):

| Conector | URL | Superfície | Quem |
|---|---|---|---|
| Space Sports | `https://mcp-staging.spacesports.com.br/mcp` | `user` | jogador, Dono, Admin, Professor |
| Space Sports · Plataforma | `https://mcp-admin-staging.spacesports.com.br/mcp` | `admin` | só Super, somente leitura |

Ele não tem banco nem chave de serviço: valida o token OAuth do usuário e chama a API com esse mesmo
token. A API é o servidor de autorização, com um recurso por conector.

| Peça | Configuração |
|---|---|
| Imagem | `space-sports/mcp:<commit>` no ECR, construída pelo `deploy-staging.yml` a partir de `apps/mcp/Dockerfile`, só quando falta. |
| DNS | Registros `A` de `mcp-staging` e `mcp-admin-staging` (`mcpSubdomain` e `mcpAdminSubdomain` no `cdk.json`) para o Elastic IP, criados pela `SpaceSportsStaging`. |
| Caddy | `mcp-staging.spacesports.com.br` e `mcp-admin-staging.spacesports.com.br` → `mcp:3340`, os dois com `X-Robots-Tag`. Sem `encode` e sem `flush_interval`: o Caddy repassa na hora o `text/event-stream` e as respostas sem `Content-Length`, e as respostas JSON do MCP são pequenas. Sem `header_up Host`: o `mcp` escolhe a superfície pelo host original. |
| Superfícies | `MCP_SURFACES=user,admin`. A escolha é pelo host (e pelo caminho) da requisição; cada superfície tem o seu metadata (RFC 9728), as suas tools e aceita só tokens da sua audiência. Host sem superfície: 404. |
| Rede | Só a `edge`: recebe do Caddy e fala com a API pelo nome do serviço. Nunca alcança Postgres nem Redis. |
| Emissor | `MCP_ISSUER=https://api-staging.spacesports.com.br/v1/auth`, o `BETTER_AUTH_URL` da API mais `/v1/auth`. Tem de bater com o `iss` que a API grava no token. |
| JWKS | `MCP_JWKS_URL=http://api:3333/v1/auth/jwks`, direto na API, sem dar a volta pelo Caddy. Com `NODE_ENV=production` o MCP só aceita HTTP para hosts de `MCP_INTERNAL_HOSTS` (`api`) ou loopback. |
| Recursos | `MCP_RESOURCE_URL=https://mcp-staging.spacesports.com.br/mcp` e `MCP_ADMIN_RESOURCE_URL=https://mcp-admin-staging.spacesports.com.br/mcp`, iguais no `mcp` e na `api` (são o `aud` dos tokens de cada conector). Os testes conferem. |
| Segredo | `mcp/MCP_CONFIRMATION_SECRET` no Parameter Store, gravado em `env/mcp.env`. O deploy para antes de tocar nos contêineres se ele faltar. |
| Saúde | `GET /health`, conferido pelo healthcheck do compose. Sobe depois da API saudável. |
| Isolamento | `read_only: true`, `cap_drop: [ALL]` e `no-new-privileges`: o processo recebe o token dos usuários e não grava nada (logs no stdout), então não precisa de `tmpfs`. Conferido com o compose e sob carga. |

Na API, `MCP_RESOURCE_URL` com `DEPLOY_ENV=staging` liga o servidor de autorização
(`/v1/auth/oauth2/*`, `/v1/auth/jwks` e o metadata), que já chega pelo bloco `api-staging.` do Caddy, e
`MCP_ADMIN_RESOURCE_URL` cria e liga o segundo recurso, o do Super (token de 15 minutos, conexão de
até 24 horas). `MCP_ENABLED`, `MCP_ADMIN_ENABLED` e `MCP_ADMIN_ALLOWED_CLIENT_IDS` ficam fora do
compose de propósito: o `environment` do compose vence os arquivos de `env/`, e anularia as chaves de
emergência e a lista de clientes, que vêm dos parâmetros.
O registro dinâmico de clientes (`MCP_DYNAMIC_CLIENT_REGISTRATION`) fica desligado: o Claude se
identifica pelo Client ID Metadata Document. Só ligue (no `x-api-environment` do compose) se o teste
com o Claude mostrar que ele não usa o CIMD.

### Chave de emergência

`MCP_ENABLED=false` na API recusa todo token do MCP (503 `MCP_DISABLED`) e tira do ar as rotas OAuth,
o JWKS e o metadata, sem afetar app e web. Com o JWKS fora do ar, o `mcp` também deixa de aceitar
tokens. Derruba os dois conectores; para desligar só o do Super, veja
[a seção seguinte](#só-o-conector-do-super).

Pelo caminho normal, que vale a partir do próximo deploy e sobrevive aos seguintes:

```bash
export AWS_PROFILE=<perfil da conta-membro>
aws ssm put-parameter --region sa-east-1 --overwrite --type String \
  --name /space-sports/staging/api/MCP_ENABLED --value false > /dev/null
gh workflow run deploy-staging.yml --repo Space-Sports-Apps/mobile-web --ref main
gh run watch --repo Space-Sports-Apps/mobile-web
```

Na hora, no servidor, em `/opt/space-sports` (sem esperar o build):

```bash
sed -i '/^MCP_ENABLED=/d' env/api.env && echo 'MCP_ENABLED=false' >> env/api.env
docker compose up -d api      # recria a API com o env novo
docker compose stop mcp
```

O `env/api.env` é regravado a cada deploy a partir do Parameter Store, e o `deploy.sh` sobe o `mcp` de
novo: grave também o parâmetro acima, senão o próximo deploy religa tudo. Para religar, apague o
parâmetro (`aws ssm delete-parameter --region sa-east-1 --name /space-sports/staging/api/MCP_ENABLED`)
e rode o workflow.

#### Só o conector do Super

`MCP_ADMIN_ENABLED=false` na API responde 503 `MCP_DISABLED` ao token, ao authorize e à emissão do
recurso do Super, sem afetar o conector do jogador, o app e o web. O mesmo parâmetro no grupo `mcp`
faz a superfície `admin` responder 503 no endpoint e no metadata dela, antes de validar o token e de
chamar a API. Grave os dois com o valor exato `false`, em minúsculas: um valor que não seja booleano
(ex.: `desligado`) é recusado na subida e derruba a API ou o `mcp` em vez de desligar só o Super.

```bash
export AWS_PROFILE=<perfil da conta-membro>
for group in api mcp; do
  aws ssm put-parameter --region sa-east-1 --overwrite --type String \
    --name "/space-sports/staging/$group/MCP_ADMIN_ENABLED" --value false > /dev/null
done
gh workflow run deploy-staging.yml --repo Space-Sports-Apps/mobile-web --ref main
gh run watch --repo Space-Sports-Apps/mobile-web
```

Na hora, no servidor, em `/opt/space-sports` (grave os parâmetros também, pelo mesmo motivo acima):

```bash
for file in env/api.env env/mcp.env; do
  sed -i '/^MCP_ADMIN_ENABLED=/d' "$file" && echo 'MCP_ADMIN_ENABLED=false' >> "$file"
done
docker compose up -d api mcp      # recria os dois com o env novo
```

Com a chave desligada, o `POST` em `https://mcp-admin-staging.spacesports.com.br/mcp` responde 503
(o do jogador segue com 401 sem token), e o authorize do recurso do Super também (teste da seção
seguinte). Para religar, apague os dois parâmetros e rode o workflow:

```bash
for group in api mcp; do
  aws ssm delete-parameter --region sa-east-1 --name "/space-sports/staging/$group/MCP_ADMIN_ENABLED"
done
```

### Clientes do conector do Super

Só os clientes OAuth listados em `api/MCP_ADMIN_ALLOWED_CLIENT_IDS` podem pedir o recurso do Super
(decisão 123). Sem o parâmetro, a API recusa todos: o authorize responde 400 `unauthorized_client`,
sem redirecionar, e grava no log o `client_id` recusado (`Cliente fora de MCP_ADMIN_ALLOWED_CLIENT_IDS
pedindo o recurso do Super`, campo `oauthClientId`). É assim que se descobre o do Claude. Com o Client
ID Metadata Document, o `client_id` é a URL `https://` do documento de metadados do cliente.

Para conferir a recusa e o log sem o Claude (o `client_id` `teste-curl` é inventado):

```bash
curl -sS -w '\n%{http_code}\n' -G https://api-staging.spacesports.com.br/v1/auth/oauth2/authorize \
  --data-urlencode response_type=code --data-urlencode client_id=teste-curl \
  --data-urlencode redirect_uri=https://example.com/callback \
  --data-urlencode code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM \
  --data-urlencode code_challenge_method=S256 \
  --data-urlencode resource=https://mcp-admin-staging.spacesports.com.br/mcp
```

Responde 400 com `"error":"unauthorized_client"` (503 com a chave do Super desligada). Depois:

1. Adicione no Claude o conector personalizado `https://mcp-admin-staging.spacesports.com.br/mcp`
   (Configurações → Conectores → Adicionar conector personalizado) e clique em "Conectar". A conexão
   falha: é o esperado enquanto o parâmetro não existe.
2. No servidor ([passo 5](#5-entrar-no-servidor)), em `/opt/space-sports`, liste os `client_id`
   recusados:

   ```bash
   docker compose logs --no-log-prefix --since 30m api \
     | grep -F 'Cliente fora de MCP_ADMIN_ALLOWED_CLIENT_IDS' \
     | grep -o '"oauthClientId":"[^"]*"' | sort | uniq -c
   ```

   Libere só o que veio da sua tentativa: o horário bate com o clique (sem o `uniq`, `grep -F` no
   `docker compose logs --timestamps` mostra a hora), e o domínio da URL tem de ser do Claude.
   `teste-curl` é o do teste acima, e `""` é um pedido sem `client_id`. Se nada aparecer, o Claude não
   chegou ao authorize: confira antes o conector do jogador, que usa o mesmo caminho (registro
   dinâmico, na seção acima).
3. Grave o parâmetro (do tipo `String`; vários clientes vão separados por vírgula) e aplique:

   ```bash
   export AWS_PROFILE=<perfil da conta-membro>
   aws ssm put-parameter --region sa-east-1 --overwrite --type String \
     --name /space-sports/staging/api/MCP_ADMIN_ALLOWED_CLIENT_IDS --value '<client_id>' > /dev/null
   aws ssm get-parameter --region sa-east-1 \
     --name /space-sports/staging/api/MCP_ADMIN_ALLOWED_CLIENT_IDS --query Parameter.Value --output text
   gh workflow run deploy-staging.yml --repo Space-Sports-Apps/mobile-web --ref main
   gh run watch --repo Space-Sports-Apps/mobile-web
   ```

   O `get-parameter` deve devolver a própria URL: a AWS CLI v2 grava o valor como texto, mas a v1
   baixaria o conteúdo de um valor que começa com `https://`. Para aplicar na hora, no servidor
   (grave o parâmetro também, senão o próximo deploy apaga a linha):

   ```bash
   sed -i '/^MCP_ADMIN_ALLOWED_CLIENT_IDS=/d' env/api.env
   echo 'MCP_ADMIN_ALLOWED_CLIENT_IDS=<client_id>' >> env/api.env
   docker compose up -d api
   ```

4. "Conectar" de novo no Claude: `/entrar` com a conta Super e o consentimento "Permitir acesso à
   plataforma". Outra conta vê "Sua conta não tem acesso". A conexão do Super vale por até 24 horas;
   depois, é preciso conectar de novo.

Tirar um cliente da lista impede novas autorizações dele. Para cortar na hora uma conexão já feita, use
"Desconectar" em "Apps conectados" (app ou web) ou a [chave do Super](#só-o-conector-do-super).

### Aplicar

A ordem importa. O workflow para com `RepositoryNotFoundException` se o repositório `space-sports/mcp`
não existir, e o `fetch-env.sh` para se faltar o segredo. Por isso, o segredo e o `cdk deploy` vêm
antes do merge no `main`:

```bash
export AWS_PROFILE=<perfil da conta-membro>
aws ssm put-parameter --region sa-east-1 --type SecureString \
  --name /space-sports/staging/mcp/MCP_CONFIRMATION_SECRET \
  --value "$(openssl rand -base64 48)" > /dev/null

cd infra
pnpm synth
pnpm cdk diff --all
pnpm cdk deploy --all
```

Sem `--overwrite`: repetir o comando não troca o segredo por acidente. O diff deve mostrar só
acréscimos: na `SpaceSportsShared`, o repositório `space-sports/mcp` e o export do ARN dele; na
`SpaceSportsStaging`, o registro `mcp-staging` e as declarações novas nas políticas dos papéis da
instância (pull) e de deploy (push). Nada substituído.

Depois, o merge no `main` e, com a instância ligada, o deploy (automático depois da CI, ou à mão com
`gh workflow run deploy-staging.yml`). O primeiro deploy constrói a imagem do MCP em arm64. O Caddy
pede o certificado de `mcp-staging.` sozinho, assim que o DNS responder.

#### Conector do Super (MCP2.8)

Nenhum parâmetro novo é obrigatório. A ordem importa:

1. A imagem precisa da superfície `admin` do `apps/mcp` (MCP2.4, no `main` desde `9f4ea5b`). Sem
   ela, o `mcp` não sobe (`MCP_SURFACES: superfície desconhecida`), o deploy para no `up --wait` e o
   conector do jogador cai junto. O `test/mcp-config.test.ts` passa o environment do serviço pelo
   `loadConfig` do `apps/mcp` e falha antes disso.
2. O `cdk deploy`, antes do merge, cria o registro `mcp-admin-staging`:

   ```bash
   export AWS_PROFILE=<perfil da conta-membro>
   cd infra
   pnpm synth
   pnpm cdk diff --all
   pnpm cdk deploy --all
   dig +short mcp-admin-staging.spacesports.com.br    # o Elastic IP
   ```

   O diff deve mostrar só um acréscimo: na `SpaceSportsStaging`, o `AWS::Route53::RecordSet` de
   `mcp-admin-staging`. Nada na `SpaceSportsShared`, nada substituído.
3. O merge no `main` e, com a instância ligada, o deploy. A imagem do MCP é a mesma; o Caddy pede o
   certificado de `mcp-admin-staging.` sozinho, assim que o DNS responder.
4. Os [testes](#testar) e, depois, o [`client_id` do Claude](#clientes-do-conector-do-super).

### Testar

```bash
for host in mcp-staging mcp-admin-staging; do
  echo "== $host"
  dig +short "$host.spacesports.com.br"                                   # o Elastic IP
  curl -fsS "https://$host.spacesports.com.br/health"; echo                # {"status":"ok"}
  curl -fsS "https://$host.spacesports.com.br/.well-known/oauth-protected-resource/mcp"; echo
  curl -sS -o /dev/null -D - -X POST "https://$host.spacesports.com.br/mcp" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -i -E '^HTTP|^www-authenticate'
done
curl -fsS https://api-staging.spacesports.com.br/.well-known/oauth-authorization-server/v1/auth
```

O metadata de cada recurso traz o próprio `resource` (`https://mcp-staging.spacesports.com.br/mcp` e
`https://mcp-admin-staging.spacesports.com.br/mcp`) e o mesmo
`"authorization_servers":["https://api-staging.spacesports.com.br/v1/auth"]`; o do jogador anuncia os
escopos de jogador e de gestão, e o do Super só `super:read`. O do servidor de autorização traz o
mesmo `issuer`. O `POST /mcp` sem token responde 401 nos dois, cada um apontando o seu metadata:
`WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp", scope="..."`.
Um host fora dos dois (ex.: o IP direto) não chega ao `mcp`: o Caddy só atende os quatro domínios.

No servidor, em `/opt/space-sports`:

```bash
docker compose ps mcp                        # healthy
docker compose logs --tail 50 mcp            # JSON, uma linha por tool; nada de token
grep -c '^MCP_CONFIRMATION_SECRET=' env/mcp.env   # 1
```

Por fim, o conector no Claude: em **Configurações → Conectores → Adicionar conector personalizado**,
a URL `https://mcp-staging.spacesports.com.br/mcp`. "Conectar" abre o `/entrar` do staging e depois o
consentimento em `/autorizar` (tarefa MCP.3, que precisa estar no ar). Faça a jornada da seção 5 de
`docs/14-mcp.md`: buscar espaço → horários → reservar com Pix → cancelar → aulas. Depois, em "Apps
conectados" (app ou web), "Desconectar" corta o acesso na hora.

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
| Logs | `docker compose logs -f --tail 100 api` (ou `web`, `mcp`) |
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

# API (`@space-sports/api`)

API NestJS do Space Sports (Drizzle + Postgres/PostGIS, BullMQ no Redis). Arquitetura em
`docs/03-arquitetura.md`; modelo de dados em `docs/04-modelo-de-dados.md`. As variáveis de
ambiente estão comentadas no `.env.example` da raiz.

## Banco e seeds

Na raiz do monorepo, com o `docker compose` de pé (`pnpm db:up`):

| Comando | O que faz |
|---|---|
| `pnpm db:migrate` | Aplica as migrações de `apps/api/drizzle`. |
| `pnpm db:seed` | Seed de **produção** (`src/db/seed.ts`): catálogo (esportes, infraestrutura, Belo Horizonte/MG), os espaços parceiros de `docs/08-espacos-parceiros.md` com as quadras e o usuário Super (`SEED_SUPER_*`). |
| `pnpm db:seed:demo` | Seed de **demonstração** (`src/db/demo-seed.ts`), só dev/staging: roda o de produção e acrescenta a equipe dos parceiros, fotos ilustrativas e as logos. |

Os dois seeds são idempotentes e só inserem o que falta: não sobrescrevem o que a implantação
alterou pelo painel e não apagam espaços. O seed dos testes E2E do web (`test/e2e-seed/`) é outro
e não deve ser usado em ambientes reais.

### Seed de produção

- Espaços parceiros (decisão 43): Astral Beach Sports, Arena Errejota e Duna Sports (cidade
  provisória Belo Horizonte/MG), só com nome, slug, cidade e status `ACTIVE`.
- Quadras: Astral 3, Errejota 2, Duna 2, como "Quadra 1".."Quadra N", descobertas, ativas e com
  futevôlei, beach tennis e vôlei de praia (capacidade = padrão do esporte). Só são criadas no
  parceiro que ainda não tem nenhuma quadra.
- Logo, preço, horário, endereço e contatos ficam de fora (preenchidos na implantação).

### Seed de demonstração

```bash
ALLOW_DEMO_SEED=true SEED_DEMO_PASSWORD='uma-senha-de-teste' pnpm db:seed:demo
```

- `ALLOW_DEMO_SEED=true` é obrigatória: é a permissão explícita, além da trava de `NODE_ENV`, e só
  esse valor exato libera. Fica definida de forma permanente **só no staging** (`seed.env`, em
  [Rodar a API](#rodar-a-api)). Em dev, passe na linha de comando; na produção, nunca.
- `SEED_DEMO_PASSWORD` é obrigatória (8 a 128 caracteres; não há padrão no código) e vale para
  todas as contas criadas. Conta que já existe não tem a senha trocada.
- Recusa rodar com `NODE_ENV=production`.
- Cria na Astral uma turma de beach tennis com dois professores (Bruno e Galantine, decisão 47),
  com as aulas das próximas 4 semanas. Horário e capacidade são fictícios, e a turma não é recriada
  nem alterada se já existir.
- Não cria preço, horário de funcionamento nem plano: os espaços continuam fora da vitrine até alguém
  configurar o preço pelo painel.
- Logos: envia `src/db/demo-assets/<slug>.jpg` (cópias de `docs/brand/parceiros/`) pelo mesmo
  serviço do upload do painel, quando o storage (`S3_BUCKET` e `S3_PUBLIC_URL`) está configurado;
  sem ele, pula com um aviso.
  Espaço que já tem logo fica com a dele.
- Fotos: grava 3 fotos **ilustrativas** por parceiro (`DEMO_PHOTOS`; a primeira é a capa). **Não
  são fotos dos espaços**: são do [Unsplash](https://unsplash.com) (licença Unsplash, uso livre
  sem atribuição obrigatória; autor e página de cada uma estão comentados no código), só para a
  vitrine, a página do espaço e o app terem imagens em dev/staging. Ficam como links externos
  para o CDN do Unsplash (`images.unsplash.com`), sem passar pelo storage e sem blurhash, por isso
  entram mesmo sem ele. Espaço que já tem alguma foto (implantação ou painel) fica com as dele.
  Remover uma dessas fotos pelo painel só apaga o registro: o storage só apaga URLs sob
  `S3_PUBLIC_URL`.
- Anúncios (`src/db/demo-ads.ts`, decisões 73 a 79): anunciantes **fictícios** (Rede Quadra, Areia
  Fit, Força Total, Pulso Nutrition, Passada, Movimento Fisio, Verde Vida, Hidrata+) e o destaque da
  Astral Beach Sports (anunciante do tipo espaço, sem imagem, destino na página do espaço), com
  campanhas `ACTIVE` por 90 dias a partir do seed, sem filtro de cidade nem de esporte. As imagens
  (`src/db/demo-assets/ads/`, CC0) passam pelo serviço do upload do /super; sem storage, as peças
  com imagem são puladas e entram no próximo seed com storage. Destinos em `https://example.com/...`
  e WhatsApp com número fictício. Anunciante, campanha e peça que já existem não mudam (nem o
  período).
- Se um dos e-mails abaixo já pertencer a uma conta que o seed não criou (e-mail não verificado
  ou senha diferente de `SEED_DEMO_PASSWORD`), o seed falha sem dar vínculo a ela.

Contas criadas (e-mail verificado, domínio reservado `exemplo.com`; telefone fictício e não
verificado na faixa `(31) 90000-00NN`, que não recebe nada e não serve para login; conta do seed
criada antes do telefone obrigatório ganha o telefone na próxima execução):

| E-mail | Nome | Papel | Espaço |
|---|---|---|---|
| `goiano.astral@exemplo.com` | Goiano | Dono | Astral Beach Sports |
| `bruno.astral@exemplo.com` | Bruno | Professor | Astral Beach Sports |
| `galantine.astral@exemplo.com` | Galantine | Professor | Astral Beach Sports |
| `potenza.astral@exemplo.com` | Potenza | Professor | Astral Beach Sports |
| `marcos.errejota@exemplo.com` | Marcos Oliveira (fictício) | Professor | Arena Errejota |
| `juliana.errejota@exemplo.com` | Juliana Costa (fictício) | Professor | Arena Errejota |
| `thiago.duna@exemplo.com` | Thiago Almeida (fictício) | Professor | Duna Sports |
| `patricia.duna@exemplo.com` | Patrícia Lima (fictício) | Professor | Duna Sports |

Os professores da Arena Errejota e da Duna Sports são fictícios até a implantação levantar os
nomes reais (`docs/08-espacos-parceiros.md`).

## Cadastro, perfil e login social

- **Cadastro por e-mail** (`POST /v1/auth/sign-up/email`): `name`, `email`, `password` e `phone`
  (obrigatório, E.164 brasileiro; ausente ou inválido: 400 `INVALID_PHONE_NUMBER`, antes de
  qualquer consulta; o `PATCH /v1/me/profile` responde o mesmo código e a mesma mensagem). O telefone entra com `phone_verified = false` e pode se repetir entre contas
  (decisão 64). Mecanismo: o hook `before` das rotas do Better Auth valida `body.phone` com o
  `brazilianPhoneSchema` de `@space-sports/shared`, e o hook `user.create.before` o copia para o
  campo `phoneNumber` do modelo do Better Auth (coluna `phone`). Com o login por telefone
  desligado, `phoneNumber`/`phoneNumberVerified` são `additionalFields` com `input: false`; ligado,
  quem os declara é o plugin `phoneNumber`, com os mesmos nomes. Nenhum dos dois entra pelo corpo:
  `phoneNumberVerified` só vira `true` pelo OTP. O mesmo middleware `before` recusa `image` (400
  `IMAGE_NOT_ALLOWED`, `src/auth/profile-image.ts`).
- **Login por telefone (OTP): desligado** em todos os ambientes (decisão 65). O plugin só é
  registrado com `AUTH_PHONE_LOGIN_ENABLED=true` **e** um `SMS_PROVIDER` diferente de `none`; sem
  isso, as rotas `/v1/auth/phone-number/*` respondem 404 e não aparecem no OpenAPI. Antes de
  religar, o telefone precisa ser verificado para valer como login.
- **Perfil**: `GET /v1/me` traz telefone (`phoneVerified`), `birthDate`, `gender`,
  `favoriteSports` e `profile.missing` (`name`/`phone`, o que o "completar cadastro" pede, decisão
  66). `PATCH /v1/me/profile` edita parcialmente; erros `INVALID_PHONE_NUMBER` (400, telefone),
  `VALIDATION_ERROR` (400, demais campos) e `SPORT_NOT_FOUND` (422).
- **Login com Google** (RF-AUTH-01): liga com `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (as duas
  ou nenhuma), de um cliente OAuth "Aplicativo da Web" no Google Cloud Console, com a URL de
  retorno autorizada `<BETTER_AUTH_URL>/v1/auth/callback/google` (em dev,
  `http://localhost:3333/v1/auth/callback/google`; no staging,
  `https://api-staging.spacesports.com.br/v1/auth/callback/google`). No staging e na produção as
  duas ficam no Parameter Store (`api/GOOGLE_CLIENT_ID`, `api/GOOGLE_CLIENT_SECRET`,
  `infra/README.md`); o cliente OAuth do staging/dev está em `docs/09-infra-aws.md` (seção 7). `TRUSTED_ORIGINS` precisa da origem do web **e** do esquema do app,
  `spacesports://`: o app volta do Google por deep link e o Better Auth recusa um `callbackURL`
  fora das origens confiáveis (o staging já tem os dois). Conta nova pelo Google nasce com o
  e-mail verificado, sem telefone e com a foto do Google.
- **Ligação com conta existente** (RN-AUTH-06, `src/auth/social-link.ts`): pelo e-mail, só quando o
  Google confirma o e-mail. Conta de senha já verificada: liga e a senha continua. Conta de senha
  **não** verificada (pré-sequestro): no login implícito pelo callback, vira conta nova antes de
  ligar, direto no banco e numa transação com o usuário travado (sem depender do contexto interno
  do Better Auth): saem senha, sessões, aparelhos de push, telefone não verificado, nascimento,
  gênero e esportes; nome e foto vêm do Google; auditoria `user.unproven_access_revoked`; depois do
  commit, a mídia do usuário no storage é apagada. A ligação explícita (`/link-social`) não revoga;
  qualquer outro caminho é recusado com `account_not_linked`. Fora disso, a foto do Google entra só
  se a conta não tiver foto (decisão 71).

## Imagens Docker

Imagens de produção da API (`apps/api/Dockerfile`) e do web (`apps/web/Dockerfile`), publicadas no
ECR e executadas em Docker na instância EC2 (decisão 56 de `docs/07-perguntas-em-aberto.md`). O
contexto do build é sempre a **raiz do monorepo**. Rodam com o usuário `node`, sem root, e nenhum
segredo entra no build: `.env` e `*.env` ficam de fora pelo `.dockerignore`, e tudo chega no
`docker run`.

### Construir

```bash
docker build -f apps/api/Dockerfile -t space-sports-api .
docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:3333 -t space-sports-web .
```

- Os Dockerfiles não usam recursos do BuildKit: funcionam no `docker build` clássico e no buildx.
- `NODE_VERSION` (build arg, padrão `22`) é conferido com o `.nvmrc`: se divergirem, o build falha.
- `API_URL` é **obrigatório** no web, porque o rewrite de `/v1` entra no manifesto de rotas no
  build. Trocar a origem da API exige construir a imagem de novo.
- O `API_URL` declarado em `apps/web/turbo.json` é o que faz a variável chegar ao `next build`:
  sem isso, o modo estrito do Turbo a esconde e o rewrite cai em `http://localhost:3333`, sem erro.
- A imagem do web precisa de rede no build: o `next/font` baixa as fontes do Google.

**amd64 e arm64:** nada nos Dockerfiles depende da arquitetura, e a base `node:22-bookworm-slim` é
multiarquitetura. A imagem da API não tem binários nativos. A do web instala os da plataforma de
destino (`@next/swc`, `sharp`, `lightningcss`, `@tailwindcss/oxide`), todos com versão arm64 no
lockfile. **O build em arm64 ainda não foi executado:** a máquina de desenvolvimento não tem
buildx nem emulação, e só o amd64 foi construído e testado. Para as duas plataformas:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f apps/api/Dockerfile -t <repositório>:<tag> --push .
```

Na CI, prefira um runner arm64 nativo a emular o `next build` com QEMU, ou construa só a arquitetura
da instância.

### Rodar a API

Variáveis obrigatórias: `DATABASE_URL`, `REDIS_URL`, `SMTP_HOST`, `SMTP_PORT`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` e `ADS_DELIVERY_SECRET` (chave HMAC dos tokens de entrega
dos anúncios, `openssl rand -base64 32`; fora de produção, a API gera uma a cada boot). As demais
estão no `.env.example`.

**Não defina `NODE_ENV` no `api.env`:** a imagem já traz `production`. Com `development`, o logger
pede o `pino-pretty`, que não está na imagem, e a API cai no boot. O `.env.example` traz
`NODE_ENV=development`: não copie essa linha.

```bash
docker run -d --name api --network <rede> --env-file api.env -p 3333:3333 space-sports-api
```

| Tarefa | Comando no contêiner | Equivale a |
|---|---|---|
| API e workers | `node dist/main.js` (padrão da imagem) | `pnpm start` |
| Migrações | `node dist/db/scripts/migrate.js` | `pnpm db:migrate` |
| Seed de produção | `node dist/db/scripts/seed.js` | `pnpm db:seed` |
| Seed de demonstração | `node dist/db/scripts/seed-demo.js` | `pnpm db:seed:demo` |

Os scripts são compilados junto com a API: a imagem não leva `tsx` nem o código TypeScript. As
migrações saem de `drizzle/`, e as logos do seed de demonstração, de `dist/db/demo-assets/` (o
`nest-cli.json` copia).

As senhas dos seeds ficam num `seed.env` separado, com permissão `600` e fora do repositório. Assim
elas não entram no ambiente do contêiner da API, que continua no ar e usa só o `api.env`, nem na
linha de comando, que fica no histórico do shell e na lista de processos. Os contêineres de seed
usam `--rm` e são descartados ao terminar.

```ini
# seed.env. O `--env-file` usa o valor literal: não coloque aspas.
SEED_SUPER_EMAIL=super@exemplo.com
SEED_SUPER_NAME=Super
SEED_SUPER_PASSWORD=
# Só no staging; na produção estas duas linhas não existem.
SEED_DEMO_PASSWORD=
ALLOW_DEMO_SEED=true
```

```bash
docker run --rm --network <rede> --env-file api.env space-sports-api node dist/db/scripts/migrate.js

# O api.env fornece DATABASE_URL (e o S3_*, para as logos do seed de demonstração).
docker run --rm --network <rede> --env-file api.env --env-file seed.env \
  space-sports-api node dist/db/scripts/seed.js

# Seed de demonstração, só no staging: recusa NODE_ENV=production, que é o padrão da imagem.
docker run --rm --network <rede> --env-file api.env --env-file seed.env -e NODE_ENV=development \
  space-sports-api node dist/db/scripts/seed-demo.js
```

Rode as migrações **antes** de subir uma versão nova da API. O `HEALTHCHECK` usa `GET /v1/health`,
que testa o Postgres e o Redis: a API fica `unhealthy` se um deles cair.

### Rodar o web

```bash
docker run -d --name web --network <rede> -p 3000:3000 \
  -e SITE_URL=https://app.spacesports.com.br -e AUTH_PROVIDERS=google space-sports-web
```

| Variável | Quando é lida | Observação |
|---|---|---|
| `API_URL` (rewrite de `/v1`) | Build | Fica fixa no manifesto de rotas. O `docker run` não muda o rewrite. |
| `API_URL` (`server-session.ts`, `server-api.ts`) | Execução | A sessão do `proxy.ts` e a página pública do espaço. A imagem já traz o valor do build como padrão; sobrescrever só muda estas chamadas, então mantenha igual ao do rewrite. |
| `SITE_URL` | Execução | URL canônica e JSON-LD de `/espacos/[slug]`. Vazia: sem URL absoluta. |
| `AUTH_PROVIDERS` | Execução | Botões de login social em `/entrar` e `/cadastro`. |
| `PORT` | Execução | Padrão `3000`. |

O `HEALTHCHECK` usa `GET /health`, que não consulta a API. O web precisa alcançar a API no endereço
de `API_URL`, e `TRUSTED_ORIGINS` e `WEB_URL` da API precisam conter a origem pública do web.

## Fotos no storage (S3)

As fotos (galeria e logo dos espaços, foto de perfil, imagens dos anúncios) ficam no **Amazon S3
com CloudFront** (decisão 72), pela `S3PhotoStorage` (`src/storage/`, AWS SDK v3). O bucket é
privado: o cliente envia o arquivo direto ao S3 por uma URL pré-assinada (PUT, com o `Content-Type`
assinado), e as fotos publicadas são lidas pelo CloudFront, que só alcança `spaces/`, `users/` e
`ads/`.

| Variável | Observação |
|---|---|
| `S3_BUCKET`, `S3_PUBLIC_URL` | Os dois juntos. `S3_PUBLIC_URL` é a base pública (o domínio do CloudFront). Sem eles, os uploads respondem 503 `STORAGE_UNAVAILABLE` e o seed de demonstração pula as logos e as peças de anúncio com imagem. |
| `S3_REGION` | Padrão `sa-east-1`. |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Só para um S3 compatível (o MinIO do dev). |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Só no dev, os dois juntos. Sem eles vale a cadeia padrão do SDK, e nenhuma chave fica no servidor: no staging, o contêiner não alcança o serviço de metadados, e o host entrega credenciais temporárias de um papel de mídia pelo `AWS_CONFIG_FILE` (`credential_process`; ver `infra/README.md`). |

O bucket e o CloudFront do staging são do CDK (`infra/`, tarefa C.3): Block Public Access,
CloudFront com OAC só em `spaces/*`, `users/*` e `ads/*`, expiração de `uploads/` em 1 dia e CORS para o
PUT das origens do web, só com o cabeçalho `Content-Type` (os `headers` devolvidos no pedido de
upload são só esse). O papel usado pela API precisa de `s3:PutObject`, `s3:GetObject`,
`s3:DeleteObject` e `s3:ListBucket` (sem o `ListBucket`, o HEAD de um objeto inexistente responde
403 em vez de 404, e o registro falha em vez de responder "não enviado"). O cliente usa
`requestChecksumCalculation: 'WHEN_REQUIRED'`: sem isso, o SDK põe na URL pré-assinada o checksum do
corpo vazio, e o PUT do arquivo falha.

### Chaves e expiração

A URL pré-assinada (válida por **5 minutos**) aponta para uma chave de upload, sob `uploads/`; o
registro copia o arquivo para uma chave publicada **nova a cada registro**, confere a cópia e só
então grava a URL. Assim, nem a URL pré-assinada (que continua valendo) nem um segundo registro da
mesma chave escrevem no arquivo conferido. O uuid do upload no nome publicado diz que a URL gravada
veio daquele upload: registrar de novo a chave da logo ou da foto atual não muda nada, e a mesma
chave não entra duas vezes na galeria (`PHOTO_ALREADY_ADDED`).

| Upload (URL pré-assinada) | Publicada |
|---|---|
| `uploads/spaces/<spaceId>/<photos\|logo>/<uuid>.<ext>` | `spaces/<spaceId>/<photos\|logo>/<uuid>-<uuid novo>.<ext>` |
| `uploads/users/<userId>/avatar/<uuid>.<ext>` | `users/<userId>/avatar/<uuid>-<uuid novo>.<ext>` |

Os 5 minutos vêm das credenciais do staging: o papel de mídia vale 1 hora, e o SDK só relê as
credenciais a 5 minutos de expirar. Uma URL mais longa poderia vencer antes do `expiresAt`.

O registro apaga o upload, mas um upload que o cliente nunca registra fica no bucket: a regra de
lifecycle do bucket apaga tudo sob `uploads/` **1 dia** após a criação. Nada sob `spaces/` ou
`users/` pode ter regra de expiração. URLs gravadas antes, no formato `<uuid>.<ext>`, continuam
valendo (a chave é achada pela URL pública, `keyFromUrl`).

### MinIO no dev

O `docker-compose.yml` da raiz tem um MinIO opcional (perfil `storage`, não sobe com o
`pnpm db:up`), configurado como o bucket da AWS: `spaces/` e `users/` com leitura pública,
`uploads/` privado e expirando em 1 dia.

```bash
docker compose --profile storage up -d   # sobe o minio e roda o minio-setup (cria o bucket)
```

No `.env`:

```ini
S3_BUCKET=space-sports
S3_PUBLIC_URL=http://localhost:9000/space-sports
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=space_sports
S3_SECRET_ACCESS_KEY=space_sports_minio
```

O console fica em `http://localhost:9001` (mesmo usuário e senha). O MinIO aceita PUT de qualquer
origem, então o web em `localhost:3000` envia direto. O app no emulador Android não alcança o
`localhost` da máquina: use o IP da máquina na rede em `S3_ENDPOINT` e `S3_PUBLIC_URL`. Para parar:
`docker compose --profile storage down` (com `-v`, apaga as fotos).

## Logo do espaço (RF-SPACE-11)

Rotas da gestão (Dono e Admin; espaço suspenso só leitura; o Super entra pelo modo suporte):

1. `POST /v1/manage/spaces/:spaceId/logo/uploads` com `{ contentType, size }` devolve a URL
   pré-assinada do storage.
2. O cliente envia o arquivo com `PUT` nessa URL, com os `headers` devolvidos.
3. `PUT /v1/manage/spaces/:spaceId/logo` com `{ key }` copia o arquivo para a chave publicada,
   confere a cópia e grava `logoUrl` (auditoria `space.logo.update`); a logo anterior é apagada
   do storage.
4. `DELETE /v1/manage/spaces/:spaceId/logo` remove a logo e o arquivo (`space.logo.remove`).

Regras do arquivo: JPEG, PNG ou WebP, **quadrado** (largura = altura) e até **2 MB**
(`LOGO_MAX_BYTES` em `@space-sports/shared`). O tamanho vem do objeto no storage, e o tipo e as
dimensões são lidos dos bytes. Erros: `LOGO_NOT_UPLOADED`, `LOGO_TOO_LARGE`,
`INVALID_LOGO_FILE` (vazio, tipo diferente do pedido ou não quadrado, com `details.width` e
`details.height`), `INVALID_LOGO_KEY` (422) e `STORAGE_UNAVAILABLE` (503). `logoUrl` (nula sem
logo) aparece na busca/mapa, na página do espaço, nos favoritos, em `GET /v1/me`
(`memberships[].space`), em `GET /v1/me/staff-spaces`, no espaço do painel e no Super.

## Foto de perfil (RF-AUTH-02)

Rotas do próprio usuário (só a sessão dele; conta inativa ou bloqueada é barrada pelo guard):

1. `POST /v1/me/avatar/uploads` com `{ contentType, size? }` devolve `{ uploadUrl, method, headers,
   key, expiresAt }`. Até 20 pedidos por hora por usuário (429 `TOO_MANY_REQUESTS`, com
   `X-Retry-After`; ligado com `AUTH_RATE_LIMIT_ENABLED`): cada URL aceita um PUT de qualquer
   tamanho até a conferência.
2. O cliente envia o arquivo com `PUT` na `uploadUrl`, com os `headers` devolvidos.
3. `PUT /v1/me/avatar` com `{ key }` copia o arquivo para uma chave nova em `users/<id>/avatar/`,
   confere a cópia
   e grava `users.avatar_url` (auditoria `user.avatar.update`, sem a URL), respondendo
   `{ avatarUrl }`. A foto anterior é apagada do storage só se tiver sido enviada por este usuário:
   a foto do Google (URL externa, decisão 71) só é substituída.
4. `DELETE /v1/me/avatar` zera `avatar_url` e apaga o arquivo, se for deste usuário (204,
   idempotente; `user.avatar.remove`).

Regras do arquivo: as da logo (JPEG, PNG ou WebP, quadrado, até 2 MB, `AVATAR_MAX_BYTES`).
Erros (422): `INVALID_UPLOAD_KEY` (chave fora do formato ou de outro usuário), `UPLOAD_NOT_FOUND`,
`IMAGE_TOO_LARGE`, `INVALID_IMAGE_FILE` e `IMAGE_NOT_SQUARE` (com `details.width` e
`details.height`); `STORAGE_UNAVAILABLE` (503). `GET /v1/me` devolve `avatarUrl`.

A foto só muda por essas rotas: o Better Auth recusa `image` em `POST /v1/auth/sign-up/email` e
`POST /v1/auth/update-user` (400 `IMAGE_NOT_ALLOWED`, `src/auth/profile-image.ts`), senão
`avatar_url` mudaria sem apagar a foto enviada. O login social grava a foto do Google pelo cadastro
interno do Better Auth, sem passar por essas rotas.

LGPD: atender o pedido de exclusão (Super) anonimiza a conta e, depois do commit, apaga do storage
tudo sob `users/<id>/` e `uploads/users/<id>/` (lista e apaga em lote; alcança também os órfãos de
uma troca que falhou). Falha no storage só é logada e não desfaz a anonimização.

## Testes

```bash
pnpm --filter @space-sports/api test               # unitários
pnpm --filter @space-sports/api test:integration   # Postgres real via Testcontainers (Docker)
```

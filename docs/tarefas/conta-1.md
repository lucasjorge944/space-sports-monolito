# Conta e perfil 1 — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Checklist em `docs/06-roadmap.md`, seção "Conta e perfil". Decisões de produto: 64 a 72 de `docs/07-perguntas-em-aberto.md` (leia antes de começar).

**Plano padrão:** `forte`

**Ordem:** Onda 1 (C.1, C.2 e C.3 em paralelo) → merge, `openapi.json` e lockfile regenerados → Onda 2 (C.4 e C.5 em paralelo) → Onda 3 (C.6) → deploy no staging, APK novo e conferência no emulador. Em paralelo, a sessão principal faz com o usuário a C.0 (cliente OAuth do Google e variáveis).

**Resumo do que entra:**
- Telefone obrigatório em todo cadastro de usuário, **sem verificação** (decisão 64). Login por telefone **desligado** (decisão 65).
- Etapa "completar cadastro" (nome e telefone) para quem não tem telefone (contas antigas e Google, decisão 66).
- Perfil com nome, foto, telefone, e-mail (só leitura, com reenvio da verificação), senha, data de nascimento, gênero e esportes favoritos com nível opcional (decisões 67 a 69).
- Cadastro em duas etapas: "Conta" e "Sobre você" (nascimento, gênero e esportes), esta com "Pular" (decisão 70).
- Fotos (espaços e perfil) no **Amazon S3 com CloudFront**, no lugar do Cloudflare R2 (decisão 72). Foto do Google como foto inicial (decisão 71).
- Login com Google no app e no painel: o código existe; falta a configuração (C.0) e a proteção da junção de contas (C.2).

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz e as decisões 64 a 72 em `docs/07-perguntas-em-aberto.md` antes de começar. Documentação em português (BR); código em inglês.
- Máquina com pouca RAM. Máximo de 2 workers nos testes, SEMPRE explícito na linha de comando (API e web: `--maxWorkers=2`; mobile: `npx jest --maxWorkers=2`), `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados, Playwright com 1 worker e só das specs afetadas. Durante o trabalho, rode só os testes afetados; a suíte completa da sua área, uma vez no final. Não rode `next build` sem necessidade. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333 e 8081; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Contrato OpenAPI muda só em tarefa de API, com o cliente regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo branch. Depois de trazer o `main`, rode `pnpm install` e `pnpm --filter @space-sports/shared build`.
- Migrações: a C.2 usa `0023`. Ao terminar, traga o `main`; se outra migração entrou antes, regenere a sua com o próximo número livre, para o `_journal` e os snapshots ficarem em cadeia.
- Datas em UTC e exibição em `America/Sao_Paulo`; a data de nascimento é uma data civil (`date`, sem fuso). Sem cor fixa nas telas: tudo por `packages/ui-tokens`, nos temas claro e escuro, seguindo o kit `docs/brand/kit/`.
- Web: sem testes de CSS ou classe (`toHaveClass`, `toHaveCSS`, `toHaveStyle`, `getComputedStyle`, `cn()`); teste só comportamento.
- Nenhum segredo no repositório: chaves entram por variável de ambiente (Parameter Store, EAS env ou `.env` local fora do git).
- Atualize `docs/02-requisitos-funcionais.md` e `docs/04-modelo-de-dados.md` (e `docs/05-design-system.md`, `docs/09-infra-aws.md` quando couber) com o que mudou. Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português) e com typecheck, `pnpm lint` na raiz e os testes da sua área passando. Relate o que ficou de fora.

## Onda 1 — API e infraestrutura

### C.1 · API: fotos no S3 e foto de perfil
- **Agente:** `api-engineer`
- **Branch:** `feat/account-s3-avatar`

**Prompt**
```
Em apps/api, troque o armazenamento das fotos do Cloudflare R2 pelo Amazon S3 (decisão 72 de docs/07-perguntas-em-aberto.md) e crie a foto de perfil do usuário (decisões 67 e 71). Leia antes apps/api/src/storage/ (PhotoStorage, R2PhotoStorage, sigv4), apps/api/src/spaces/space-uploads.ts, space-logo.service.ts e o fluxo das fotos do espaço, e apps/api/src/users/anonymize.ts.

(1) S3. Implemente `S3PhotoStorage` (mesma classe abstrata `PhotoStorage`, que continua sendo o token de injeção e o fake dos testes) com o AWS SDK for JavaScript v3 (`@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner`): presign de PUT com Content-Type, HEAD, leitura limitada a `maxBytes + 1`, CopyObject (mantendo o Content-Type), DELETE, `publicUrl` e `keyFromUrl`. Credenciais pela cadeia padrão do SDK: no staging/production vêm do papel da instância EC2 (sem chaves no servidor); no dev, opcionais por env. Variáveis novas no lugar das `R2_*`, validadas em src/config/env.ts:
  - `S3_BUCKET` e `S3_PUBLIC_URL` (base pública, o domínio do CloudFront); sem os dois, o upload responde 503 `STORAGE_UNAVAILABLE`, como hoje;
  - `S3_REGION` (padrão `sa-east-1`);
  - opcionais para dev com MinIO: `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` (os dois juntos ou nenhum).
  Remova o R2PhotoStorage, as variáveis `R2_*` e o sigv4 próprio se nada mais usar. Acrescente um serviço `minio` opcional ao docker-compose.yml da raiz (atrás de um `profiles: [storage]`, para não subir por padrão), com um passo de criação do bucket, e documente no apps/api/README.md como usá-lo. Atualize .env.example, o seed de demonstração (logos) e as referências a R2 em apps/api/README.md, infra/README.md e infra/staging/compose.yml (só os nomes das variáveis e dos parâmetros; o CDK do bucket é da tarefa C.3, que roda em paralelo: combine os nomes `S3_BUCKET`, `S3_PUBLIC_URL`, `S3_REGION`). Não há dados no R2 para migrar: o staging nunca teve R2 configurado.

(2) Prefixos. Todo upload continua sob `uploads/` (uma regra de expiração de 1 dia no bucket limpa os abandonados), e o publicado fica fora do alcance da URL pré-assinada:
  - espaço: `uploads/spaces/<spaceId>/<photos|logo>/<uuid>.<ext>` → `spaces/<spaceId>/<photos|logo>/<uuid>.<ext>` (ajuste `space-uploads.ts`; as URLs já gravadas continuam válidas pelo `keyFromUrl`);
  - perfil: `uploads/users/<userId>/avatar/<uuid>.<ext>` → `users/<userId>/avatar/<uuid>.<ext>`.

(3) Foto de perfil, no mesmo esquema da logo do espaço (imagem quadrada, JPEG/PNG/WebP, conferida pelo `image-info` depois da cópia; limite de tamanho igual ao da logo):
  - `POST /v1/me/avatar/uploads` `{ contentType }` → `{ key, uploadUrl, headers, expiresAt }`;
  - `PUT /v1/me/avatar` `{ key }` → copia para a chave publicada, confere, grava `users.avatar_url` e apaga a foto anterior se ela for deste storage (`keyFromUrl`); URL externa, como a foto do Google, não é apagada (decisão 71) → responde `{ avatarUrl }`;
  - `DELETE /v1/me/avatar` → apaga o objeto (se for deste storage) e zera `avatar_url` (204).
  Só o próprio usuário; conta inativa/bloqueada já é barrada pelo guard. Erros com códigos estáveis (`STORAGE_UNAVAILABLE`, `INVALID_UPLOAD_KEY`, `IMAGE_NOT_SQUARE`/os que a logo já usa — reaproveite). `GET /v1/me` já devolve `avatarUrl`: confira.

(4) LGPD: a anonimização (users/anonymize.ts) e o atendimento do pedido de exclusão passam a apagar o objeto da foto no storage (se for deste storage) depois do commit; falha no storage só é logada, não desfaz a anonimização.

Testes de integração (vitest, `--maxWorkers=2`) com o fake do storage: upload/registro/troca/remoção da foto, chave de outro usuário recusada, foto do Google não apagada, anonimização apaga o objeto; teste unitário do S3PhotoStorage com o cliente do SDK simulado (presign com Content-Type, keyFromUrl, copy). Atualize o OpenAPI e regenere o api-client. Atualize docs/04 (avatar_url) e docs/02 (RF-AUTH-02 com a foto).
```

### C.2 · API: telefone no cadastro, perfil completo e Google
- **Agente:** `api-engineer`
- **Branch:** `feat/account-profile-api`

**Prompt**
```
Em apps/api e packages/shared, implemente o telefone no cadastro, o perfil completo e as proteções do login com Google (decisões 64 a 71 de docs/07-perguntas-em-aberto.md; leia-as antes). Leia src/auth/auth.ts (hooks do Better Auth, plugin phoneNumber), src/me/, src/db/schema/identity.ts (`users`, `user_sport_profiles`), src/users/anonymize.ts e src/contacts/contact-store.ts.

(1) Login por telefone desligado (decisão 65). O plugin `phoneNumber` do Better Auth passa a ser registrado só com `AUTH_PHONE_LOGIN_ENABLED=true` (padrão false em todos os ambientes, inclusive dev e test) E um `SMS_PROVIDER` diferente de `none`. Motivo, que vai num comentário: com telefones não verificados em `users.phone`, o OTP entraria na conta de quem digitou o número; religar exige antes verificar o telefone. Mantenha o SmsSender e o código do plugin. Se o api-client regenerado perder `phoneNumberSendOtp`/`phoneNumberVerify`, remova no mesmo branch o login por telefone do app (botão "Entrar com telefone" em apps/mobile/src/app/(auth)/entrar.tsx, a tela (auth)/telefone.tsx e as ações em src/features/auth/actions.ts), para o typecheck do mobile continuar verde; é a única mudança permitida em apps/mobile nesta tarefa.

(2) Telefone (decisão 64). Migração `0023`:
  - troque o UNIQUE de `users.phone` por um índice único parcial só para verificados (`WHERE phone_verified`); números digitados podem se repetir e não revelam se outro cadastro existe;
  - o CHECK E.164 continua.
  Cadastro por e-mail (`POST /v1/auth/sign-up/email`): passa a aceitar e exigir `phone` em E.164 brasileiro (`+55`, DDD e 8 ou 9 dígitos; valide também no Zod de packages/shared, reaproveitável pelo web e pelo mobile), gravado com `phone_verified = false`. Hoje o hook `user.create.before` descarta o telefone no cadastro por e-mail: ajuste, mantendo o descarte de `phoneNumberVerified` vindo do cliente (verificado só pelo OTP). Escolha o mecanismo (additionalFields do Better Auth ou leitura do corpo no hook) que não conflite com o mapeamento do plugin quando ele voltar; documente. Login social (Google) não traz telefone: a conta nasce sem ele.
  Contatos (decisão 48) NÃO mudam: sugestão ao organizador, resgate de vaga e exclusão continuam olhando só telefone verificado (confira contact-store.ts, invites.service.ts e deletion-cleanup; acrescente teste que prove que um telefone não verificado igual ao de um contato não vincula nem sugere).

(3) Perfil (decisões 67 a 70). Migração (na mesma `0023`): enum `gender` (`FEMALE`, `MALE`, `OTHER`, `UNDISCLOSED`) em `users.gender` (hoje texto livre, sem uso: converta, nulos ficam nulos) e `user_sport_profiles.level` passa a aceitar nulo.
  - `GET /v1/me` passa a devolver `phone` (com `phoneVerified`), `birthDate` (`YYYY-MM-DD` ou nulo), `gender`, `favoriteSports: [{ sport: { id, name, slug }, level | null }]` e `profile.missing: ('name' | 'phone')[]` (o que a etapa "completar cadastro" exige, decisão 66; nascimento, gênero e esportes nunca entram).
  - `PATCH /v1/me/profile` parcial: `name`, `phone`, `birthDate` (não pode ser futura nem anterior a 1900), `gender` (ou nulo), `favoriteSports` (lista completa que substitui a anterior, esportes ativos do catálogo, sem repetição, nível opcional). Trocar o telefone grava `phone_verified = false`. Retorna o mesmo formato do `/me`. Validação com Zod de packages/shared, erros com códigos estáveis. Auditoria só se já houver padrão para o próprio usuário (sem dados pessoais no log).
  - A anonimização passa a limpar `birth_date`, `gender` e apagar os `user_sport_profiles`.
  - Super: a lista/detalhe de usuários mostra o telefone com `phoneVerified`; confira se a busca por telefone continua funcionando com números repetidos.

(4) Google (decisão 71 e segurança). Confira a configuração de `account.accountLinking` do Better Auth e escreva testes para: login Google com e-mail novo cria conta verificada sem telefone (`profile.missing` = ['phone']); login Google com e-mail de conta de senha JÁ verificada liga as contas; login Google com e-mail de conta de senha NÃO verificada não pode deixar a senha antiga funcionando (pré-sequestro de conta): ao ligar, apague a credencial de senha e encerre as outras sessões, ou recuse a ligação com um código claro — escolha, justifique no docs/02 e teste. Foto do Google: vira o `avatar_url` só quando a conta não tem foto; nunca sobrescreve a enviada pelo usuário. Confira que `TRUSTED_ORIGINS` precisa de `spacesports://` para o app (já está no staging) e documente as variáveis do Google em apps/api/README.md e no .env.example (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, URL de retorno `<BETTER_AUTH_URL>/v1/auth/callback/google`).

(5) Seed e testes: o seed de demonstração e o seed do e2e (apps/api/test/e2e-seed) passam a dar telefone (fictício, não verificado) às contas; helpers de cadastro dos testes enviam `phone`. Rode as suítes da API afetadas (vitest `--maxWorkers=2`) e, no fim, a suíte inteira uma vez. Atualize o OpenAPI, regenere o api-client e atualize docs/02 (RF-AUTH-01 e 02, com a nota de que o login por telefone está desligado) e docs/04 (users, user_sport_profiles).
```

### C.3 · Infra: bucket S3 e CloudFront
- **Agente:** `api-engineer`
- **Branch:** `feat/infra-media-bucket`

**Prompt**
```
Em infra/ (CDK em TypeScript), crie o armazenamento das fotos do staging na AWS (decisão 72 de docs/07-perguntas-em-aberto.md). Leia infra/README.md, infra/lib/*.ts (SharedStack, StagingStack, papel da instância) e infra/staging/compose.yml. A tarefa C.1 (em paralelo) troca a API do R2 para o S3 e lê `S3_BUCKET`, `S3_PUBLIC_URL` e `S3_REGION`.

(1) Bucket do staging em `sa-east-1` (nome derivado do ambiente, ex.: `space-sports-media-staging-<conta>`): Block Public Access total, criptografia SSE-S3, `enforceSSL`, versionamento desligado, `RemovalPolicy.RETAIN`. Regras de ciclo de vida: expirar `uploads/` em 1 dia e abortar multipart incompleto em 1 dia. CORS: PUT e GET das origens web do ambiente (`https://staging.spacesports.com.br` e, para dev, `http://localhost:3000`), cabeçalho `Content-Type`, `MaxAge` razoável.
(2) CloudFront na frente, com Origin Access Control (OAC), só GET/HEAD, HTTPS obrigatório, cache otimizado para imagens. A política do bucket libera ao CloudFront só `spaces/*` e `users/*` (nunca `uploads/*`). No staging, use o domínio padrão `*.cloudfront.net` (sem certificado); deixe documentado como seria `media.spacesports.com.br` em production (certificado ACM em `us-east-1`).
(3) Papel da instância: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` em `<bucket>/*` e `s3:ListBucket` no bucket (para o HEAD de objeto inexistente responder 404 e não 403). Nada de chaves de acesso.
(4) Saídas e configuração: exporte o nome do bucket e o domínio do CloudFront (CfnOutput) e faça o compose do staging receber `S3_BUCKET`, `S3_PUBLIC_URL` (`https://<domínio>`) e `S3_REGION` pelo mesmo caminho que as outras variáveis não secretas usam hoje (confira como o deploy monta o env). Remova as referências a `R2_*` do infra/README.md e do compose (coordenar nomes com a C.1).
(5) Testes do CDK (infra/test, com assertions do template): Block Public Access, lifecycle de `uploads/`, OAC, política sem `uploads/*`, permissões da instância. Rode `cdk synth` (sem deploy: o deploy é feito pela sessão principal com o usuário) e os testes do infra.
(6) Documente em docs/09-infra-aws.md (tabela da seção 3 e "O que continua fora da AWS": as fotos saem do R2), infra/README.md (como aplicar e conferir) e o custo estimado (S3 e CloudFront em sa-east-1 para o piloto).
```

## Onda 2 — Telas

### C.4 · Web: cadastro com telefone, completar cadastro e Meu perfil
- **Agente:** `web-engineer`
- **Branch:** `feat/account-profile-web`

**Prompt**
```
Em apps/web, implemente o telefone no cadastro, a etapa "Sobre você", o completar cadastro e a página Meu perfil (decisões 64 a 71 de docs/07-perguntas-em-aberto.md). A API já está no main (tarefas C.1 e C.2 de docs/tarefas/conta-1.md): leia o OpenAPI regenerado em packages/api-client e os Zod de packages/shared. Siga o design system (shadcn/ui, tokens de packages/ui-tokens, kit em docs/brand/kit/), as máscaras e os padrões de erro de campo já usados no web (tarefa A.7).

(1) Cadastro (`/cadastro`, inclusive o fluxo que vem do convite de equipe com o e-mail travado): etapa "Conta" com nome, e-mail, senha e **telefone obrigatório** (máscara brasileira `(31) 99999-8888`, enviado em E.164 `+55…`). Depois da conta criada, etapa "Sobre você": data de nascimento (seletor de data do shadcn, dd/mm/aaaa), gênero (Feminino, Masculino, Outro, Prefiro não informar) e esportes favoritos (catálogo `/v1/sports`, múltipla escolha, nível opcional por esporte: Iniciante, Intermediário, Avançado, Profissional), salvos por `PATCH /v1/me/profile`, com "Pular". Ao pular ou salvar, segue o destino que o cadastro já tinha (convite, painel etc.).
(2) Completar cadastro: quem entra no `/painel` ou no `/super` com `profile.missing` não vazio (conta antiga sem telefone, login Google) vai para uma tela que pede só o que falta (nome e/ou telefone), seguida da etapa "Sobre você" com "Pular" quando a conta é nova (Google). Não dá para usar o painel sem completar; "Sair" disponível.
(3) Meu perfil: página acessível pelo menu da conta (UserMenu) no `/painel` e no `/super` (um componente, duas rotas, ex.: `/painel/perfil` e `/super/perfil`), com: foto (enviar com recorte quadrado no navegador antes do upload, trocar, remover; fluxo `POST /v1/me/avatar/uploads` → PUT na URL → `PUT /v1/me/avatar`; reaproveite o que a logo do espaço já faz em components/painel/espaco/logo-card.tsx), nome, telefone, e-mail só leitura com selo verificado/não verificado e "Reenviar verificação", data de nascimento, gênero, esportes favoritos com nível, e "Alterar senha" (Better Auth `changePassword`; para conta só Google, sem senha, explique que o login é pelo Google). Mostre a foto (ou iniciais) no botão do UserMenu.
(4) Login com Google: os botões já existem e dependem de `AUTH_PROVIDERS`; confira o fluxo em `/entrar` e no cadastro do convite (o aceite exige o mesmo e-mail, verificado: o Google serve). Configure os domínios de imagem que o web usa para fotos (CloudFront do `S3_PUBLIC_URL` e `lh3.googleusercontent.com`) por variável de ambiente, se o web usar `next/image`.
(5) Super: na lista e no detalhe de usuários, telefone com indicação de não verificado.
(6) Contrato real (C.1/C.2 no main): erros `INVALID_PHONE_NUMBER` (cadastro e PATCH do perfil), `IMAGE_NOT_ALLOWED` (o Better Auth não aceita `image`: a foto só vai pelo fluxo `/v1/me/avatar`), `IMAGE_TOO_LARGE`, `IMAGE_NOT_SQUARE`, `INVALID_IMAGE_FILE`, `STORAGE_UNAVAILABLE` (503: mostre "envio de fotos indisponível") e 429 `TOO_MANY_REQUESTS` no pedido de URL de upload (20 por hora). A foto até 2 MB e quadrada; a URL de upload vale 5 minutos. O Super do seed não tem telefone e vai cair no completar cadastro (esperado).
(7) Testes existentes: as specs reais em apps/web/e2e/real/ (helpers em e2e/real/support/api.ts) e o mock em e2e/mock-api.mjs cadastram sem `phone` e falham com 400: atualize-os para enviar telefone e para lidar com o completar cadastro.
Testes de comportamento (vitest e Playwright com API simulada, 1 worker, só as specs afetadas): cadastro com telefone inválido/válido, pular "Sobre você", completar cadastro bloqueando o painel, editar perfil, troca de foto (mock do upload). Atualize docs/05 (telas) se couber.
```

### C.5 · Mobile: cadastro com telefone, completar perfil e editar perfil
- **Agente:** `mobile-engineer`
- **Branch:** `feat/account-profile-mobile`

**Prompt**
```
Em apps/mobile, implemente o telefone no cadastro, a etapa "Sobre você", o completar perfil e o editar perfil completo (decisões 64 a 71 de docs/07-perguntas-em-aberto.md). A API já está no main (tarefas C.1 e C.2 de docs/tarefas/conta-1.md): leia o api-client regenerado e os Zod de packages/shared. Siga NativeWind, React Native Reusables, tokens de packages/ui-tokens e as máscaras/erros de campo já usados (tarefa A.8).

(1) Login por telefone desligado (decisão 65): confira que o botão "Entrar com telefone", a tela (auth)/telefone.tsx e as ações não existem mais (a C.2 pode ter removido); remova o que sobrar.
(2) Cadastro ((auth)/cadastro.tsx): etapa "Conta" com nome, e-mail, senha e **telefone obrigatório** (máscara `(31) 99999-8888`, teclado `phone-pad`, enviado em E.164 `+55…`). Depois da conta criada, etapa "Sobre você": data de nascimento (dd/mm/aaaa), gênero (Feminino, Masculino, Outro, Prefiro não informar) e esportes favoritos (catálogo `/v1/sports`, nível opcional por esporte: Iniciante, Intermediário, Avançado, Profissional), salvos por `PATCH /v1/me/profile`, com "Pular". Depois segue o fluxo atual (localização, convite pendente etc.).
(3) Completar perfil (completar-perfil.tsx): passa a valer para `profile.missing` não vazio (nome e/ou telefone): conta antiga sem telefone e login Google. Pede só o que falta, seguido da etapa "Sobre você" com "Pular" quando a conta é nova. Sem completar, o app não segue; "Sair" disponível.
(4) Editar perfil ((conta)/editar-perfil.tsx): foto (expo-image-picker com recorte quadrado `allowsEditing`/`aspect [1,1]`, qualidade reduzida; câmera ou galeria; trocar e remover; fluxo `POST /v1/me/avatar/uploads` → PUT na `uploadUrl` com os `headers` → `PUT /v1/me/avatar`), nome, telefone, e-mail só leitura com selo verificado/não verificado e "Reenviar verificação", data de nascimento, gênero, esportes com nível. Mostre a foto (ou iniciais) no topo da aba Perfil. Configure as permissões e textos do expo-image-picker no app.config.ts (iOS: câmera e fotos; Android: sem permissões além do necessário). Use expo-image para exibir a foto.
(4b) Contrato real (C.1/C.2 no main): a C.2 já pôs um campo Telefone simples no cadastro (parta dele, com máscara e validação do Zod `brazilianPhoneSchema` de packages/shared). Erros `INVALID_PHONE_NUMBER` (cadastro e PATCH do perfil), `IMAGE_NOT_ALLOWED` (o `updateUser` do Better Auth não aceita `image`: a foto só vai pelo fluxo `/v1/me/avatar`), `IMAGE_TOO_LARGE`, `IMAGE_NOT_SQUARE`, `INVALID_IMAGE_FILE`, `STORAGE_UNAVAILABLE` (503) e 429 `TOO_MANY_REQUESTS` no pedido de URL de upload. Foto até 2 MB e quadrada; a URL vale 5 minutos (peça a URL só na hora de enviar).
(5) Login com Google: os botões já existem e dependem de `EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS`; confira que conta nova pelo Google cai no completar perfil. Documente no apps/mobile/README.md a variável no EAS (perfil `preview`).
Testes (`npx jest --maxWorkers=2`, só os afetados e a suíte uma vez no fim): validação do telefone, etapa "Sobre você" com pular, completar perfil por `missing`, upload da foto (mock). Atualize os fluxos Maestro em apps/mobile/.maestro do cadastro, com `testID` nos campos novos (não execute). Lembre no relato que o expo-image-picker exige um APK novo.
```

## Onda 3 — Qualidade

### C.6 · QA: cadastro, perfil, fotos e Google
- **Agente:** `qa-engineer`
- **Branch:** `test/account-profile`

**Prompt**
```
Escreva e rode testes que verificam as regras das decisões 64 a 72 de docs/07-perguntas-em-aberto.md, já implementadas no main (tarefas C.1 a C.5 de docs/tarefas/conta-1.md). Não altere código de produção: relate os bugs com passos para reproduzir.

(1) API (integração, vitest `--maxWorkers=2`): cadastro exige telefone válido brasileiro; dois cadastros com o mesmo telefone não verificado são aceitos; o login por telefone não está exposto (rotas do plugin respondem 404); `profile.missing`; `PATCH /v1/me/profile` (datas inválidas, esporte inativo/repetido, nível nulo, troca de telefone volta a não verificado); telefone não verificado igual ao de um contato não vincula nem gera `suggestedUser`; foto de perfil (troca apaga a anterior, chave de outro usuário recusada, foto externa do Google preservada); anonimização limpa nascimento, gênero, esportes e a foto. Complete o que a C.1/C.2 não cobriu.
(2) Web E2E real (apps/web/e2e/real, Playwright 1 worker, só as specs novas/afetadas): cadastro com telefone e etapa "Sobre você" (preencher e pular); conta sem telefone é levada ao completar cadastro antes do painel; Meu perfil edita os campos e persiste; convite de equipe com telefone no cadastro. Upload de foto real só se houver storage no ambiente de teste; senão, documente a lacuna.
(3) Mobile: revise os fluxos Maestro de cadastro e perfil em apps/mobile/.maestro (não execute; não há emulador nesta máquina).
Atualize o roadmap? Não: relate a cobertura e as lacunas para a sessão principal.
```

## Prompt de revisão

```
Revise o branch da tarefa <número> de docs/tarefas/conta-1.md contra o main: correção, aderência às decisões 64 a 72 de docs/07-perguntas-em-aberto.md e às RF/RN de docs/02, segurança (telefone não verificado nunca vale como prova de identidade nem habilita login; uploads só nas chaves do próprio usuário/espaço; nada público em `uploads/`; junção de conta Google sem pré-sequestro; nenhum segredo commitado), LGPD (anonimização limpa os dados novos e a foto), contrato OpenAPI e api-client em sincronia, temas claro/escuro sem cor fixa e testes. Somente leitura: não altere arquivos. Liste os achados por gravidade, com arquivo e linha.
```

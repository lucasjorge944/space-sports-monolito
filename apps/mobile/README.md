# @space-sports/mobile

App Expo (jogador + modo gestão). `pnpm dev` na raiz (turbo) ou `pnpm --filter @space-sports/mobile dev`.

## Pacotes do workspace

`@space-sports/shared` é consumido a partir de `dist/` (`main`). O `dev` do turbo builda o shared antes de subir, mas mudanças posteriores no shared só aparecem no app se o build ou o watch dele estiver rodando (`pnpm --filter @space-sports/shared dev`).

## Mapa, localização e push

- **Mapa (Android):** o `react-native-maps` usa o Google Maps e precisa de chave em `android.config.googleMaps.apiKey` (no `app.config.ts`, lida de `GOOGLE_MAPS_ANDROID_API_KEY`); no iOS usa o Apple Maps. Sem a chave, o mapa Android fica em branco.
- **Localização:** `expo-location` (só em uso). A posição é arredondada para ~1 km antes de ir para a API.
- **Push:** o token só é registrado em aparelho físico e com `extra.eas.projectId` configurado (EAS); no simulador o registro é ignorado.
- **Deep link do convite:** `spacesports://convite/<token>` (rota `convite/[token]`).
- **Foto do perfil:** `expo-image-picker` (galeria pelo seletor do sistema, sem permissão de armazenamento; câmera com permissão pedida na hora) com recorte quadrado, e `expo-image-manipulator` para cortar em quadrado exato e reduzir a 512 px em JPEG antes do envio (a API só aceita imagem quadrada de até 2 MB). São módulos nativos: exigem um build novo (APK) a partir desta versão. No Android, o microfone e a leitura do armazenamento ficam bloqueados no `app.config.ts`; a escrita (`WRITE_EXTERNAL_STORAGE`, que o seletor declara só até o Android 12) fica, porque a câmera dele a exige no Android 7 a 9. O JPEG gerado e o recorte do seletor são apagados do cache depois do envio, e ao sair da conta o cache de imagens do `expo-image` (memória e disco) é limpo.
- **Deep link do espaço:** `spacesports://espacos/<slug>` (o "Abrir no app" da página pública). A rota `espacos/[slug]` só redireciona para `espaco/[slug]`; deslogado, guarda o slug e abre o espaço depois do login (`EntryGate`), como o convite.

## Build (EAS)

Configuração em `app.config.ts` (app `br.com.spacesports.app`, versão `0.1.0`) e perfis em `eas.json`. O número do build (versionCode/buildNumber) fica no EAS (`appVersionSource: remote`). Os comandos usam `npx eas-cli@latest` (o eas-cli não é dependência do projeto); faça login antes com `npx eas-cli@latest login`.

### Variáveis

O `app.config.ts` lê `EAS_PROJECT_ID`, `EXPO_OWNER`, `GOOGLE_MAPS_ANDROID_API_KEY` e `GOOGLE_SERVICES_JSON` de `process.env`; vazias, as chaves correspondentes ficam fora da config. De onde elas vêm:

- **Build na nuvem (worker do EAS):** das variáveis do EAS do *environment* do perfil (`preview` ou `production`, em expo.dev → projeto → Environment variables ou `eas env:set`). O `env` do `eas.json` só define a `EXPO_PUBLIC_API_URL`.
- **`npx expo config`, `expo run:*` e o eas-cli na sua máquina:** precisam estar **exportadas no shell** (`export EAS_PROJECT_ID=...`). O eas-cli **não lê o `.env`**: ele avalia o `app.config.ts` só com o ambiente do shell e as variáveis do EAS que puder baixar (plain text e sensitive), e precisa do `EAS_PROJECT_ID` antes disso para achar o projeto. O `.env.example` só lista os nomes.
- **GitHub Actions:** `EAS_PROJECT_ID` e `EXPO_OWNER` como *variables* do repositório; `EXPO_TOKEN` como *secret*.

| Variável | Onde definir | Para quê |
|---|---|---|
| `EAS_PROJECT_ID` | Shell de quem roda o eas-cli e variável do repositório no GitHub (no EAS é opcional) | `extra.eas.projectId` (o push precisa dele). Id em expo.dev → projeto → Overview. No worker do EAS, se faltar, vale o `EAS_BUILD_PROJECT_ID` do próprio build. |
| `EXPO_OWNER` | Idem | `owner` do projeto (conta ou organização no Expo). |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Variável do EAS, visibilidade **Sensitive**, nos environments `preview` e `production` (no shell só para build local) | Chave do Google Maps no Android. Sem ela o build sai, mas o mapa Android fica em branco. |
| `GOOGLE_SERVICES_JSON` | Variável **de arquivo** do EAS, visibilidade **Secret**, nos environments `preview` e `production` | `android.googleServicesFile` (push no Android, ver abaixo). No worker ela vira o caminho do arquivo. Sem ela, vale `./google-services.json` se existir (o arquivo está no `.gitignore`); sem nenhum dos dois, o campo fica de fora. |
| `EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS` | Variável do EAS, visibilidade **Plain text**, no environment `preview` (e no `production` quando o Google estiver configurado lá) | Botões de login social (`google`, `apple`, separados por vírgula; vazio = sem botões). Não é lida pelo `app.config.ts`: o Metro embute o valor no bundle (`EXPO_PUBLIC_*`), então trocar exige um build novo. Ver "Login com Google" abaixo. |
| `EXPO_TOKEN` | Secret do repositório no GitHub | Login do eas-cli no workflow `EAS build`. Token em expo.dev → Access tokens (de preferência de um robot user). |

Para criar as variáveis no EAS:

```sh
npx eas-cli@latest env:set --name GOOGLE_MAPS_ANDROID_API_KEY --value <chave> \
  --environment preview --environment production --visibility sensitive
npx eas-cli@latest env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json \
  --environment preview --environment production --visibility secret
npx eas-cli@latest env:set --name EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS --value google \
  --environment preview --visibility plaintext
```

### Login com Google

O app abre o login social da API no navegador do sistema e volta por `spacesports://` (por isso a
API precisa de `spacesports://` no `TRUSTED_ORIGINS`, e de `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
com a URL de retorno `<BETTER_AUTH_URL>/v1/auth/callback/google`; ver `apps/api/README.md`). No app,
o botão "Continuar com Google" só aparece com `google` em `EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS`: no APK
de teste, crie a variável no environment `preview` do EAS (comando acima) e gere um build novo.

Conta nova pelo Google nasce sem telefone: o `/v1/me` traz `profile.missing: ['phone']` e o app só
libera a tela "Complete seu cadastro" (decisão 66), seguida da etapa "Sobre você" com "Pular"
(decisão 70). A foto do Google vira a foto inicial do perfil até a pessoa enviar outra (decisão 71).

**Chave do Maps no Google Cloud:** restrinja a chave a "Apps Android" com o pacote `br.com.spacesports.app` e o SHA-1 do certificado de assinatura que o EAS usa. O SHA-1 aparece em `npx eas-cli@latest credentials` (Android → perfil → Keystore). Se o app for para a Play Store com assinatura pelo Google Play, acrescente também o SHA-1 da chave de assinatura do app (Play Console → Integridade do app). Ative só a "Maps SDK for Android" nessa chave. Não adicione `react-native-maps` aos `plugins` do `app.config.ts`: sem a opção dele, o plugin apaga do manifesto a chave que o Expo gravou.

**Push no Android (FCM):** o token push do Expo no Android depende do Firebase.
1. No console do Firebase, crie (ou use) o projeto e adicione um app Android com o pacote `br.com.spacesports.app`; baixe o `google-services.json` e suba-o como a variável de arquivo `GOOGLE_SERVICES_JSON` (comando acima). Não commite o arquivo.
2. Em Configurações do projeto → Contas de serviço, gere uma chave privada (JSON) e envie-a ao EAS como credencial **FCM V1**: `npx eas-cli@latest credentials` → Android → perfil → Google Service Account → "Manage your Google Service Account Key for Push Notifications (FCM V1)" → enviar o JSON. É com ela que o serviço de push do Expo fala com o FCM; sem ela os envios para Android falham.

No iOS o push usa a chave APNs, que o eas-cli cria junto com as credenciais do build.

### Perfis (`eas.json`)

| Perfil | Distribuição | Android | API | Ambiente de variáveis do EAS |
|---|---|---|---|---|
| `preview` | interna (link de instalação) | APK | `https://api-staging.spacesports.com.br` | `preview` |
| `production` | lojas, `autoIncrement` | AAB | `https://api.spacesports.com.br` | `production` |

- `EXPO_PUBLIC_API_URL` é a origem da API, sem `/v1` (o cliente já traz o prefixo).
- Não há perfil `development`: o `expo-dev-client` não está instalado.
- Os perfis têm `channel`, mas o `expo-updates` ainda não está instalado: o eas-cli só avisa (no modo interativo pergunta se quer instalar; responda **não** até decidirmos usar o EAS Update).
- Os dois perfis fixam Node (`22.23.4`, o mesmo do `.nvmrc`) e pnpm (`12.15.0`, o do `packageManager`). Os valores ficam repetidos em cada perfil de propósito: o eas-cli não tem perfil abstrato, e um perfil `base` para o `extends` poderia ser usado sozinho em `eas build --profile base`. Ao trocar a versão, mude nos dois e no `.nvmrc`.
- O EAS lê o `app.config.ts` logo depois do `pnpm install`, antes de compilar o workspace; por isso as cores vêm do fonte TS de `packages/ui-tokens` (`src/colors.ts`), cujos tipos o Node remove sozinho a partir da 22.18 (`engines.node` `>=22.18`). O hook `eas-build-post-install` compila os pacotes do workspace (`dist/`) antes do bundle.
- O Gradle gera o bundle chamando o CLI do Expo direto, sem o `NODE_PATH` que o pnpm põe nos atalhos de `node_modules/.bin`. Assim, todo plugin Babel que um preset pede por nome precisa estar no `package.json` do app, como o `@babel/plugin-transform-react-jsx` do NativeWind. O `src/babel-config.test.ts` confere isso.
- Para conferir o bundle de release sem o EAS, rode em `apps/mobile`:

  ```bash
  env -u NODE_PATH EXPO_PUBLIC_API_URL=https://api-staging.spacesports.com.br \
    node "$(node -p "require.resolve('@expo/cli', {paths: [require.resolve('expo/package.json')]})")" \
    export --platform android --output-dir /tmp/space-sports-export
  ```

  O `npx expo export` não serve para isso: ele roda com o `NODE_PATH` do pnpm e esconde a falha.
- Dois avisos do `expo doctor` no EAS são esperados:
  - **"Metro config":** o doctor carrega o `metro.config.js`, e o Tailwind pede o `dist/` do `@space-sports/ui-tokens`, que só existe depois do hook. O bundle roda depois do hook e não é afetado.
  - **"Dependências nativas duplicadas":** a API usa o `@better-auth/expo` no servidor, e o pnpm liga a ele os peers opcionais (`expo-constants` e outros) com o React 19.3.1 do web. Isso cria uma segunda árvore do `expo` só para a API. O app usa uma árvore só, a do React 19.3.0, tanto no autolinking quanto no bundle.

### Gerar um build interno e instalar no aparelho

1. Primeira vez: `npx eas-cli@latest init` (cria o projeto; anote o id em `EAS_PROJECT_ID`) e, com as variáveis acima exportadas, rode o build **no terminal** para o eas-cli criar as credenciais (keystore no Android; certificado e provisioning profile no iOS).
2. Android: `pnpm build:preview:android`. No fim o eas-cli mostra um link/QR code; abra no aparelho e instale o APK (permita "instalar apps desconhecidos").
3. iOS: o build interno é ad hoc e só instala em aparelhos cadastrados. Cadastre cada iPhone com `npx eas-cli@latest device:create` (gera um link para abrir no aparelho) **antes** do build e rode `pnpm build:preview:ios`. Requer conta paga no Apple Developer Program.
4. Produção (lojas): `pnpm build:production` (Android AAB + iOS). O envio às lojas (`eas submit`) ainda não está configurado.

Pelo GitHub: Actions → **EAS build** → Run workflow, escolhendo plataforma (`android`, `ios`, `all`) e perfil (`preview`, `production`). O job roda `eas build --non-interactive --no-wait` e termina ao enviar; acompanhe e baixe o build em expo.dev. Sem o secret `EXPO_TOKEN` (ou a variável `EAS_PROJECT_ID`) o job falha logo no primeiro passo, dizendo o que falta. No modo não interativo o EAS não cria credenciais: gere-as antes pelo terminal (passo 1).


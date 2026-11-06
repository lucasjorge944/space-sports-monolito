# Mobile — Preparação para o beta — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). O formato e os planos estão em `docs/tarefas/README.md`. O checklist fica em `docs/06-roadmap.md`, Fase 0 (Contas e serviços, CI) e Fase 1 (Qualidade e lançamento). **Torneios ficam fora:** não implementar nada da Fase 3.

**Plano padrão:** `forte`

**Ordem:** M.1 → (contas Expo/Google, chave do Maps e primeiro build interno, feitos pela sessão principal com o usuário) → M.2 (Maestro e conferência visual no aparelho) → beta fechado.

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz antes de começar. Documentação em português (BR), código em inglês.
- A máquina tem pouca RAM. Use no máximo 2 workers nos testes e deixe isso SEMPRE explícito na linha de comando (mobile: `npx jest --maxWorkers=2`). Use `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333 e 8081. Não deixe servidores rodando ao terminar.
- Sem cor fixa nas telas: tudo vem de `packages/ui-tokens`, nos temas claro e escuro.
- Nenhum segredo no repositório: chaves e tokens entram por variável de ambiente (EAS env ou `.env` local fora do git).
- Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português), com typecheck, `pnpm lint` na raiz e os testes do mobile passando. Relate o que ficou de fora.

### M.1 · App: link do espaço, configuração de build (EAS) e chave do Maps
- **Agente:** `mobile-engineer`
- **Branch:** `feat/mobile-eas-setup`

**Prompt**
```
Em apps/mobile, prepare o app para o primeiro build interno do EAS e corrija o link "abrir no app" da página pública do espaço. Não implemente nada de torneios.

(1) Deep link do espaço: o web gera `spacesports://espacos/<slug>` (apps/web/src/lib/public-space.ts), mas no app a rota é `espaco/[slug]`, e nada trata `espacos`. Faça o app aceitar `spacesports://espacos/<slug>` e abrir a página do espaço. Use um redirect de rota do Expo Router (ex.: `src/app/espacos/[slug].tsx` com `<Redirect>` para `/espaco/[slug]`) ou `+native-intent`, o que for mais simples e robusto. Não mude o link do web, porque links já gerados precisam continuar funcionando. Deslogado, o fluxo deve se comportar como os outros deep links (ver convite/[token], que guarda o destino e volta depois do login). Confira se o mesmo vale para a rota de convite e escreva um teste do redirect. Confira também as outras rotas que o web ou a API usam em links do app (grep por `spacesports://` em apps/ e packages/), e relate qualquer rota sem tela correspondente.

(2) Configuração do app: troque `app.json` por `app.config.ts` (tipado com `ExpoConfig`), mantendo tudo o que existe hoje (ícones, splash, plugins, permissões, `blockedPermissions` do calendário). Acrescente:
  - `ios.bundleIdentifier` e `android.package` = `br.com.spacesports.app`;
  - `version` = `0.1.0` (o número de build fica com o EAS, `appVersionSource: remote`);
  - `runtimeVersion: { policy: 'appVersion' }`;
  - `android.config.googleMaps.apiKey` lido de `process.env.GOOGLE_MAPS_ANDROID_API_KEY` (sem a chave, o build não quebra: o mapa só não carrega no Android). No iOS, mantenha o Apple Maps (provedor padrão do react-native-maps); confira em src/ que nenhum `MapView` força `PROVIDER_GOOGLE`;
  - `extra.eas.projectId` e `owner` lidos de `process.env.EAS_PROJECT_ID` e `process.env.EXPO_OWNER`, ausentes quando vazios;
  - as configurações de notificação do `expo-notifications` que o build exige (ícone e cor de notificação no Android, a partir dos assets e de `packages/ui-tokens`; sem cor hex fixa no código: importe o token).
  Confira com `npx expo config --type public` que a configuração resolve sem erro, com e sem as variáveis.

(3) EAS: crie `apps/mobile/eas.json` com `cli.appVersionSource: "remote"` e três perfis:
  - `development`: só se `expo-dev-client` já estiver instalado; se não estiver, não instale e não crie o perfil;
  - `preview`: `distribution: internal`, Android em APK, `channel: preview`, `env.EXPO_PUBLIC_API_URL = https://api-staging.spacesports.com.br` (confira em .env.example e docs/09-infra-aws.md como o app monta a URL, com ou sem `/v1`, e use o formato certo);
  - `production`: `autoIncrement: true`, Android em AAB, `channel: production`, `EXPO_PUBLIC_API_URL = https://api.spacesports.com.br`.
  Não instale `expo-updates` nesta tarefa: se o `channel` exigir, deixe-o de fora e relate. Acrescente ao package.json do mobile os scripts `build:preview:android`, `build:preview:ios` e `build:production` com `npx eas-cli@latest build ...`, sem adicionar eas-cli às dependências.

(4) CI: crie `.github/workflows/eas-build.yml`, só com `workflow_dispatch` (entradas: plataforma `android|ios|all` e perfil `preview|production`). O job usa `expo/expo-github-action` com o secret `EXPO_TOKEN`, instala com pnpm e roda `eas build --non-interactive --no-wait` em apps/mobile. Se o secret faltar, o job falha com uma mensagem clara. Não mexa em ci.yml nem em deploy-staging.yml.

(5) Documente em apps/mobile/README.md, numa seção "Build (EAS)": as variáveis (`EAS_PROJECT_ID`, `EXPO_OWNER`, `GOOGLE_MAPS_ANDROID_API_KEY` como variável do EAS com visibilidade "sensitive", `EXPO_TOKEN` no GitHub), os perfis, como gerar um build interno e instalar no aparelho, e que a chave do Maps no Google Cloud precisa ser restrita ao pacote `br.com.spacesports.app` com o SHA-1 da credencial de assinatura do EAS (`eas credentials`). Atualize `.env.example` com as variáveis novas, sem valores.

Rode typecheck, `pnpm lint` e `npx jest --maxWorkers=2` no mobile. Não rode `eas build` nem `eas init` (não há conta configurada nesta máquina).
```

## Prompt de revisão

```
Revise o branch da tarefa <número> de docs/tarefas/mobile-lancamento.md contra o main: correção, segurança (nenhum segredo commitado, variáveis certas por perfil), deep links (inclusive deslogado) e aderência ao briefing. Somente leitura: não altere arquivos. Liste os achados por gravidade, com arquivo e linha.
```

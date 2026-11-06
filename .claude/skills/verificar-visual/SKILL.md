---
name: verificar-visual
description: Sobe a tela alterada do web (Next.js com a API simulada) ou do app (Expo Go no emulador), tira capturas nos temas claro e escuro e compara com a prancha certa do kit de marca em docs/brand/kit/. Use ao concluir ou revisar qualquer mudança visual em apps/web ou apps/mobile, já que os testes não verificam estilo.
---

# Verificação visual contra o kit de marca

Os testes do projeto verificam comportamento, nunca CSS. O visual se confere rodando a tela e comparando com o kit. Faça isso antes de entregar qualquer tela nova ou alterada.

## 1. Qual prancha comparar
O kit fica em `docs/brand/kit/` (abra o `.html` no navegador ou leia o código dele):

| O que mudou | Prancha |
|---|---|
| Logo, ícone, favicon | `02-kit-de-logos.html` (só as versões aprovadas) |
| Cor, contraste, estado (sucesso, erro, aviso) | `04-paleta-de-cores.html` |
| Títulos, textos, hierarquia | `05-tipografia.html` |
| Botão, campo, chip, card, raio, espaçamento | `06-componentes.html` |
| Qualquer tela no tema escuro | `07-dark-mode.html` (tokens semânticos; no escuro o Sol é a ação principal) |

## 2. Web (`apps/web`)
Use a mesma API simulada do e2e: não precisa de banco nem de Redis.

```bash
cd apps/web
node e2e/mock-api.mjs &                                   # API simulada na porta 3334 (MOCK_API_PORT)
NEXT_DIST_DIR=.next-visual API_URL=http://localhost:3334 AUTH_PROVIDERS=google pnpm exec next dev --port 3100 &
```

Se a tela usa um endpoint que o mock não cobre, acrescente o handler no `e2e/mock-*.mjs` do domínio (é o mesmo mock dos testes, então ajuda os dois).

Capture com o Playwright, que já está instalado. Crie o script no diretório temporário da sessão, não no repositório. O login é o do `e2e/fixtures.ts`: reaproveite o helper de lá em vez de repetir.

```ts
// captura.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, colorScheme: theme });
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme); // next-themes
    await page.goto('http://localhost:3100/painel/<rota>');
    await page.screenshot({ path: `<tmp>/<rota>-${theme}-${viewport.width}.png`, fullPage: true });
  }
}
await browser.close();
```

Rode com `node captura.mjs` de dentro de `apps/web` (para achar o `@playwright/test`), leia as imagens e encerre os dois servidores ao terminar.

## 3. Mobile (`apps/mobile`)
Expo Go no emulador, apontando para o staging (não use `expo run:android`, que é lento):

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://api-staging.spacesports.com.br CI=1 npx expo start --go --android --port 8082
```

- `adb` fica em `~/Android/Sdk/platform-tools` (fora do PATH); emulador `Pixel_9` em `~/Android/Sdk/emulator`.
- Captura: `adb exec-out screencap -p > <tmp>/<tela>-light.png`.
- Tema escuro: `adb shell cmd uimode night yes` (volte com `night no`) e capture de novo.
- Conta de teste: variáveis `E2E_STAGING_*` do `apps/mobile/.env`. O `adb shell input text` corta textos longos: digite em partes.
- Se o staging estiver desligado ou a tela depender de endpoint que ainda não está lá, diga isso no relatório em vez de pular a verificação em silêncio.

## 4. O que conferir nas capturas
- **Cores só de token**: nada que não exista na paleta; no escuro, os tokens semânticos da prancha 07 (fundo, superfície, borda, texto, ação).
- **Tipografia**: Space Grotesk em títulos e display, Inter na interface; tamanhos da escala da prancha 05.
- **Componentes**: botões, campos, chips e cards com o raio e o espaçamento da prancha 06; estados de foco, desabilitado e erro.
- **Contraste** legível nos dois temas (texto sobre Sol e sobre Mar, principalmente).
- **Estados da tela**: carregando, vazio e erro também aparecem bem, não só o caminho feliz.
- **Mobile**: área segura (notch, barra de gestos), alvos de toque ≥ 44pt, teclado não cobrindo o campo ativo.
- **Web**: o layout em 390 px de largura não quebra; o painel continua denso e legível na largura de balcão.

## 5. No relatório
Liste as telas verificadas, os temas e larguras capturados e as divergências com o kit (prancha e elemento). O que não deu para verificar, e o motivo, também entra.

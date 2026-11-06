# @space-sports/ui-tokens

Tokens do design system do Space Sports (cores, tipografia, espaçamento, raios, sombras) e arquivos da marca (logo, ícones, favicon) para a web e o mobile. A fonte de verdade visual é o kit em [`docs/brand/kit/`](../../docs/brand/kit/README.md); a paleta e as decisões estão em [`docs/05-design-system.md`](../../docs/05-design-system.md#diretrizes-visuais).

## Fonte única

- `src/*.ts` é a fonte da verdade dos tokens.
- `generated/*.css` é gerado a partir dela com `pnpm generate` e fica versionado, para a web consumir sem build. Um teste falha se o CSS estiver desatualizado.
- `brand/*.svg`, `brand/png/*.png` e `src/brand-assets.ts` são gerados por `pnpm brand` a partir da prancha 02 do kit e ficam versionados. Um teste falha se os SVGs e o TS divergirem.
- Os nomes seguem a convenção shadcn/ui: `--primary-foreground` no CSS equivale a `primaryForeground` no TS (`cssVarName()` converte).

## Web (Next.js + Tailwind v4 + shadcn/ui)

```css
/* app/globals.css */
@import "tailwindcss";
@import "@space-sports/ui-tokens/generated/theme.css";
```

- `theme.css` define `:root` (claro), `.dark` (escuro), o `@custom-variant dark` e o mapeamento `@theme`: cores semânticas (`bg-primary`, `text-muted-foreground`, `text-link`, `bg-success-subtle`), primitivas da marca (`bg-mar-500`, `bg-sol-100`, `text-neutral-600`; o `neutral` substitui o do Tailwind), fontes (`font-sans`, `font-display`), estilos da marca (`text-h1`, `text-body`, `text-overline`), a escala utilitária (`text-sm`…`text-4xl`), raios (`rounded-sm`…`rounded-xl`) e sombras.
- Use sempre o caminho `generated/*.css` (é o que o `exports` publica, e também o que o postcss-import do Tailwind 3 encontra).
- O modo escuro é por classe `.dark` no `<html>` (next-themes com `attribute="class"`).
- **Anel de foco:** o anel é Sol nos dois temas; no claro ele só passa os 3:1 com a faixa `ring-offset` (Mar). Use `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ring-offset`, sem opacidade (`/50`).
- **Estilos de texto:** `text-h1` aplica tamanho, altura de linha, peso e espaçamento; a família vai à parte: `<h1 className="font-display text-h1">`, `<p className="text-overline uppercase">`.
- **Peças do kit sem `dark:` nem primitivas** (tokens da tarefa 2.34; especificação em [`docs/brand/auditoria-web.md`](../../docs/brand/auditoria-web.md)):

```tsx
// Botão "Escuro" da prancha 06 (no escuro inverte) e desabilitado ("Indisponível")
<button className="bg-inverse text-inverse-foreground hover:bg-inverse/90 disabled:bg-disabled disabled:text-disabled-foreground" />

// Botão de contorno: Noite sobre branco no claro, #A9BCC6 sobre transparente no escuro
<button className="border-[1.5px] border-outline-border bg-outline-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:border-disabled disabled:text-disabled-foreground" />

// Campo: fundo, borda 1.5 e foco (borda Mar e fundo Sol 50 no claro; no escuro raised e borda #8FBFD8)
<input className="border-[1.5px] border-input bg-input-background focus-visible:border-input-focus focus-visible:bg-input-focus-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ring-offset" />

// Campo desabilitado: fundo próprio, mais escuro que o campo ativo (o `disabled` fica para os botões)
<input className="disabled:border-disabled disabled:bg-input-disabled disabled:text-disabled-foreground disabled:placeholder:text-disabled-foreground" />

// Aba ativa sobre o trilho `bg-muted`: branco no claro; no escuro #1E4152 com borda #607B89
<button className="data-[state=active]:border-tab-active-border data-[state=active]:bg-tab-active data-[state=active]:text-foreground data-[state=active]:shadow-sm" />

// Chip de esporte e de filtro: neutro, com o Sol só no selecionado (doc 05, "Chips e badges")
<span className={selected
  ? 'border-[1.5px] border-chip-selected-border bg-chip-selected text-chip-selected-foreground'
  : 'border-[1.5px] border-chip-border bg-chip text-chip-foreground'} />

// Véu de diálogo/sheet, link, rótulo acima do título
<div className="fixed inset-0 bg-scrim" />
<a className="text-link hover:text-link-hover" />
<p className="text-overline uppercase text-eyebrow" />
```

- **Tokens com alfa** (`#RRGGBBAA`): só o `scrim` (véu) e o `outline-background` do escuro (`#00000000`). Use `bg-scrim` e `bg-outline-background` direto, sem `/opacidade`.
- **Explorar e anúncios (AD.1)** — especificação em [`docs/05-design-system.md`](../../docs/05-design-system.md#explorar-e-anúncios):
  - Selo "Patrocinado" `bg-sponsored text-sponsored-foreground`; sobre foto, texto `text-media-foreground`, botão `bg-media-action text-media-action-foreground` e o degradê em `media-overlay` com as opacidades de `mediaOverlayStops` (`mediaOverlayOpacityAt(offset)` interpola). Esses tokens têm o mesmo valor nos dois temas.
  - Medidas em `exploreLayout` (seções, banner, card patrocinado, recentes, selo).
  - Ícones dos esportes em `sportIcons`, na grade do Lucide: `sportIconSvg(sportIconKey(sport), { color })` devolve o SVG (no app, `<SvgXml>`).
  - Para forçar o tema claro num trecho da página (pré-visualização do `/super`), use `<div className="light">`: o `theme.css` declara o claro em `:root` e em `.light`. Sem `dark:` dentro desse trecho.
- **Pagamento online (PG.1)** — especificação em [`docs/05-design-system.md`](../../docs/05-design-system.md#pagamento-online):
  - Selo "Ambiente de teste" `border border-sandbox-border bg-sandbox text-sandbox-foreground` (laranja de alerta do kit; a borda Noite separa o selo do fundo claro).
  - Valor de entrada (venda, taxa devolvida) `text-amount-positive`; saída em `text-foreground` com o sinal de menos.
  - QR do Pix sempre em `bg-qr-plate` com módulos `qr-module` (iguais nos dois temas: QR invertido falha nos leitores de banco).
  - Medidas e ritmos em `paymentLayout` (opção de pagamento, QR, selo, "Copiado", consulta do status, contagem urgente, barra do "a liberar").
- **Avaliações (AV.1)** — especificação em [`docs/05-design-system.md`](../../docs/05-design-system.md#avaliações):
  - Estrela com o `Star`/`StarHalf` do Lucide: cheia `fill-rating stroke-rating-border`, vazia `fill-none stroke-rating-empty`; meia = vazia + `StarHalf` cheia por cima. No claro o contorno Sol 700 é o que dá os 3:1 (o Sol sozinho tem 1.6:1).
  - `starFills(média)` devolve `full`/`half`/`empty` para as 5 estrelas (meia estrela mais próxima); medidas em `reviewLayout` (tamanhos da estrela por uso, resumo, distribuição, item, cortes e página).
- **Botão de contorno no escuro:** o fundo é transparente de propósito, porque o botão aparece sobre `background`, `card`, `popover` e `muted`. Em uma conta de contraste, componha antes com `compositeOver()`: `contrastRatio()` rejeita cor com alfa.

### Fontes na web

Carregue as duas famílias com `next/font/google` e aponte as variáveis dos tokens para elas, depois dos imports:

```tsx
// app/layout.tsx
import { Inter, Space_Grotesk } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
});

<html className={`${inter.variable} ${spaceGrotesk.variable}`}>
```

```css
/* app/globals.css, depois dos @import */
@theme inline {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
}
```

### Logo na web

Renderize o SVG inline (o nome já está em contorno, não depende da fonte):

```tsx
import { brandLogos, brandSvg, logoMinWidth } from '@space-sports/ui-tokens';

const logo = brandLogos.horizontal.positive!; // .negative no escuro, ['on-sol'] no amarelo
<span
  role="img"
  aria-label="Space Sports"
  style={{ display: 'inline-block', width: 200, minWidth: logoMinWidth.horizontal }}
  // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG estático do pacote de tokens
  dangerouslySetInnerHTML={{ __html: brandSvg(logo, 'sidebar') }}
/>
```

- Cada asset tem `svg`, `width`, `height` (o `viewBox` é `0 0 width height`) e `clearSpace`. Ajuste o `<svg>` interno com `[&>svg]:h-auto [&>svg]:w-full`.
- `brandSvg(asset, sufixo)` deixa único o id do clipPath da bola; use quando a mesma versão aparece mais de uma vez na página (ex.: cabeçalho e rodapé) e uma pode ficar oculta.
- Metadados: copie `brand/favicon.svg` (ícone vetorial), `brand/png/favicon-48.png`/`favicon-32.png`, `brand/png/apple-touch-icon.png` e `brand/png/og-image.png` (Open Graph 1200×630) para `src/app` ou `public`. `themeColor`: Mar `#03547D`.

## Mobile (Expo + NativeWind + React Native Reusables)

Opção A, CSS com canais HSL (formato do RN Reusables) e o preset do Tailwind 3:

```css
/* global.css — o @import tem de vir ANTES das diretivas @tailwind */
@import "@space-sports/ui-tokens/generated/nativewind.css";
@tailwind base;
@tailwind components;
@tailwind utilities;
```

```js
// tailwind.config.js
module.exports = {
  presets: [require('nativewind/preset'), require('@space-sports/ui-tokens').tailwindPreset],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
};
```

O `tailwindPreset` traz `darkMode: 'class'`, as cores semânticas (`tailwindColors`: `{ primary: 'hsl(var(--primary))', 'primary-foreground': ..., 'chart-1': ..., 'success-subtle': ... }`), as primitivas (`mar`, `sol`, `neutral`, em hex, sem troca de tema), os raios, as famílias (`font-sans`, `font-display`) e os estilos da marca como `fontSize` (`text-h1`, `text-overline`, com o espaçamento em px). Se preferir montar o config à mão, use `tailwindColors`, `palette` e `tailwindTextStyles`.

Só o `--scrim` (véu de diálogos) e o `--outline-background` do escuro têm alfa: saem como `201 76.9% 10.2% / 0.6` e `0 0% 0% / 0`, e `hsl(var(--scrim))` continua válido, porque o NativeWind separa os canais e monta `hsla(...)` (o React Native não aceita `hsl(... / alfa)` direto). Em `themes`, são `#06202E99` e `#00000000` (`#RRGGBBAA`, aceito pelo React Native).

Opção B, valores em TS (tema de navegação, `vars()` do NativeWind, estilos fora do Tailwind):

```ts
import { fontSize, layout, nativewindVars, radius, textStyles, themes } from '@space-sports/ui-tokens';

themes.dark.background; // '#071A24'
nativewindVars(themes.light, 'hex'); // { '--background': '#F7F9FA', ... }
layout.controlHeight; // 48: altura de botões e campos no app
```

### Fontes no mobile

No React Native cada peso é uma família. Carregue com `expo-font` e `@expo-google-fonts/space-grotesk` (400–700) junto da Inter:

```tsx
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk/400Regular';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';

useFonts({
  Inter: Inter_400Regular, InterMedium: Inter_500Medium, InterSemiBold: Inter_600SemiBold,
  'Space Grotesk': SpaceGrotesk_400Regular, SpaceGroteskMedium: SpaceGrotesk_500Medium,
  SpaceGroteskSemiBold: SpaceGrotesk_600SemiBold, SpaceGroteskBold: SpaceGrotesk_700Bold,
});
```

Com os nomes acima, `font-display` (`'Space Grotesk'`) já resolve o peso 400; para os demais, mapeie utilitários como o app faz com a Inter (ex.: `.font-display-bold { fontFamily: 'SpaceGroteskBold' }`). O peso dos estilos da marca está em `textStyles[nome].weight`.

### Logo e ícones no mobile

```tsx
import { SvgXml } from 'react-native-svg';
import { brandLogos } from '@space-sports/ui-tokens';

const logo = brandLogos.vertical.positive!; // .negative no tema escuro
<SvgXml
  xml={logo.svg}
  width={160}
  height={(160 * logo.height) / logo.width}
  accessibilityLabel="Space Sports"
/>
```

PNGs em `brand/png/` (copie para `apps/mobile/assets/images`):

| Arquivo | Uso no `apps/mobile/app.config.ts` (cores importadas de `src/colors.ts`) |
|---|---|
| `icon.png` (1024, fundo Mar, sem cantos) | `icon` (iOS aplica a máscara) |
| `android-icon-foreground.png` (1024, transparente; a tinta cabe no círculo seguro de 66 dp) | `android.adaptiveIcon.foregroundImage` |
| `android-icon-background.png` (1024, Mar) | `android.adaptiveIcon.backgroundImage` (e `backgroundColor: brandColors.mar`) |
| `android-icon-monochrome.png` (1024, branco com alfa; bola vazada) | `android.adaptiveIcon.monochromeImage` (ícones temáticos) e ícone da notificação (`expo-notifications`: `icon`, `color: brandColors.mar`) |
| `splash-icon.png` (1024, transparente, símbolo com a área de proteção) | `expo-splash-screen`: `image`, fundo `brandColors.mar` (escuro: `brandColors.noite`) |
| `favicon-48.png`, `favicon-32.png` | `web.favicon` |
| `apple-touch-icon.png` (180), `og-image.png` (1200×630) | Web |

## Exports TS

| Export | Conteúdo |
|---|---|
| `themes.light` / `themes.dark` | Cores semânticas (hex) |
| `brandColors`, `palette`, `functionalColors`, `surfaces` | Cores da marca, escalas 50–900, funcionais do kit e superfícies da prancha 07 |
| `colorTokens`, `cssVarName()` | Lista dos tokens e nome da variável CSS |
| `fontFamily`, `fontWeight`, `fontSize`, `textStyles` | Tipografia (px): famílias, pesos, escala utilitária e estilos da marca |
| `spacing`, `spacingUnit`, `layout` | Espaçamento (px) e medidas semânticas (alvo de toque 44, controles 48) |
| `radius`, `radiusBase`, `shadow` | Raios (px) e sombras (`box-shadow`, aceito também no RN) |
| `brandLogos`, `brandAssets`, `brandSvg()`, `logoMinWidth`, `logoClearSpace()` | Arquivos da marca por layout e tom, mínimos e área de proteção |
| `tailwindPreset`, `tailwindColors`, `tailwindTextStyles` | Preset do Tailwind 3 (mobile) |
| `reviewLayout`, `starFills()` | Avaliações: medidas e desenho da nota em estrelas |
| `contrastRatio()`, `compositeOver()`, `splitAlpha()`, `toHslChannels()`, `nativewindVars()` | Utilitários (`compositeOver` aplica uma cor com alfa, como o `scrim` ou o `outlineBackground`, sobre um fundo) |

## Scripts

- `pnpm generate` — compila e regenera `generated/*.css`. Rode sempre que mudar `src/`.
- `pnpm brand` — regenera `brand/`, `brand/png/` e `src/brand-assets.ts` a partir de `docs/brand/kit/02-kit-de-logos.html`. Os paths do símbolo são copiados do kit sem alteração; o nome vira contorno com a Space Grotesk de `@expo-google-fonts/space-grotesk` (OFL, dependência de desenvolvimento, não versionada aqui), reproduzindo as regras CSS da prancha (tamanhos, entrelinha, espaçamento e `skewX(-9deg)`). Renderização com `@resvg/resvg-js`. A saída é determinística.
- `pnpm test` — contraste WCAG AA de todos os pares texto/fundo (≥ 4.5:1), não-texto (≥ 3:1) e foco visível nos temas claro, escuro e no HSL do mobile; véu e desabilitado (botão e campo); botão de contorno sobre cada superfície; aba ativa contra o trilho; valores das peças do kit; sincronia do CSS e dos arquivos da marca; tamanhos dos PNGs.

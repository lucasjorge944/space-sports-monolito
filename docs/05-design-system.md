# 05 · Design e Bibliotecas de UI

## Estratégia

Usar o **mesmo paradigma (Tailwind + componentes estilo shadcn)** no app e na web, com **tokens de design compartilhados** em `packages/ui-tokens`. Assim o designer define cores/tipografia uma vez e os dois lados ficam consistentes.

## Web (painel)

| Lib | Uso |
|---|---|
| **shadcn/ui** (Radix + Tailwind) | Base de componentes: botões, formulários, dialogs, tabs, data table, date picker, sidebar, command palette. Código copiado para o projeto → total controle |
| **Tailwind CSS v4** | Estilo |
| **lucide-react** | Ícones |
| **TanStack Table** | Tabelas (alunos, reservas, financeiro) |
| **FullCalendar** (resource timeline) / **Schedule-X** | Agenda por quadra |
| **brackets-viewer.js** | Visualização de chaves de torneio |
| **Recharts** (shadcn charts) | Dashboards |
| **sonner** | Toasts |
| Blocos prontos | **shadcn blocks** (dashboards, sidebars, login) para acelerar o layout |

## Mobile (app)

| Lib | Uso |
|---|---|
| **NativeWind v4** | Tailwind no React Native (mesmos tokens da web) |
| **React Native Reusables** | Port do shadcn/ui para RN (botões, inputs, cards, dialogs, tabs) |
| **@gorhom/bottom-sheet** | Filtros, detalhes de horário, checkout |
| **react-native-reanimated** + **moti** | Animações da vitrine |
| **@shopify/flash-list** | Feed performático |
| **expo-image** | Imagens com cache e blurhash (também a foto do perfil) |
| **expo-image-picker** + **expo-image-manipulator** | Foto do perfil: câmera ou galeria com recorte quadrado, normalizada a 512 px em JPEG |
| **lucide-react-native** | Ícones (mesmo set da web) |
| **react-native-calendars** | Seleção de data |

**Alternativas** se preferir um kit mais "completo de fábrica": **Tamagui** (alto desempenho, web+native) ou **gluestack-ui v2** (também baseado em NativeWind). Recomendo NativeWind + RN Reusables pela paridade com o shadcn da web.

## Figma
- **shadcn/ui Figma kit** (comunidade) como base para web e mobile.
- Referências de UX: Instagram (feed com foto grande), Wellhub/Gympass (cards de academia, filtros, check-in), Playtomic (reserva de quadra e divisão de conta), Airbnb (página de detalhe com galeria).

## Diretrizes visuais

Marca do kit de 2026-10-29 (v1.1, `docs/brand/kit/`), fonte de verdade visual do web e do app nos dois temas: **Mar** `#03547D` (cor da marca: ações, logo, links), **Sol** `#FBBD10` (destaque, energia), **Noite** `#06202E` (texto, fundos profundos) e **Rede** `#FFFFFF` (superfícies). Tipografia Space Grotesk + Inter. Os tokens vivem em `packages/ui-tokens` (`@space-sports/ui-tokens`), junto com os arquivos da logo; o uso na web e no mobile está no README do pacote. Fontes por tema: prancha 04 (paleta), 05 (tipografia), 06 (componentes, tema claro) e 07 (tema escuro).

### Decisões
- **Nomes de variáveis da convenção shadcn/ui** (`--background`, `--primary`, `--sidebar-*` etc.), em `:root` (claro) e `.dark` (escuro). Web e mobile usam os mesmos nomes. No TS ficam em camelCase (`primaryForeground`). A troca para a marca nova mudou só valores; os tokens novos são acréscimos.
- **Fonte única em TS.** O CSS é gerado a partir dele (`pnpm generate`) e fica versionado; um teste falha se ficar desatualizado. Saídas: `theme.css` (web, Tailwind v4 com `@theme`) e `nativewind.css` (mobile, canais HSL no formato do RN Reusables).
- **Cores em hex**, e não em `oklch` (o padrão atual do shadcn), porque o React Native não entende `oklch`.
- **Os dois temas seguem a tabela da prancha 07** (bg/base, bg/surface, bg/raised, border, text, action, link, focus, status). Mapeamento: bg/base → `background`; bg/surface → `card`, `popover`, `sidebar`; bg/raised → `muted`, `accent` (hover e seleção) e fundo de campo; text/primary → `foreground`; text/secondary → `muted-foreground`; action/primary → `primary`; action/secondary → `secondary`; text/link → `link`; focus/ring → `ring`.
- **No escuro o Sol é a ação principal** (`primary` Sol com texto Noite) e o Mar 400 a secundária (`secondary` `#2A7CA4` com texto branco): o Mar tem 2.2:1 sobre Noite e reprova. Links clareiam para Mar 200 (`#8FBFD8`). No escuro, elevação por superfície (`background` → `card` → `muted`), quase sem sombra.
- **`secondary` é o botão "Destaque"**: Sol com texto Noite no claro (e não o cinza claro do shadcn padrão). Para superfícies neutras use `muted`; para hover e seleção, `accent`. **Nunca use o Sol como texto ou ícone sobre fundo claro** (1.6:1; o kit marca "branco/Sol" como reprovado).
- **Onde o kit não atinge o mínimo dos testes, a cor do kit fica e se acrescenta o mínimo:**
  - *Anel de foco Sol no claro* (1.6:1 contra o fundo): novo token `ring-offset`, Mar no claro (7.7:1) e igual ao fundo no escuro. Use o anel com offset: na web `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ring-offset` (sem `/50`), no app borda/contorno `ring-offset` com o anel `ring` por fora. O anel continua Sol nos dois temas; a faixa Mar garante os 3:1.
  - *Borda de campo (`input`)*: o `#BCC6CB` da prancha 06 (2.0:1) e o `#1E4152` da 07 (1.6:1) não chegam a 3:1 (WCAG 1.4.11). Ficam o mínimo para passar na mesma direção: `#7F8C93` no claro e `#607B89` no escuro (3:1 também sobre bg/raised). Bordas decorativas (`border`) seguem as do kit.
  - *Erro no claro*: o `#D9483B` do kit tem 4.3:1 com branco e 4.0:1 com Noite. `destructive` é ele escurecido o mínimo (`#C84236`): 4.9:1 com branco e 4.6:1 como texto de erro no fundo.
  - *Sucesso e alerta no claro*: `#1F9D6B` e `#E07B12` ficam como no kit, com **texto Noite** (com branco dariam 3.5 e 3.0:1). Como texto sobre o fundo eles não passam; **para texto colorido de status use os `-subtle-foreground`** (ex.: `text-success-subtle-foreground`), ou `link` para links.
- **Status tingidos** (badges de reserva, pagamento e mensalidade): tokens `success-subtle`, `warning-subtle`, `destructive-subtle` e `info-subtle`, cada um com `-foreground` e `-border`. Claro: Confirmado e Cancelado da prancha 06. Escuro: Confirmado da 07; Cancelado derivado na mesma lógica (fundo erro escurecido, texto `#F2685B`). O Pendente diverge do kit nos dois temas e a borda é acréscimo: receita e justificativa em [Chips e badges](#chips-e-badges).
- **Tokens extras além do shadcn:** `--destructive-foreground` (o RN Reusables usa), `--success`, `--warning`, `--info` e os `-subtle` com seus `-foreground`, `--link` e `--ring-offset`.
- **Tokens das peças do kit** (tarefa 2.34, a partir da [auditoria do web](brand/auditoria-web.md)): `inverse` (botão "Escuro"), `disabled` (botão "Indisponível"), `link-hover`, `eyebrow` (rótulo acima do título), `input-background`, `input-focus` e `input-focus-background` (campo e foco da prancha 06), `chip`, `chip-border` e `chip-selected` (chips de esporte, com a receita revista na A.2) e `scrim` (véu de diálogos e sheets). Assim nenhum componente precisa de primitiva nem de `dark:` para cor. Onde o kit não desenha o estado no escuro, o valor é derivado e marcado como tal na tabela.
- **Tokens da revisão da 2.35** (tarefa 2.37), para o web e o app não precisarem de `dark:` nessas peças:
  - *Botão de contorno* (`outline-border`, `outline-background`): valores das pranchas, Noite sobre branco no claro e `#A9BCC6` sobre transparente no escuro. O fundo do escuro **é transparente de verdade**: o botão aparece sobre `background`, `card`, `popover` e `muted`, e um fundo opaco viraria uma mancha em todas menos uma (a cor do card fica 1.13:1 sobre o fundo e 1.15:1 sobre o `muted`). No claro o fundo é opaco, como na prancha 06. O teste compõe o fundo sobre cada superfície antes de medir.
  - *Campo desabilitado* (`input-disabled`, **derivado**: o kit não desenha o estado): no escuro desce à bg/base (`#071A24`), mais escuro que o campo ativo (1.3:1) e que o card (1.13:1), e por isso nunca parece elevado; o texto `disabled-foreground` fica com 5.6:1. No claro é o mesmo `#DCE3E6` de antes (3.7:1), já mais escuro que o campo ativo. O token `disabled` não muda e segue nos botões, no checkbox e no switch.
  - *Aba ativa* (`tab-active`, `tab-active-border`, **derivado**): no escuro, preenchimento `#1E4152` (um degrau acima do trilho, 1.26:1, seguindo a regra da prancha 07 de indicar elevação com superfície mais clara) e borda `#607B89`, a mesma do campo, com 3.05:1 sobre o trilho. A borda é o que garante a separação: com o texto `foreground`, nenhum preenchimento chega a 3:1 com o trilho e 4.5:1 com o texto ao mesmo tempo. O Sol (`primary`) foi descartado porque deixaria a aba amarela no escuro e branca no claro, e o `secondary` porque reprova com `foreground` (4.3:1). O claro não muda: branco sobre `neutral-100`, com a borda igual ao preenchimento (sem linha aparente) e a separação vinda da `shadow-sm`, como antes.
- **Tokens da A.2** (ajustes pós-piloto): `success-subtle-border`, `warning-subtle-border`, `destructive-subtle-border`, `info-subtle-border`, `chip-hover`, `chip-selected-border`, `input-error`, `input-error-background` e `input-error-foreground`. Uso em [Chips e badges](#chips-e-badges) e [Anatomia de campo](#anatomia-de-campo).
- **Tokens da AD.1** (Explorar e anúncios): `sponsored` e `sponsored-foreground` (selo "Patrocinado"), `media-overlay` (degradê de leitura sobre foto), `media-foreground` (texto sobre o degradê), `media-action` e `media-action-foreground` (botão sobre foto). Ficam sempre sobre uma imagem, que não muda com o tema, e por isso têm **o mesmo valor nos dois temas**. A opacidade do degradê não está no token: vem de `mediaOverlayStops` (`layout.ts`). Uso em [Explorar e anúncios](#explorar-e-anúncios).
- **Tokens da PG.1** (pagamento online): `sandbox`, `sandbox-foreground` e `sandbox-border` (selo "Ambiente de teste"), `amount-positive` (valor de entrada) e `qr-plate`/`qr-module` (QR do Pix, iguais nos dois temas). Uso em [Pagamento online](#pagamento-online).
- **Tokens da AV.1** (avaliações): `rating` (preenchimento da estrela, Sol nos dois temas), `rating-border` (contorno da cheia: Sol 700 no claro, que dá os 3:1 que o Sol sozinho não dá; Sol no escuro) e `rating-empty` (contorno da vazia, a cor da borda de campo). Uso em [Avaliações](#avaliações).
- **Só dois tokens têm alfa** (`#RRGGBBAA`), e o teste de contraste os nomeia: `scrim`, Noite a 60% no claro e preto a 80% no escuro (o fundo escuro já é quase Noite; o véu precisa ser mais denso para separar o diálogo, que também sobe de superfície), e `outline-background` no escuro, `#00000000`. No mobile saem em canais HSL com `/ alfa`, e o NativeWind os converte em `hsla(...)` ao resolver `hsl(var(--token))`.
- **Primitivas** das escalas da prancha 04: `mar-50…900`, `sol-50…900` e `neutral-50…900` (na web substituem o `neutral` do Tailwind). Servem para o que nenhum token cobre; no resto, use os tokens semânticos, que trocam com o tema.
- **Painel Super sem paleta própria:** usa os mesmos tokens do painel do espaço, nos dois temas. Só as cores do kit aparecem na interface; o painel se diferencia pela navegação, pelo bloco "Plataforma · Super" e pelo rótulo "Painel da plataforma".
- **Contraste testado** (Vitest, `packages/ui-tokens/src/contrast.test.ts`): pares texto/fundo ≥ 4.5:1 (inclusive os `-subtle`, com `foreground` e `muted-foreground` por cima como na agenda, links e hover de link, texto de erro, mensagem de erro de campo sobre fundo, card, popover, muted e sidebar, eyebrow, chips e chip pressionado, botão escuro, aba ativa e texto e placeholder sobre o campo, normal, em foco e com erro), elementos não textuais (borda de campo, de foco e de erro, borda do chip selecionado, séries de gráfico) ≥ 3:1, borda de cada badge de status mais forte que o fundo dele, chip neutro sem nenhum tom do Sol, desabilitado ≥ 3:1 (no botão e no campo, que também precisa ser mais escuro que o campo ativo), botão de contorno composto sobre fundo, card, popover, muted e sidebar, aba ativa mais clara que o trilho (no escuro, borda ≥ 3:1), o véu (`scrim`) composto sobre o fundo, as peças sobre foto da AD.1 (selo, título ≥ 3:1 e texto ≥ 4.5:1 sobre o degradê composto numa foto branca, botão Sol ≥ 3:1 sobre o degradê em foto branca e preta) os contornos da estrela cheia e da vazia (≥ 3:1 sobre fundo, card, popover e muted) e foco visível (anel ou offset ≥ 3:1 sobre fundo, card, muted e sidebar), nos temas claro e escuro, e também nos valores HSL arredondados que o mobile recebe.

### Paleta

Contraste entre parênteses (claro / escuro).

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `background` / `foreground` | `#F7F9FA` / `#06202E` | `#071A24` / `#F2F6F8` | Fundo de tela e texto principal (15.9 / 16.3:1) |
| `card`, `popover` / `-foreground` | `#FFFFFF` / `#06202E` | `#0C2633` / `#F2F6F8` | Cards, menus, dialogs, sheets (16.7 / 14.4:1) |
| `primary` / `-foreground` | `#03547D` / `#FFFFFF` | `#FBBD10` / `#06202E` | Ação principal: Mar no claro, Sol no escuro (8.2 / 9.9:1) |
| `secondary` / `-foreground` | `#FBBD10` / `#06202E` | `#2A7CA4` / `#FFFFFF` | Botão destaque: Sol no claro, Mar 400 no escuro (9.9 / 4.6:1) |
| `muted` / `-foreground` | `#EEF2F4` / `#4A5A63` | `#12313F` / `#A9BCC6` | bg/raised e text/secondary (6.4 / 7.0:1; no fundo 6.8 / 9.0:1) |
| `accent` / `-foreground` | `#EEF2F4` / `#06202E` | `#12313F` / `#F2F6F8` | Hover, item selecionado (14.9 / 12.6:1) |
| `link` | `#03547D` | `#8FBFD8` | Links (7.7 / 9.0:1 no fundo) |
| `destructive` / `-foreground` | `#C84236` / `#FFFFFF` | `#F2685B` / `#06202E` | Erro, cancelar, excluir (4.9 / 5.5:1) |
| `success` / `-foreground` | `#1F9D6B` / `#06202E` | `#3CC48A` / `#06202E` | Sucesso sólido (4.9 / 7.5:1) |
| `warning` / `-foreground` | `#E07B12` / `#06202E` | `#F29A3A` / `#06202E` | Alerta sólido (5.6 / 7.5:1) |
| `info` / `-foreground` | `#2A7CA4` / `#FFFFFF` | `#579DC0` / `#06202E` | Informação (4.6 / 5.6:1). O kit não traz info no escuro: Mar 300 |
| `success-subtle` / `-foreground` | `#E3F4EC` / `#146B49` | `#12392C` / `#3CC48A` | Confirmado, Pago (5.7 / 5.7:1) |
| `warning-subtle` / `-foreground` | `#FFE69C` / `#663C00` | `#4A3604` / `#FCCD45` | Pendente (7.7 / 7.7:1). Diverge do kit: ver [Chips e badges](#chips-e-badges) |
| `destructive-subtle` / `-foreground` | `#FBE5E3` / `#9E2A20` | `#3F1A1A` / `#F2685B` | Cancelado, Atrasado (6.2 / 5.0:1) |
| `info-subtle` / `-foreground` | `#E6F1F7` / `#033A54` | `#0F3448` / `#8FBFD8` | Aviso informativo (10.5 / 6.6:1) |
| `success-subtle-border` | `#A9DFC6` | `#1F6B4E` | Contorno do badge. Derivado, como as demais bordas de status |
| `warning-subtle-border` | `#FBBD10` | `#8F6407` | Sol 400 no claro, Sol 700 no escuro |
| `destructive-subtle-border` | `#F3B8B2` | `#7A2F2B` | Contorno do badge |
| `info-subtle-border` | `#A9CFE3` | `#2A6486` | Contorno do badge |
| `border` | `#DCE3E6` | `#1E4152` | Divisórias e bordas de card (decorativas) |
| `input` | `#7F8C93` | `#607B89` | Borda de campos (3.3 / 4.0:1) |
| `ring` / `ring-offset` | `#FBBD10` / `#03547D` | `#FBBD10` / `#071A24` | Anel de foco Sol; no claro a faixa Mar dá os 3:1 (7.7:1). No escuro o anel tem 10.5:1 |
| `chart-1..5` | `#03547D` `#BC8507` `#66757D` `#1F9D6B` `#D9483B` | `#FBBD10` `#579DC0` `#A9BCC6` `#3CC48A` `#F2685B` | Mar, Sol (Sol 600 no claro: o Sol puro tem 1.6:1), neutro, sucesso, coral. Todas ≥ 3:1 no fundo e no card |
| `sidebar` / `-foreground` | `#FFFFFF` / `#06202E` | `#0C2633` / `#F2F6F8` | Sidebar do painel (bg/surface) |
| `sidebar-primary` / `-foreground` | `#03547D` / `#FFFFFF` | `#FBBD10` / `#06202E` | Item ativo |
| `sidebar-accent` / `-foreground` | `#EEF2F4` / `#06202E` | `#12313F` / `#F2F6F8` | Hover na sidebar |
| `sidebar-border`, `sidebar-ring` | `#DCE3E6`, `#FBBD10` | `#1E4152`, `#FBBD10` | Com `ring-offset`, como o anel geral |
| `inverse` / `-foreground` | `#06202E` / `#FFFFFF` | `#F2F6F8` / `#06202E` | Botão "Escuro" (prancha 06), tooltip (16.7 / 15.4:1). No escuro inverte |
| `disabled` / `-foreground` | `#DCE3E6` / `#66757D` | `#1E4152` / `#7F949F` | Botão, checkbox e switch desabilitados (3.7 / 3.4:1; dispensado pela WCAG, testado ≥ 3:1). O `-foreground` também é o texto do campo desabilitado. Escuro derivado |
| `link-hover` | `#033A54` | `#C2DCEA` | `a:hover` da prancha 07 no claro; escuro derivado (Mar 100) (11.5 / 12.5:1 no fundo) |
| `eyebrow` | `#03547D` | `#FCCD45` | Rótulo acima do título, com `text-overline uppercase` (7.7 / 11.8:1) |
| `input-background` | `#FFFFFF` | `#12313F` | Fundo de campo (06 branco; 07 bg/raised) |
| `input-focus` / `input-focus-background` | `#03547D` / `#FFF8E1` | `#8FBFD8` / `#12313F` | Campo em foco: borda Mar e fundo Sol 50 (06). Escuro derivado: borda no tom do link (o anel já é Sol), fundo raised |
| `input-disabled` | `#DCE3E6` | `#071A24` | Fundo de campo desabilitado, com texto `disabled-foreground` (3.7 / 5.6:1). Derivado nos dois temas: o kit não desenha o estado |
| `input-error` | `#C84236` | `#F2685B` | Borda de campo com erro (4.9 / 4.5:1 sobre o campo). Mesmo valor de `destructive` |
| `input-error-background` | `#FFF5F4` | `#12313F` | Fundo de campo com erro, com ou sem foco. Derivado; no escuro é bg/raised, como o foco |
| `input-error-foreground` | `#9E2A20` | `#F36C5F` | Mensagem de erro (7.5 / 5.3:1 no card; 6.6 / 4.6:1 no `muted`). No escuro, o `#F2685B` do kit clareado o mínimo: ele dá 4.49:1 no `muted` |
| `chip` / `-foreground` / `-border` | `#EEF2F4` / `#06202E` / `#DCE3E6` | `#12313F` / `#F2F6F8` / `#1E4152` | Chip de esporte e de filtro (14.9 / 12.6:1). O claro diverge do kit |
| `chip-hover` | `#DCE3E6` | `#1E4152` | Chip pressionado ou com o mouse em cima (12.9 / 10.0:1) |
| `chip-selected` / `-foreground` | `#FBBD10` / `#06202E` | `#FBBD10` / `#06202E` | Chip selecionado: Sol nos dois temas (9.9:1). O claro diverge do kit |
| `chip-selected-border` | `#06202E` | `#FBBD10` | Borda do selecionado. No claro é ela que dá o contraste com a superfície (16.7:1 no card); o Sol sozinho tem 1.6:1 |
| `scrim` | `#06202E99` | `#000000CC` | Véu de diálogo e sheet. No claro o diálogo branco fica com 4.6:1 sobre o fundo velado |
| `outline-border` | `#06202E` | `#A9BCC6` | Borda do botão de contorno (06, 07) (16.7 / 8.0:1 no card; no `muted` 14.9 / 7.0:1) |
| `outline-background` | `#FFFFFF` | `#00000000` | Fundo do botão de contorno: opaco no claro (06), transparente no escuro (07) |
| `tab-active` | `#FFFFFF` | `#1E4152` | Aba ativa sobre o trilho `muted`, com texto `foreground` (16.7 / 10.0:1). Escuro derivado |
| `tab-active-border` | `#FFFFFF` | `#607B89` | Borda da aba ativa: invisível no claro; no escuro 3.05:1 sobre o trilho. Escuro derivado |
| `sponsored` / `-foreground` | `#06202E` / `#FFFFFF` | igual | Selo "Patrocinado" sobre foto: a pílula do card de quadra da prancha 06 (16.7:1). Sem Sol: anúncio não chama mais atenção que a lista |
| `media-overlay` | `#06202E` | igual | Degradê de leitura sobre foto, com as opacidades de `mediaOverlayStops` (0 → 0.85) |
| `media-foreground` | `#FFFFFF` | igual | Título e texto sobre o degradê (título ≥ 3:1 e texto ≥ 4.5:1 mesmo em foto branca) |
| `media-action` / `-foreground` | `#FBBD10` / `#06202E` | igual | Botão sobre foto (Sol + Noite, 9.9:1). Contra o degradê: em foto branca, 3.8:1 em 320 dp (3.6:1 com fonte 1.3×) e 4.1:1 em 360 dp; em foto preta, ≥ 10:1 |
| `sandbox` / `-foreground` | `#E07B12` / `#06202E` | `#F29A3A` / `#06202E` | Selo "Ambiente de teste" (5.6 / 7.5:1). Ver [Pagamento online](#pagamento-online) |
| `sandbox-border` | `#06202E` | `#F29A3A` | Borda do selo (≥ 3:1 sobre fundo, card, popover e `muted`) |
| `amount-positive` | `#146B49` | `#3CC48A` | Valor de entrada em lançamentos (≥ 5.8 / 6.1:1) |
| `qr-plate` / `qr-module` | `#FFFFFF` / `#06202E` | igual | QR do Pix: placa branca e módulos Noite nos dois temas (16.7:1) |
| `rating` | `#FBBD10` | `#FBBD10` | Preenchimento da estrela cheia. Ver [Avaliações](#avaliações) |
| `rating-border` | `#8F6407` | `#FBBD10` | Contorno da estrela cheia (≥ 4.6 / 8.0:1 sobre fundo, card e `muted`) |
| `rating-empty` | `#7F8C93` | `#607B89` | Contorno da estrela vazia, sem preenchimento (≥ 3.0:1 sobre fundo, card e `muted`) |

Escalas (prancha 04), primitivas `mar-*`, `sol-*`, `neutral-*`:

| Passo | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|---|
| Mar | `#E6F1F7` | `#C2DCEA` | `#8FBFD8` | `#579DC0` | `#2A7CA4` | **`#03547D`** | `#034868` | `#033A54` | `#052D41` | `#06202E` |
| Sol | `#FFF8E1` | `#FEECB3` | `#FDDD7A` | `#FCCD45` | **`#FBBD10`** | `#E2A40A` | `#BC8507` | `#8F6407` | `#66470A` | `#42300B` |
| Neutra | `#F7F9FA` | `#EEF2F4` | `#DCE3E6` | `#BCC6CB` | `#94A1A8` | `#66757D` | `#4A5A63` | `#2A3B44` | `#15262F` | `#06202E` |

### Tipografia
- **Duas famílias** (Google Fonts, OFL): **Space Grotesk** (`font-display`, 400–700) em display, títulos h1–h3, números de destaque (preços, placares) e na logo; **Inter** (`font-sans`, 400–600) em toda a interface. Web: `next/font/google`; mobile: `@expo-google-fonts/space-grotesk` e `@expo-google-fonts/inter`. Use `tabular-nums` em preços, horários e placares.
- **Escala da marca** (prancha 05), tokens `text-display`, `text-h1`… (tamanho, altura de linha, peso e espaçamento; a família vem de `font-display`/`font-sans`):

| Token | Família · peso | Tamanho / altura | Espaçamento | Uso |
|---|---|---|---|---|
| `display` | Space Grotesk 700 | 64 / 72 | -0,02em | Hero das páginas públicas |
| `h1` | Space Grotesk 700 | 48 / 56 | -0,01em | Título de página pública |
| `h2` | Space Grotesk 600 | 36 / 44 | | Seção |
| `h3` | Space Grotesk 600 | 24 / 32 | | Título de card, de tela no app |
| `body-lg` | Inter 400 | 18 / 28 | | Texto de destaque |
| `body` | Inter 400 | 16 / 24 | | Corpo, formulários. Mínimo para leitura ao sol no app |
| `small` | Inter 500 | 14 / 20 | | Rótulos, botões compactos, metadados |
| `helper` | Inter 400 | 13 / 18 | | Dica e erro de campo na web (prancha 06). No app, dica e erro usam `sm` 14/20 |
| `overline` | Inter 600 | 12 / 16 | +0,12em, caixa alta | Rótulo de seção, categoria |

- **Escala utilitária** (`xs`…`4xl`) mantida para o texto denso do painel: `xs` 12/16 (legendas; nunca texto essencial no app), `sm` 14/20 (tabelas, agenda), `base` 16/24, `lg` 18/28, `xl` 20/28, `2xl` 24/32, `3xl` 30/36, `4xl` 36/40 (números de destaque, em `font-display`).

### Espaçamento, raios e sombras
- **Espaçamento:** unidade de 4px (`--spacing: 0.25rem`, igual ao Tailwind). Escala da prancha 06: 4, 8, 12, 16, 24, 32, 48, 64.
- **Medidas de layout:** alvo de toque mínimo de 44pt (web e app); botões e campos do app e das páginas públicas com 48 de altura (`layout.controlHeight`); o painel mantém a densidade atual. Margem lateral de 16 no app e 24 no painel; 12 entre cards; sidebar do painel com 256.
- **Raios** (prancha 06, "cantos arredondados lembram a bola"): base `--radius: 0.75rem` (12px). `sm` 6 (badges de status) · `md` 12 (botões, campos) · `lg` 16 (cards, painéis) · `xl` 24 (card de quadra/espaço) · `full` (chips, avatares). Na web `sm`…`xl` são relativos ao `--radius`.
- **Sombras:** `sm`, `md`, `lg` no tom Noite (`rgb(6 32 46 / …)`). A mesma string `box-shadow` funciona no React Native (New Architecture). Cards não têm sombra (pranchas 06 e 07: só borda); sombra só no que flutua (popover, menu, diálogo, toast). No escuro, quase sem sombra: diferencie por superfície (`background` → `card`/`popover` → `muted`).

### Logo
Arquivos em `packages/ui-tokens/brand/` (SVG com o nome em contorno), PNGs dos apps em `brand/png/` e o markup em `@space-sports/ui-tokens` (`brandLogos`, `brandSvg()`). Gerados por `pnpm --filter @space-sports/ui-tokens brand` a partir da prancha 02; use sempre esses arquivos.

| Versão | Arquivo | Onde |
|---|---|---|
| Vertical (principal) | `logo-vertical.svg` | Fundos claros: login, cadastro, boas-vindas |
| Vertical negativa | `logo-vertical-negative.svg` | Sobre Mar e fundos escuros (tema escuro) |
| Vertical sobre Sol | `logo-vertical-on-sol.svg` | Sobre o amarelo |
| Horizontal | `logo-horizontal.svg`, `-negative`, `-on-sol` | Uso secundário: cabeçalhos, sidebar, e-mail, rodapé |
| Monocromática | `logo-mono-dark.svg`, `logo-mono-white.svg` | Uma cor só (impressão, carimbo, sobre foto com contraste) |
| Símbolo | `symbol.svg`, `-negative`, `-on-sol` | Espaço reduzido (sidebar recolhida, avatar) |
| Ícone de app | `app-icon.svg` (Mar), `app-icon-sol.svg` | Ícone das lojas, PWA |
| Favicon | `favicon.svg` | Abaixo de 40 px: versão simplificada, sem malha e sem rastros |

- **Escolha pelo fundo:** positiva no claro, negativa no Mar e no escuro, "sobre Sol" no amarelo. Sobre foto, só com contraste: negativa ou mono.
- **Área de proteção:** x = raio da bola (meia bola) em volta de toda a logo; nenhum texto ou imagem entra nela. Cada arquivo traz `clearSpace` (em unidades do arquivo); `logoClearSpace(asset, largura)` converte para a largura renderizada.
- **Tamanho mínimo digital:** vertical 96 px de largura, horizontal 160 px, símbolo 40 px (`logoMinWidth`). Abaixo de 40 px, o favicon.
- **Não fazer:** distorcer, esticar ou endireitar a inclinação (rede a 18°, nome a 9°); mover a rede para trás da bola ou fechar o anel; trocar cores fora das versões aprovadas; aplicar sobre fotos sem contraste; separar o nome do símbolo na versão vertical; recompor o nome com texto ao vivo.
- **Na web** (`apps/web`): componente `Logo` (`src/components/brand/logo.tsx`) com `layout` vertical, horizontal ou símbolo e `tone` `auto` (positiva no claro, negativa no escuro, trocadas por CSS), `positive`, `negative`, `on-sol` ou `mono-*`. Impõe a largura mínima e reserva a área de proteção (`protect`), e põe o `aria-label="Space Sports"` no invólucro. Horizontal na sidebar (símbolo recolhida, por isso a sidebar recolhida tem 4rem) e no cabeçalho e rodapé das páginas públicas; vertical nas telas de entrada. `SpaceAvatar` mostra a logo do espaço em círculo, ou as iniciais do nome quando não há logo. Botões e campos de 48 px (`size="xl"`, `FormField large`) só nas páginas públicas; o painel mantém a densidade atual. `Chip` e os badges de status seguem [Chips e badges](#chips-e-badges); `focusRing` (`lib/utils.ts`) é a receita do anel de foco.
- A monocromática segue a geometria da horizontal (no kit o card mono usa o nome um pouco menor, uma variação de diagramação da prancha). A negativa horizontal e as versões "sobre Sol" da horizontal e do símbolo combinam a geometria da horizontal/símbolo com as cores aprovadas da vertical correspondente.

### Receita dos componentes no web
Especificação completa em [`docs/brand/auditoria-web.md`](brand/auditoria-web.md) (tarefa 2.35). Resumo:

| Peça | Classes |
|---|---|
| Botões | `default` (primário), `secondary` (destaque), `inverse` (escuro: `bg-inverse text-inverse-foreground`), `ghost` (`text-link`), `link`; desabilitado `disabled:bg-disabled disabled:text-disabled-foreground`; `ghost` só de ícone desabilitado com `disabled:opacity-50` |
| Botão de contorno | `border-[1.5px] border-outline-border bg-outline-background text-foreground hover:bg-accent hover:text-accent-foreground`; desabilitado `disabled:border-disabled disabled:text-disabled-foreground`. Sem `dark:` |
| Campo | `border-[1.5px] border-input bg-input-background`; foco `focus-visible:border-input-focus focus-visible:bg-input-focus-background` + anel; erro: ver [Anatomia de campo](#anatomia-de-campo); desabilitado `disabled:border-disabled disabled:bg-input-disabled disabled:text-disabled-foreground disabled:placeholder:text-disabled-foreground` (sem isso, o placeholder fica mais forte que o texto digitado) |
| Chip de esporte e de filtro | `border-[1.5px] border-chip-border bg-chip text-chip-foreground`; selecionado `border-chip-selected-border bg-chip-selected text-chip-selected-foreground` |
| Badge de status | `border border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground` (idem `success`, `destructive`, `info`); neutro `border-border bg-muted text-muted-foreground` |
| Item ativo (sidebar, horário, aba sublinhada) | `sidebar-primary` / `primary` com o `-foreground` |
| Abas com trilho | Lista `bg-muted`; ativa `data-[state=active]:border-tab-active-border data-[state=active]:bg-tab-active data-[state=active]:text-foreground data-[state=active]:shadow-sm` |
| Rótulo de seção, cabeçalho de tabela | `font-sans text-overline uppercase text-muted-foreground`; eyebrow `text-eyebrow`. Exceção: no Super o cabeçalho de tabela é compacto, sem caixa alta, para as células caberem em 1200 px (decisão do usuário) |
| Título de página (painel, Super) | `font-display text-h3`; seção `font-display text-lg font-semibold`; públicas `text-h1`/`text-display` |
| Diálogo, sheet | `bg-popover` sobre `bg-scrim` |
| Link | `text-link hover:text-link-hover` |
| Tooltip | `bg-inverse text-inverse-foreground` |
| Cartão de opção (`OptionCards`) | Escolha única entre poucas opções que precisam de explicação: `radiogroup` com rádios nativos, ícone, título e descrição. Selecionado `border-chip-selected-border bg-accent` e ícone de marcado, para não depender só da cor |
| Prazo (`TimeSpanField`) | Número + unidade (minutos, horas, dias) e chips de atalho (1h, 3h, 12h, 1 dia, 2 dias). Mostra a maior unidade sem fração e grava minutos; a unidade é de quem digita, o valor não se reorganiza durante a digitação |

### Chips e badges

Receita da tarefa A.2 ("essa cor do amarelo não ficou boa"). Capturas antes e depois, nos dois temas, em [`brand/auditoria-web/ajustes-1/`](brand/auditoria-web/ajustes-1/README.md). As duas peças deixam de se parecer: chip é escolha e etiqueta neutra; badge é situação.

| | Chip | Badge de status |
|---|---|---|
| Para quê | Filtro, opção (duração, pagamento) e esporte | Situação de reserva, pagamento, mensalidade, aula |
| Interação | Selecionável, ou etiqueta sem ação (esporte no card) | Nunca interativo |
| Forma | `full`, 14/500, borda 1.5, padding 8/14; no app, alvo ≥ 44pt. Horário: raio 12 (`shape="slot"`) | Raio 6, 600, borda 1; painel `xs` com padding 2/8, app `sm` com padding 3/10 |
| Cor | Neutro. O Sol só no selecionado | Tinta semântica: fundo, borda e texto do mesmo status |
| Rótulo | Sempre em texto | Sempre em texto; cor sozinha não informa |

| Tom do badge | Quando usar |
|---|---|
| `success` | Confirmada, Paga, Ativa |
| `warning` | Pendente, Aguardando aprovação: pede ação |
| `destructive` | Cancelada, Atrasada, Inadimplente |
| `info` | Concluída, Parcial, Pausada, aviso informativo |
| `muted` | Encerrada, Inativa, Excluído: nada a fazer |

- **Sol é destaque, não tinta de fundo.** Fora da logo e dos botões, ele aparece só no chip selecionado e no contorno do Pendente. Chip neutro nunca recebe tom do Sol (testado). O horário (`slot`) selecionado segue a prancha 06: Mar no claro, Sol no escuro.
- **Chip interativo na web:** o `Chip` é um `span`, porque só serve de etiqueta. Para selecionar, use o `ChipButton`: `button` com `aria-pressed`, `hover:bg-chip-hover` e `focusRing`.
- **Quem herda o amarelo novo:** `warning-subtle` também pinta o bloco da agenda, o `Alert` e o toast. O tom foi escolhido olhando o bloco da agenda, para não gritar em área grande; ali o texto `foreground` tem 13.6 / 10.6:1 e o `muted-foreground`, 5.8 / 5.9:1.

**Divergências do kit, e por quê** (pranchas 06 e 07 continuam valendo no resto):

| Peça | Kit | Agora | Justificativa |
|---|---|---|---|
| Chip, claro | Sol 100 `#FEECB3` + Mar 700 | `#EEF2F4` + Noite, borda `#DCE3E6` | Reclamação do uso real: o amarelo pálido parecia desbotado e competia com os badges. A receita do claro passa a ser a mesma que a prancha 07 já usa no escuro (bg/raised com borda) |
| Chip selecionado, claro | Noite + branco | Sol + Noite, borda Noite | Mesma receita da prancha 07: o selecionado fica igual nos dois temas, e o Sol ganha um papel único. A borda dá os 3:1 que o Sol não dá |
| Pendente, claro | `#FCF1D9` + `#7A5306` | `#FFE69C` + `#663C00`, borda Sol 400 | O creme quase sem saturação com texto oliva parecia sujo e se dissolvia no branco (1.12:1). O novo fundo fica entre Sol 100 e Sol 200 (o Sol 200 pesava demais nos blocos da agenda), e o texto âmbar sobe de 6.1 para 7.7:1 |
| Pendente, escuro | `#3D2410` + `#F29A3A` | `#4A3604` + Sol 300, borda Sol 700 | O marrom com laranja ficava barrento. Dourado, na família do Sol, com texto e borda da própria escala do kit |
| Borda dos status | Sem borda | Borda 1, um tom acima do fundo | Tinta pálida sem contorno perde o limite no sol e sobre branco. Confirmado e Cancelado mantêm fundo e texto do kit |

### Anatomia de campo

Especificação da tarefa A.2 para o `Field` da web (A.7) e do app (A.8). Referência visual dos estados em [`brand/auditoria-web/ajustes-1/`](brand/auditoria-web/ajustes-1/README.md) (`receita-claro.png`, `receita-escuro.png`). Um único componente por plataforma: na web é o `Field` de `components/painel/field.tsx` (o `FormField` de `components/auth` é só `Field` + `Input`), e o app tem `features/auth/components/field.tsx`, com `useFormField` e `validateFields` para a regra de quando validar.

**O que estava ruim:** a dica sumia quando entrava o erro (o usuário perdia a instrução justo quando precisava dela); o `Field` do painel não ligava dica e erro ao campo com `aria-describedby`; o erro usava `role="alert"` em cada campo, o que faz o leitor de tela disparar tudo de uma vez ao enviar; em foco a borda deixava de ser de erro; dica de 12 px; e o `Field` do app não tem dica.

```
Rótulo (opcional)              rótulo: 14/500 `foreground`
                               ↕ 6
┌──────────────────────────┐   controle: borda 1.5, raio 12
│ Valor                  ⌄ │   à direita, só ação do controle ou "validando"
└──────────────────────────┘
                               ↕ 6
Dica                           dica: `muted-foreground`
                               ↕ 4
(!) Erro curto                 erro: 500 `input-error-foreground`, ícone de 16
```

| Medida | Valor | Web | App |
|---|---|---|---|
| Rótulo → controle, controle → dica | 6 | `gap-1.5` | `gap-1.5` |
| Dica → erro | 4 | `gap-1` | `gap-1` |
| Ícone de estado → texto | 6, ícone de 16 | `gap-1.5`, `size-4` | `gap-1.5`, `size={16}` |
| Campo → campo / grupo → grupo | 16 / 24 | `gap-4` / `gap-6` | `gap-4` / `gap-6` |
| Altura do controle | Painel 36; públicas e app 48 | `h-9` / `h-12` | `h-12` |
| Texto de dica e erro | Web 13/18; app 14/20 | `text-helper` | `text-sm` |

As medidas estão em `fieldLayout` (`@space-sports/ui-tokens`). Não reserve espaço para o erro: num painel denso a folga custa mais que o campo seguinte descer alguns pixels.

| Estado | Borda | Fundo | Texto | Observações |
|---|---|---|---|---|
| Padrão | `input` | `input-background` | `foreground`; placeholder `muted-foreground` | |
| Foco | `input-focus` | `input-focus-background` | | Web: anel `focusRing` só em `focus-visible`. App: sem anel no toque, `useFocusRing` no teclado físico. A largura da borda fica em 1.5, para o conteúdo não mexer |
| Erro | `input-error` | `input-error-background` | | Sem ícone dentro do controle |
| Erro + foco | `input-error` | `input-error-background` | | O erro vence a cor do foco, para seguir visível durante a correção; o anel fica. O Sol 50 não entra: com a borda vermelha ele fica sujo |
| Desabilitado | `disabled` | `input-disabled` | `disabled-foreground` | Sem `opacity` |
| Validando | `input` | `input-background` | | Spinner de 16 `muted-foreground` à direita; web com `aria-busy` |
| Confirmado | `input` | `input-background` | | Só para confirmação assíncrona (ex.: CEP encontrado): `CircleCheck` + mensagem `success-subtle-foreground`. Sem borda verde e sem "ok" em campo comum |

- **Dica:** não some. O erro entra abaixo dela e os dois ficam visíveis, porque a dica costuma ser a instrução de correção. Só a dica de contexto, que não ajuda a corrigir ("Usamos só para avisar sobre a reserva"), pode sair durante o erro, com a prop `hideHintOnError`. Uma linha, sem repetir o rótulo. Placeholder é exemplo de formato; nunca substitui rótulo nem dica.
- **Rótulo:** sempre visível. Campos são obrigatórios por padrão; o opcional leva "(opcional)" em `muted-foreground`, peso 400. Sem asterisco.
- **Ícone de estado:** `CircleAlert` (erro) e `CircleCheck` (confirmado), de 16, na linha da mensagem, com `aria-hidden`. Nunca dentro do controle: o lado direito é do olho da senha, do calendário e da seta do select. A cor nunca é o único sinal: erro tem ícone e texto.
- **Quando validar:** ao sair do campo e ao enviar, nunca durante a primeira digitação. Depois que o erro aparece, revalide a cada alteração e tire a mensagem assim que o valor ficar certo. O botão de enviar continua habilitado; ao enviar com erro, o foco vai para o primeiro campo inválido.
- **Erro vindo da API:** com campo definido (e-mail já cadastrado), entra no campo. Sem campo, vira `Alert` `destructive` no topo do formulário, com `role="alert"`.
- **Grupos** (chips, rádio, checkbox, data em popover): mesma anatomia, com a dica e o erro abaixo do grupo. `aria-invalid` e `aria-describedby` ficam no `role="radiogroup"`, `group` ou `fieldset`. Chips não mudam de cor no erro.

**Mensagens:** curtas, cabendo em uma linha numa tela de 320 px (até uns 40 caracteres), sem ponto final. Dizem o que fazer, não o que deu errado.

| Evite | Prefira |
|---|---|
| Campo obrigatório | Informe seu nome |
| Telefone inválido | Informe o telefone com DDD |
| Formato de e-mail incorreto | Confira o e-mail: falta o @ |
| Valor deve ser maior que 0 | Informe um valor acima de R$ 0,00 |
| Erro ao buscar o CEP | CEP não encontrado. Preencha à mão |

**Web** (`aria-invalid` no controle; com ele as classes valem para `input`, `textarea`, `select` e gatilhos):

```tsx
<div className="grid gap-1.5">
  <Label htmlFor={id}>{label}</Label>
  {/* controle com id, aria-invalid={error ? true : undefined} e
      aria-describedby={[error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined} */}
  {hint || error ? (
    <div className="grid gap-1 text-helper">
      {hint ? <p id={hintId} className="text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="text-input-error-foreground flex gap-1.5 font-medium">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  ) : null}
</div>
```

- Em `fieldClasses`, troque `aria-invalid:border-destructive` por `aria-invalid:border-input-error aria-invalid:bg-input-error-background aria-invalid:focus-visible:border-input-error aria-invalid:focus-visible:bg-input-error-background`. O par com `focus-visible` tem de existir: sem ele a borda de foco cobre a de erro.
- O erro vem antes da dica em `aria-describedby`, para ser lido primeiro. Sem `role="alert"` por campo: a mensagem é lida quando o foco chega ao campo.

- Na web o `Field` entrega `id`, `aria-invalid` e `aria-describedby` pelo contexto (`components/ui/field-control.ts`): `Input`, `Textarea`, `Select`, `SelectTrigger`, `MaskedInput` e os seletores de data herdam sozinhos, e o que o controle passar prevalece. Props: `optional`, `hint`, `hideHintOnError`, `confirmation` e `group` (vários controles sob um rótulo: chips, período).
- Erro sem campo: `FormError` (`Alert` `destructive`) logo abaixo do cabeçalho do formulário. Ao enviar com erro, `focusFirstInvalid(form)` leva o foco ao primeiro campo inválido.

### Máscaras e datas (web)

Funções puras em `packages/shared/src/masks.ts`, para web e app digitarem igual: `mask*` formata texto parcial; `normalize*` e `parse*` só aceitam o valor completo e devolvem `null` se ele não servir. Vai para a API só o valor normalizado: telefone em E.164, dinheiro em centavos, CEP em 8 dígitos, data em `yyyy-MM-dd`, hora em `HH:MM`.

| Máscara | Exibição | Teclado (`inputMode`) | Para a API |
|---|---|---|---|
| `cep` | `30130-010` | `numeric` | `normalizeCep` |
| `phone` | `(31) 3333-4444`, `(31) 99999-8888` | `tel` | `normalizePhone` |
| `cpf` | `123.456.789-09` | `numeric` | `normalizeCpf` (confere os verificadores) |
| `cnpj` | `12.ABC.345/01DE-35` | `text`: desde 2026 o CNPJ pode ter letras | `normalizeCnpj` (idem) |
| `money` | prefixo `R$`; `1.500,50` | `decimal` | `parseMoneyToCents` |
| `time` | `14:30` | `numeric` | `normalizeTime` |
| `date` | `28/10/2026` | `numeric` | `parseDateInput` |
| `integer` | só dígitos | `numeric` | `Number()` |

- **`MaskedInput`** (`components/ui/masked-input.tsx`): o valor é o texto formatado e o cursor fica no caractere que estava sendo editado. `type="number"` não é usado: traz setas, aceita `e` e perde zeros. Dinheiro completa os centavos ao sair do campo (`150` → `150,00`).
- **`DatePicker` e `DateRangePicker`** (`components/ui/date-picker.tsx`): campo digitável em dd/mm/aaaa e calendário em popover (`Calendar` sobre `react-day-picker`, pt-BR, semana a partir do domingo). O valor segue em `yyyy-MM-dd`. Data incompleta, inexistente ou fora de `min`/`max` não chega ao formulário e o texto volta ao valor salvo ao sair do campo. O período mostra as duas pontas no mesmo campo: dois cliques no calendário definem início e fim, em qualquer ordem. Para datas distantes (nascimento), `yearDropdown` troca o título do calendário por listas de mês e ano entre `min` e `max`. `type="date"` e `type="time"` não são usados.
- **`TimeInput`**: hora digitada, que só chega ao formulário completa.
- **`CepField`** (`components/painel/cep-field.tsx`): ao completar 8 dígitos, busca na API e preenche logradouro, bairro e cidade, com o foco no número (ou na rua, se o CEP for geral do município). A cidade vem do catálogo: se não estiver lá, o aviso pede para escolher à mão. Falha nunca é erro de campo: é um aviso discreto na dica. CEP já salvo não dispara busca ao abrir o formulário.
- **Exibição:** toda data sai de `lib/format.ts` em dd/mm/aaaa, em `America/Sao_Paulo`. Não crie `Intl.DateTimeFormat` nas telas.

**App** (o React Native não tem `aria-invalid`; o equivalente é o rótulo e a dica de acessibilidade):

```tsx
<View className="gap-1.5">
  <Text variant="small">{label}</Text>
  <Input
    invalid={!!error}
    accessibilityLabel={error ? `${label}, com erro` : label}
    accessibilityHint={[error, hint].filter(Boolean).join('. ') || undefined}
    {...inputProps}
  />
  {hint || error ? (
    <View className="gap-1">
      {hint ? <Text className="text-sm text-muted-foreground">{hint}</Text> : null}
      {error ? (
        <View className="flex-row gap-1.5" accessibilityLiveRegion="polite">
          <CircleAlert size={16} color={color(name, 'inputErrorForeground')} aria-hidden />
          <Text className="flex-1 text-sm font-medium text-input-error-foreground">{error}</Text>
        </View>
      ) : null}
    </View>
  ) : null}
</View>
```

- `Input` (`components/ui/input.tsx`) passa a usar os tokens em vez de `bg-card dark:bg-muted` e `border-link`: `bg-input-background` e `border-input`; foco `border-input-focus bg-input-focus-background`; `invalid` `border-input-error bg-input-error-background`, que vence o foco; desabilitado `border-disabled bg-input-disabled text-disabled-foreground`, sem `opacity-50`.
- Ao enviar com erro, dê `focus()` no primeiro campo inválido e anuncie a mensagem com `AccessibilityInfo.announceForAccessibility`: `accessibilityLiveRegion` só funciona no Android.

### Explorar e anúncios

Especificação da tarefa AD.1 para o novo Explorar do app (AD.4) e a pré-visualização das peças no `/super` (AD.3). Decisões 73 a 79 de `07-perguntas-em-aberto.md`; estrutura e formatos em [`12-anuncios.md`](12-anuncios.md), seções 3 e 4; RF-ADS-04 a 06, RF-SPACE-12 e RF-SPACE-13.

**Mockup** (360 dp, 1:1, claro, escuro e carregando): [`anuncios/explorar-mockup.png`](anuncios/explorar-mockup.png) (o `.svg` ao lado é a mesma tela, com as imagens por caminho relativo). **Banners de teste** com o degradê, em telas de 360 e 412 dp: [`anuncios/banners-teste.png`](anuncios/banners-teste.png). As medidas vêm de `exploreLayout` e `mediaOverlayStops` (`@space-sports/ui-tokens`, `layout.ts`); use as constantes, não os números soltos.

**Objetivo e hierarquia:** a pessoa abre o app para achar onde jogar. A busca continua no topo e é a primeira coisa; os atalhos resolvem o filtro mais comum com um toque; a área paga fica concentrada no carrossel e em cards marcados na lista, sempre com o selo; os recentes devolvem a pessoa ao espaço que ela já usa. Nada cobre a tela (decisão 77).

#### Tela inteira

De cima para baixo, numa tela de 360 dp:

```
┌ TabHeader (fixo, sem mudança): logo horizontal 160 · sino ┐
│ Busca + filtros + LocationBanner (fixos, sem mudança)      │  px 16 · pt 12 · pb 8 · gap 12
├─ FlashList ────────────────────────────────────────────────┤  paddingTop 8 · paddingBottom 24
│ [◎ Beach Tennis] [◎ Futevôlei] [◎ Vôlei de Pr…  →          │  atalhos, 44 de altura
│                        ↕ 24                                │
│ ┌──────────────────────────────────────┐                   │
│ │ (Patrocinado · Rede Quadra…)         │  banner 2:1,       │
│ │ Raquetes de beach tennis             │  328 × 164,        │
│ │ com até 30% off                      │  raio 24           │
│ │ (Ver ofertas ↗)                      │                   │
│ └──────────────────────────────────────┘                   │
│               ▬ ─ ─ ─                  ↕ 8, segmentos 20×4  │
│                        ↕ 24                                │
│ Espaços recentes                       título 20/28        │
│                        ↕ 12                                │
│ ┌──────┐ ┌──────┐ ┌─                   cards 152 × 170,    │
│ │ foto │ │ foto │ │                    12 entre eles       │
│ │◉     │ │◉     │ │                                        │
│ │Nome  │ │Nome  │ │                                        │
│ │Bairro│ │Bairro│ │                                        │
│ └──────┘ └──────┘ └─                                       │
│                        ↕ 24                                │
│ Espaços perto de você                  título 20/28        │
│                        ↕ 12                                │
│ ┌ card de espaço (sem mudança) ┐                           │
│                        ↕ 16                                │
│ ┌ card de espaço ┐                                         │
│                        ↕ 16                                │
│ ┌ card patrocinado (3ª posição) ┐                          │
│ … a cada 8 espaços, outro card patrocinado                 │
└────────────────────────────────────────────────────────────┘
```

- **Cabeçalho e busca não mudam e continuam fixos** acima da lista, como hoje (`TabHeader`, `SearchHeader`, `LocationBanner`). A busca fica a um toque em qualquer ponto da rolagem.
- **Uma lista só** (`FlashList`): as seções do topo vão no `ListHeaderComponent` e os cards patrocinados entram nos dados, com `getItemType` próprio (`space`, `ad`, `sponsored-space`) para a reciclagem não misturar layouts.
- **Margens:** a lista perde o `paddingHorizontal` atual. Cada card leva `px-4` (16) e as faixas horizontais (atalhos, carrossel, recentes) rolam de borda a borda, com 16 de respiro no começo e no fim do conteúdo (`contentContainerStyle={{ paddingHorizontal: 16 }}`).
- **Espaçamento:** o cabeçalho da lista é uma coluna com `gap-6` (24, `exploreLayout.sectionGap`) que só recebe as seções presentes: seção ausente não deixa buraco. Título da seção → conteúdo: 12 (`sectionTitleGap`). Título da lista → primeiro card: 12. Entre os cards: 16 (`listGap`, como hoje).
- **Títulos das seções** ("Espaços recentes", "Espaços perto de você"): `font-display-semibold text-xl` (20/28), `text-foreground`, `role="header"`, à esquerda, sem "Ver mais". O carrossel e os atalhos não têm título visível (o selo e os ícones já se explicam); cada um tem `accessibilityLabel` no contêiner ("Anúncios", "Atalhos por esporte").

| Estado | Atalhos | Carrossel | Recentes | Título da lista |
|---|---|---|---|---|
| Sem busca e sem filtro (o raio pode estar mudado) | Sim | Se houver peça no ar | Se houver ao menos 1 espaço | "Espaços perto de você" (com localização) ou "Espaços" |
| Filtro ativo (esporte, serviço, infraestrutura, "4+ estrelas" ou a ordem "Melhor avaliados"), sem busca por nome | Sim, com o esporte selecionado (se houver) | Não | Não | "Resultados" |
| Busca por nome (com ou sem filtro) | Não | Não | Não | "Resultados" |

- **O que conta como filtro aqui:** esporte, serviço, infraestrutura e, desde a AV2.3, o "4+ estrelas" e a ordem "Melhor avaliados" ([Avaliações, (11)](#11-nota-no-explorar-filtro-e-ordem-app-decisão-109-rf-review-10)). **O raio de distância não conta**: mudar o raio não esconde seção nem troca o título, que segue "Espaços perto de você". O raio só restringe a lista (e o selo de contagem do botão de filtros continua contando o raio, como hoje). No app, use um teste próprio (`hasContentFilters`: esporte, serviço, infraestrutura, `minRating` ou `sort` diferente de `distance`), e não o `countActiveFilters`, que inclui o raio.
- **Atalhos com filtro ativo** (decisão da sessão principal na revisão da AD.1; `12-anuncios.md`, seção 3, RF-SPACE-12 e RF-SPACE-13): os atalhos ficam visíveis com filtro ativo e somem só com a busca por nome. Eles são o próprio controle do filtro de esporte; se sumissem ao toque, o estado selecionado nunca apareceria e a pessoa teria de abrir os filtros para desfazer. Carrossel e recentes somem com busca por nome ou com filtro ativo.
- Os cards patrocinados seguem na lista em todos os estados (RF-ADS-05). Lista vazia: o `EmptyView` atual abaixo do título.
- **Puxar para atualizar** recarrega catálogo, anúncios, recentes e lista.

#### 1. Atalhos por esporte (RF-SPACE-13)

- **Chip, não ícone solto:** o `Chip` do app (`components/ui/chip.tsx`, forma `pill`), com ícone de 18 à esquerda do nome. O catálogo tem nomes longos ("Vôlei de Praia") e poucos esportes (3 hoje); a grade de ícones do iFood precisaria de nome em 12 px, que o app não usa para texto essencial. O chip também já tem os estados e o contraste testados (ver [Chips e badges](#chips-e-badges)).
- **Medidas:** altura mínima 44 (alvo de toque), padding 8/16, borda 1.5, `rounded-full`, ícone 18 → texto 6 (`gap-1.5`), texto 14/500. Entre chips, 8 (`exploreLayout.shortcut`).
- **Cores:** normal `bg-chip border-chip-border text-chip-foreground`; pressionado `bg-chip-hover`; selecionado `bg-chip-selected border-chip-selected-border text-chip-selected-foreground` (Sol + Noite nos dois temas, borda Noite no claro). O ícone usa a cor do texto do estado.
- **Ícones:** SVGs novos em `packages/ui-tokens` (`src/sport-icons.ts`), na grade e no traço do Lucide (24×24, traço 2, pontas redondas), para conviverem com o `lucide-react-native`. O Lucide só tem o `Volleyball` (usado no vôlei de praia); a raquete de beach tennis foi desenhada do zero, e o futevôlei combina o pé do `Footprints` do Lucide, deslocado, com uma bola desenhada. Os dois derivados do Lucide levam o crédito da licença ISC (© Lucide Contributors) no `sport-icons.ts`. A chave é `sportIconKey(sport)`: o `icon` do catálogo, se for uma chave conhecida, senão o `slug`. Esporte sem ícone mostra só o nome. No app: `<SvgXml xml={sportIconSvg(key, { color: color(name, selected ? 'chipSelectedForeground' : 'chipForeground') })} width={18} height={18} />`.
- **Comportamento:** tocar seleciona o esporte (`setFilters({ sport: slug })`); tocar no selecionado tira o filtro (`sport: null`). É o mesmo filtro dos filtros e do Mapa. Ordem do catálogo (`/v1/sports`). Rolagem horizontal sem barra (`showsHorizontalScrollIndicator={false}`); ao abrir com um esporte já selecionado fora da tela, role até ele.
- **Acessibilidade:** contêiner com `accessibilityLabel="Atalhos por esporte"`. Cada chip com `role="button"` (sobrescreve o `radio` do `Chip`, porque o atalho desmarca) e `aria-selected={selected}`; o `Chip` só põe `aria-checked` no papel `radio` (prop `role`, padrão `radio`), então o botão não leva `aria-checked`; rótulo = nome do esporte e dica "Mostra só espaços com este esporte" (selecionado: "Toque de novo para ver todos").
- **Carregando:** três `Skeleton` `rounded-full` de 44 de altura e larguras 132, 112 e 140. **Erro ou catálogo vazio:** a faixa some.

#### 2. Carrossel patrocinado (`EXPLORE_HERO`, RF-ADS-04)

Camadas, de baixo para cima: imagem → degradê → selo → bloco de texto e botão. O texto é desenhado pelo app, nunca vem na imagem.

- **Página:** `FlatList` horizontal com `pagingEnabled`; cada página tem a largura da tela e `px-4`, e o banner ocupa o resto (360 dp → 328 × 164). Sem espiar o banner seguinte.
- **Banner:** proporção 2:1, `rounded-xl` (24, como o card de espaço), `overflow-hidden`, fundo `bg-muted` enquanto a imagem carrega. Imagem com `expo-image`, `contentFit="cover"`.
- **Degradê de leitura** (funciona com foto clara e escura): vertical, de cima para baixo, na cor `media-overlay` (Noite) com as opacidades de `mediaOverlayStops`: 0 no topo, 0.50 a 22% da altura, 0.62 a 45% e 0.85 na base. No app, `react-native-svg` (já instalado): `<LinearGradient x1="0" y1="0" x2="0" y2="1">` com um `<Stop stopColor={color(name, 'mediaOverlay')} stopOpacity={…} />` por parada, num `Svg` com `StyleSheet.absoluteFill`. Calibrado para o pior caso, a foto branca: o topo do título (a partir de 22%) fica com ≥ 3:1 e o texto corrido (a partir de 45%) com ≥ 4.5:1. O topo do banner fica quase sem véu, e a foto aparece ali.
- **Selo** no canto superior esquerdo, a 12 da borda (`hero.badgeInset`). Receita em [Selo "Patrocinado"](#selo-patrocinado).
- **Bloco de texto**, ancorado embaixo, com 16 de margem (esquerda, direita e base), alinhado à esquerda:
  - **Título:** `font-display-bold`, 20/24, `text-media-foreground`, até 2 linhas (cai para 1 quando não couber, ver abaixo). É texto grande pela WCAG (20 px em negrito), por isso vale o 3:1 no topo do degradê.
  - **Texto:** `font-sans` 14/20, `text-media-foreground`, **1 linha** com reticências; título → texto: 2. O texto completo vai sempre no rótulo de acessibilidade.
  - **Regra de caber:** o bloco não pode subir além de 4 abaixo do selo (`hero.badgeClearance`). Meça a altura do bloco e a do selo com `onLayout` e corte nesta ordem: (1) esconda o texto; (2) se ainda passar, o título vai para `numberOfLines={1}`, com reticências. Na prática, com fonte normal, em 360 dp o texto aparece com título de uma linha e sai com título de duas; em 412 dp os dois cabem. Com fonte 1.3× (o máximo, ver abaixo), o título fica em 1 linha em 320 e 360 dp: título, botão e selo precisam de 139 dos 144 do banner de 320 dp.
  - **Botão:** pílula com altura mínima de 32 (`hero.ctaHeight`, `min-h-8`; cresce com a fonte), padding 14 à esquerda e 12 à direita, `bg-media-action`, texto 14/600 `text-media-action-foreground` e o ícone do destino (16) depois do texto, com 6 entre eles. Texto (ou título, sem texto) → botão: 8. É só visual: o banner inteiro é o alvo de toque.
  - Todos os textos do banner (selo, título, texto e botão) com `maxFontSizeMultiplier={1.3}`: acima disso nem título de uma linha cabe em 320 dp. A regra de caber cuida do resto.
- **Ícone do destino** (o mesmo no banner e no card): URL `ArrowUpRight`, WhatsApp `MessageCircle`, espaço `ChevronRight` (`lucide-react-native`).
- **Anunciante espaço sem imagem própria:** a capa do espaço no lugar da imagem (sem capa, `bg-muted`), com o mesmo degradê; a logo (`SpaceAvatar` de 40, borda 2 `border-media-foreground`) no canto superior direito, a 12 da borda; o selo diz "Patrocinado · <nome do espaço>" e perde 52 de largura máxima para não encostar na logo.
- **Indicador em segmentos**, abaixo do banner (8 de distância), centralizado, só com 2 ou mais banners: segmentos de 20 × 4, `rounded-full`, 4 entre eles (`hero.indicator`). Trilho `bg-border`; o segmento da peça atual enche da esquerda para a direita em `bg-primary` (Mar no claro, Sol no escuro, ≥ 7:1 sobre o fundo) durante os 5 s, em ritmo linear (`Animated` do React Native com o driver nativo, `scaleX` a partir da esquerda). Fica fora da foto para não brigar com o texto e ter contraste garantido nos dois temas. Decorativo: `aria-hidden`.
- **Troca automática** a cada 5 s (`hero.autoplayMs`), da última volta para a primeira. Ao trocar, o segmento seguinte começa vazio.
  - **Pausa** enquanto a pessoa toca ou arrasta (`onTouchStart`, `onScrollBeginDrag`); ao soltar, a peça atual ganha 5 s inteiros. O arrasto manual sempre funciona.
  - **Desligada** com "reduzir movimento" (`AccessibilityInfo.isReduceMotionEnabled` e o evento `reduceMotionChanged`, ou `useReducedMotion` do Reanimated) e com leitor de tela ligado (`isScreenReaderEnabled`): conteúdo que se move sozinho atrapalha quem navega por foco (WCAG 2.2.2). Nesses casos o segmento atual aparece cheio, sem animação.
  - **Parada** com o Explorar fora de foco (`useIsFocused`), com o app em segundo plano (`AppState`) e com o carrossel fora da tela (rolado para baixo).
- **Toque:** o banner inteiro é um `Pressable` com `role="link"` e `active:opacity-90`. Rótulo: "Patrocinado, <anunciante>. <título>. <texto>. <botão>. Anúncio 1 de 3"; dica pelo destino: "Abre o site do anunciante", "Abre o WhatsApp do anunciante" ou "Abre a página do espaço".
- **Carregando:** um `Skeleton` do tamanho do banner (2:1, `rounded-xl`), sem indicador, só na primeira carga (sem cache). **Sem peça no ar ou erro:** o carrossel não é montado e o `gap` some com ele. O carregamento dos anúncios nunca segura a lista.

#### 3. Card patrocinado na lista (`EXPLORE_FEED`, RF-ADS-05)

Mesmo esqueleto do card de espaço, para a lista manter o ritmo: largura, raio 24, borda, fundo, foto 4:5 no topo, os mesmos 20/16/20 de padding e a mesma linha divisória antes do rodapé. A diferença está no selo sobre a foto e no rodapé.

```
┌──────────────────────────────┐
│ (Patrocinado · Pulso Nutr…)  │  selo a 16 da borda
│                              │
│          foto 4:5            │
│                              │
├──────────────────────────────┤
│ Whey e pré-treino para o     │  título 20/28, até 2 linhas
│ pós-jogo                     │
│ Proteína para recuperar…     │  texto 14/20, até 3 linhas
│ ──────────────────────────── │
│ example.com    [Ver produtos ↗] │  destino · botão de contorno 40
└──────────────────────────────┘
```

| | Card de espaço | Card patrocinado |
|---|---|---|
| Casca | `rounded-xl border border-border bg-card`, foto 4:5 | Igual |
| Sobre a foto | Nada | Selo "Patrocinado · <anunciante>" a 16 do canto (`feed.badgeInset`) |
| Cabeçalho | Logo 44 + nome (`h4`) + bairro e distância | Título `font-display-semibold` 20/28, até 2 linhas; texto 14/20 `text-muted-foreground`, até 3 linhas; 4 entre eles |
| Meio | Chips de esporte | Nada |
| Rodapé (`border-t border-border pt-3`) | Preço/hora e serviços | À esquerda, o destino em 14/20 `text-muted-foreground`, 1 linha: domínio da URL sem `www.`, "WhatsApp" ou bairro · cidade do espaço. À direita, o botão |

- **Botão:** o de contorno do kit, 40 de altura (`feed.ctaHeight`), padding 16, `rounded-md`, borda 1.5 `border-outline-border`, fundo `bg-outline-background`, texto 14/600 `text-foreground` e o ícone do destino (16). Contorno, e não Sol, para o anúncio não gritar mais que os espaços. É só visual: o card inteiro é o alvo de toque (`role="link"`, `active:opacity-90`), com o rótulo e a dica do banner.
- **Anunciante espaço sem imagem própria:** é o `SpaceCard` de hoje, sem nenhuma mudança, com o selo "Patrocinado · <nome do espaço>" sobre a capa (ou sobre o placeholder, sem capa), a 16 do canto. O título e o texto da peça não aparecem. O rótulo de acessibilidade ganha "Patrocinado, " na frente; o toque abre o espaço e conta o clique.
- **Anunciante espaço com imagem própria:** o card patrocinado normal; o rodapé mostra bairro · cidade do espaço e o ícone `ChevronRight`.
- **Vagas fixas e anúncio atrasado:** as vagas são sempre as mesmas posições da lista: a 3ª e depois a cada 8 espaços (3ª, 12ª, 21ª…, contando os cards patrocinados: há sempre 8 espaços entre dois patrocinados). A peça de cada vaga segue a ordem do sorteio em rodízio, sem a mesma peça em duas vagas seguidas; com uma peça só, ela entra em vagas alternadas. Lista que termina bem numa vaga leva o card no fim (com 2 espaços, o card é o 3º); com 1 espaço, não há card. Sem esqueleto próprio: a lista não espera os anúncios. Se eles chegarem depois de a lista aparecer, preencha só as vagas que **ainda não apareceram na tela** (use o `onViewableItemsChanged` que já conta as impressões para saber até onde a pessoa viu); vaga que já passou pela tela fica sem anúncio até a próxima abertura do Explorar ou o puxar para atualizar. Assim nenhum card que a pessoa já viu é empurrado. Implementação (`features/explore/feed.ts`): a vaga conta como vista quando o espaço logo depois dela já apareceu (qualquer pedaço na tela); os anúncios do feed ficam congelados na primeira resposta de cada "sessão" da lista (a mesma busca e filtros, até o puxar para atualizar ou o app reabrir), para uma nova entrega não trocar nem tirar cards já mostrados. Registrado em `12-anuncios.md`, seção 3.

#### 4. Espaços recentes (RF-SPACE-12)

- **Seção:** título "Espaços recentes" (ver Tela inteira), 12, e uma faixa horizontal (`FlatList`, `contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}`, sem barra). Até 10 cards; em 360 dp aparecem dois e a ponta do terceiro, o que mostra que rola.
- **Sem "Ver mais":** com no máximo 10 itens a faixa já mostra tudo, e não há uma tela de histórico para onde levar.
- **Card compacto** (`exploreLayout.recent`): 152 de largura, `rounded-lg` (16), `border border-border bg-card`, `overflow-hidden`.
  - Foto: largura toda × 96, `contentFit="cover"`; sem capa, `bg-muted` com o `ImageIcon` de 24 em `muted-foreground`.
  - Logo: `SpaceAvatar` de 36, a 12 da esquerda, centrada na borda de baixo da foto (metade sobre a foto), com anel de 2 `border-card` para se soltar da foto.
  - Texto: padding 12 nas laterais e na base, 22 no topo (os 18 da logo + 4). Nome 14/20 600 `text-foreground`, 1 linha; bairro · cidade (ou só a cidade) 14/20 `text-muted-foreground`, 1 linha. Sem distância nem preço: o card é para voltar, não para comparar.
  - Altura: 170.
- **Toque:** abre `espaco/[slug]`; `role="link"`, rótulo "<nome>, <bairro>", dica "Abre a página do espaço"; `active:opacity-90`.
- **Histórico do aparelho:** até 10 espaços, um por slug, com os dados do card, gravados ao abrir `espaco/[slug]` (o mais recente na frente), num JSON nos documentos do app (`expo-file-system`; o SecureStore tem limite de ~2 KB por chave). **Logado**, a faixa junta o histórico do aparelho com `GET /v1/me/recent-spaces`, sem repetir slug e até 10: como a API não devolve a data da interação, os abertos neste aparelho vêm primeiro e os da conta completam, na ordem da API. A entrada sai do histórico quando a página do espaço responde **404** ou mostra o espaço **suspenso ou fora da vitrine**: o card não volta a aparecer nem leva a uma página morta. O histórico inteiro é apagado **ao sair da conta** e na **exclusão ou inativação da conta** (no aparelho em que isso foi feito), para não ficar rastro de onde a pessoa jogou. Sem conta, ele continua até a pessoa limpar os dados do app.
- **Carregando:** o histórico do aparelho é instantâneo e aparece direto. Só com conta, histórico local vazio e `GET /v1/me/recent-spaces` pendente, mostre o título e três `Skeleton` de 152 × 170 (`rounded-lg`); se a resposta vier vazia, a seção sai. **Erro:** fica só o histórico local; sem ele, a seção não aparece.

#### Selo "Patrocinado"

Obrigatório e sempre visível em toda peça (RF-ADS-06; CDC e CONAR).

- **Forma:** pílula com altura **mínima** de 24 (`exploreLayout.badge.minHeight`, `min-h-6` com `py-0.5`; com fonte grande ela cresce junto com o texto, em vez de cortá-lo), padding 10 nas laterais, `rounded-full`, `bg-sponsored`. Texto 14/20 `text-sponsored-foreground`: "Patrocinado" em 600, seguido de " · <anunciante>" em 500. É a pílula Noite + branco do card de quadra da prancha 06, com o texto no mínimo do app (14).
- **Tokens:** `sponsored` `#06202E` e `sponsored-foreground` `#FFFFFF`, **iguais nos dois temas**, porque o selo fica sempre sobre a foto, que não muda com o tema (16.7:1). No escuro a prancha 07 pinta a pílula da foto de Sol; o selo não segue, para o anúncio não chamar mais atenção que a lista.
- **Nome longo:** "Patrocinado" nunca é cortado; o nome do anunciante encolhe e termina em reticências (`numberOfLines={1}` só nele, dentro de uma linha com `flex-shrink`). Largura máxima: a da peça menos os dois recuos (e menos a logo, no banner de espaço).
- **Sobre qualquer foto:** a pílula é opaca, então o texto tem 16.7:1 em qualquer imagem. Em foto escura a borda da pílula se mistura com a foto, mas o texto continua legível; em foto clara ela se destaca (16.7:1).
- **Acessibilidade:** o selo em si fica fora da árvore (`aria-hidden`), porque o rótulo da peça já começa com "Patrocinado, <anunciante>".
- `maxFontSizeMultiplier={1.3}`.

#### Contraste conferido com as imagens de teste

Medido pixel a pixel nas fotos de `apps/api/src/db/demo-assets/ads/`, com o degradê aplicado e texto branco (`media-foreground`). Título na área de duas linhas de um banner de 360 dp; texto corrido na posição dele num banner de 412 dp (onde ele aparece). Ver [`anuncios/banners-teste.png`](anuncios/banners-teste.png).

| Banner | Foto | Título (mín. / mediana) | Texto (mín. / mediana) |
|---|---|---|---|
| `rede-quadra-hero.jpg` | Escura (saibro) | 3.96 / 10.3 | 7.29 / 13.3 |
| `areia-fit-hero.jpg` | Clara (céu) | 3.42 / 4.71 | 6.27 / 7.78 |
| `forca-total-hero.jpg` | Quase branca | 3.42 / 4.37 | 5.96 / 8.11 |

Título ≥ 3:1 (texto grande) e texto ≥ 4.5:1 em todas, inclusive na foto quase branca, que é o pior caso. O botão Sol fica acima de 3:1 (elemento não textual) contra o degradê: em foto branca, medido na borda de cima da pílula, 3.8:1 em 320 dp, 4.1:1 em 360 dp e 4.3:1 em 412 dp; com fonte 1.3× a pílula cresce para cima e o pior caso cai para 3.6:1 (320 dp). Em foto preta, ≥ 10:1. As fotos do feed (`*-feed.jpg`) só recebem o selo, que é opaco: o brilho médio no canto do selo vai de 101 (sucos) a 227 (shake), e o texto do selo fica em 16.7:1 em todas. O teste `contrast.test.ts` repete a conta no pior caso (foto branca e preta) para os dois temas e para os valores HSL do mobile.

**Para o `/super` orientar o anunciante:** sem texto na imagem (o app escreve o texto); o assunto da foto na metade de cima ou à direita, porque a base esquerda recebe o degradê e o texto; nada importante a menos de 12 dos cantos (raio 24).

#### Pré-visualização no `/super` (AD.3, RF-ADS-03)

- **Onde:** no editor da peça. As contas consideram a sidebar de 256 e o `p-6` (24 de cada lado) do `/super`:
  - **A partir de ~1600 px de janela** (sobram ~1300 de conteúdo): formulário à esquerda (até 480) e, à direita, `sticky`, as duas molduras **lado a lado** (2 × 360 + 24 entre elas), com 24 entre o formulário e as prévias.
  - **Abaixo de 1600 px:** a prévia vai **abaixo do formulário**, com abas **Claro | Escuro** (`Tabs` do shadcn, trilho `bg-muted`), uma moldura por vez. Não force duas molduras de 360 lado a lado ao lado do formulário: em 1280 px sobram ~976 de conteúdo e o formulário ficaria espremido.
- **Moldura:** cada tema numa moldura de 360 de largura (a tela de referência do app), em escala 1:1, `rounded-lg border border-border`, com fundo `bg-background` do tema e padding 16 nas laterais; acima, rótulo `text-overline uppercase text-muted-foreground` "Claro" / "Escuro". Para forçar o tema dentro da moldura, envolva-a em `<div className="light">` ou `<div className="dark">`: o `theme.css` declara as variáveis do claro também em `.light`, então cada moldura troca os tokens sem depender do tema do painel. Os componentes da prévia não podem usar `dark:` (o `@custom-variant dark` olha para o `<html>`), só tokens.
- **Banner:** 328 × 164 dentro da moldura, com o indicador de segmentos estático (um segmento por peça ativa da campanha, a peça editada cheia). **Card:** largura 328, foto 4:5 e corpo completos (a moldura cresce na vertical).
- **Mesmas regras do app:** o mesmo degradê (CSS `linear-gradient(to bottom, …)` com `color-mix(in srgb, var(--media-overlay) <opacidade × 100>%, transparent)` em cada parada de `mediaOverlayStops`), os mesmos tokens, fontes, cortes de linha e a regra do texto corrido que só aparece se couber. Um seletor de largura (320 · 360 · 412) mostra quando o texto sai.
- **Sem imagem:** área `bg-muted` com o texto "Envie a imagem 2:1 (mín. 960 × 480)" ou "4:5 (mín. 480 × 600)". Anunciante espaço sem imagem: a capa e a logo do espaço escolhido; no card, o card do espaço com o selo e a observação "O título e o texto não aparecem no card do espaço".
- **Acessibilidade:** cada moldura é uma `figure` com `figcaption` ("Pré-visualização no app, tema claro. Patrocinado · <anunciante>"; o selo desenhado é decorativo, então o nome dele vai na legenda); o botão da peça vira `span` (não é clicável na prévia).
- **Implementação (AD.3):** `CreativePreviewPanel` decide o modo por `matchMedia('(min-width: 1600px)')`; a largura escolhida vale para as duas molduras (em 412 elas quebram linha se não couberem lado a lado). A regra de caber do banner mede o bloco de texto e o selo depois da pintura e corta o texto e depois a segunda linha do título, como no app. No card do espaço sem imagem, esportes e preço vêm da página pública do espaço e só aparecem quando ele está na vitrine; capa, logo e bairro · cidade vêm do detalhe do Super.

### Pagamento online

Especificação da tarefa PG.1 para o web (PG.3) e o app (PG.4). Decisões 80 a 96 de `07-perguntas-em-aberto.md` (93 a 96 vieram da revisão desta especificação); regras em [`13-pagamentos-online.md`](13-pagamentos-online.md); RF-ONPAY-01 a 12 e RN-ONPAY-01 a 10 (`02-requisitos-funcionais.md`, seção 11). Mockups em [`pagamentos/`](pagamentos/README.md): [app](pagamentos/app.md), [painel](pagamentos/painel.md), [Super](pagamentos/super.md) e a tela do Pix nos dois temas ([`pix-claro-escuro.png`](pagamentos/pix-claro-escuro.png)).

#### Princípios

1. **O jogador vê o preço e nada mais.** A taxa é do espaço (decisão 82): o app nunca mostra taxa, líquido nem "acréscimo". Onde ajuda, o resumo diz "Sem taxa extra no app."
2. **Não existe saldo no app** (decisão 81). Nada de "carteira", "crédito", "saldo" ou "cashback" nas telas do jogador; o histórico se chama **Meus pagamentos** e diz, no topo, que o dinheiro vai direto para o espaço.
3. **Pix primeiro.** É o meio que o jogador prefere e o mais barato para o espaço: vem primeiro e já marcado; depois cartão; "No local" por último (só no modo opcional).
4. **Prazo sempre à vista**, em contagem (mm:ss) e em hora de relógio ("até 18:47"), porque a contagem sozinha some quando a pessoa sai para o app do banco. O servidor decide o vencimento: a contagem parte do `expiresAt` da cobrança e da diferença entre o `serverTime` da resposta e o relógio do aparelho (calculada a cada resposta), para um celular com a hora errada não mostrar prazo falso. Quando a contagem chega a zero, a tela mostra "Conferindo…" e consulta a cobrança antes de dizer que venceu (o pagamento pode ter chegado no último segundo).
5. **Status nunca só na cor:** badge com texto, ícone nos estados de tela inteira e sinal (+/−) nos valores.
6. **Dinheiro:** `tabular-nums` em todo valor; destaque em `font-display`; sinal de menos tipográfico (`−`, U+2212) com espaço fino antes do `R$` ("− R$ 4,80"). Valores vêm em centavos da API e saem por `formatCents`/`formatMoney`.
7. **Sem jargão no app e no painel do espaço.** Só o `/super` usa os termos técnicos. Glossário:

| Evite (app e painel) | Use |
|---|---|
| gateway, adquirente, processador | parceiro de pagamentos |
| subconta, KYC, onboarding | conta de recebimento, cadastro |
| split, MDR, fee | taxa de serviço |
| chargeback, disputa | contestação no cartão |
| payout, saque, settlement | repasse |
| ledger, extrato do gateway | lançamentos |
| no-show | falta |
| D+1, D+30 | "libera em 05/11" |

#### Tokens novos (`packages/ui-tokens`)

Acréscimos da PG.1 em `colors.ts` (gerados em `theme.css` e `nativewind.css`) e medidas em `paymentLayout` (`layout.ts`). O resto vem dos tokens existentes.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `sandbox` / `-foreground` | `#E07B12` / `#06202E` | `#F29A3A` / `#06202E` | Selo e faixa "Ambiente de teste" (5.6 / 7.5:1). O laranja de alerta do kit: não se confunde com o Pendente (amarelo), com o Sol da ação principal nem com o erro |
| `sandbox-border` | `#06202E` | `#F29A3A` | No claro o laranja tem 2.8:1 com o fundo: a borda Noite separa o selo (≥ 14.9:1), como no chip selecionado. No escuro é o próprio laranja (≥ 6.1:1) |
| `amount-positive` | `#146B49` | `#3CC48A` | Valor de entrada (venda, taxa devolvida) em lançamentos e no detalhe do pagamento (≥ 5.8 / 6.1:1 sobre fundo, card, popover e `muted`). Saída fica em `foreground` com o sinal de menos. Mesmo valor de `success-subtle-foreground` |
| `qr-plate` / `qr-module` | `#FFFFFF` / `#06202E` | igual | Placa e módulos do QR do Pix (16.7:1). **Iguais nos dois temas**: leitores de QR de bancos falham com QR invertido. No claro a placa ganha a borda `border` para se soltar do fundo |

Testes (`contrast.test.ts`): selo ≥ 4.5:1 e borda ≥ 3:1 sobre fundo, card, popover e `muted`; `amount-positive` ≥ 4.5:1 nas mesmas superfícies; QR ≥ 7:1, placa mais clara que os módulos e igual nos dois temas; o selo diferente de `warning-subtle`, `primary`, `secondary` e `chip-selected` e fora da escala Sol. Todos também nos valores HSL do mobile.

`paymentLayout`:

| Medida | Valor | Onde |
|---|---|---|
| `methodOption` | altura mín. 64, ícone 24, 8 entre cartões | Cartões de opção da etapa "Pagamento" (app) |
| `qr` | QR 216, folga 16 (placa 248), raio 16 | Tela do Pix |
| `sandboxBadge` | altura mín. 24, padding 10, ícone 14 | Selo "Ambiente de teste" (app e web) |
| `copiedFeedbackMs` | 2000 | "Copiado!" no botão do copia e cola |
| `pollIntervalMs` | 5000 | Consulta da cobrança com a tela do Pix (ou do cartão processando) em foco |
| `countdownUrgentMs` | reserva 3 min · mensalidade 1 h | Abaixo disso a contagem vira alerta |
| `releaseBar` | altura 8, raio 4, até 7 linhas | "A liberar por data" na carteira |

#### Status, rótulos e tons

Badges pela receita de [Chips e badges](#chips-e-badges) (texto sempre; tom pelo significado). Um rótulo por status, o mesmo no app e no painel. No web, num `lib/painel/labels.ts`; no app, em `features/payments/labels.ts`.

**Cobrança online** (`online_charges.status`):

| Status | Rótulo | Tom | Ícone (estado de tela) | Observação |
|---|---|---|---|---|
| `PENDING` | Aguardando pagamento | `warning` | `Clock` | |
| `PAID` | Pago | `success` | `CircleCheck` | No painel, a linha diz "Pix · pago em 08/11 18:42" |
| `EXPIRED` | Vencido | `muted` | `TimerOff` | Nada foi cobrado |
| `FAILED` | Recusado | `destructive` | `CircleX` | Cartão não autorizado |
| `CANCELLED` | Cancelado | `muted` | `Ban` | Cobrança trocada por outra ou item cancelado antes de pagar |
| `PARTIALLY_REFUNDED` | Estorno parcial | `info` | `Undo2` | |
| `REFUNDED` | Estornado | `info` | `Undo2` | |
| `CHARGEBACK` | Contestado no cartão | `destructive` | `ShieldAlert` | |

**Reserva:** `PENDING_PAYMENT` → "Aguardando pagamento" (`warning`). `CANCELLED` com motivo `PAYMENT_EXPIRED` → badge "Cancelada" (`destructive`) e o motivo "Pagamento não feito no prazo". A situação de pagamento da reserva (`BookingPaymentStatus`) não muda: "Pagamento pendente" / "Pago" continuam valendo para o pagamento no local e para o online.

**Cadastro do espaço** (`merchant_accounts.status`): `NOT_STARTED` "Não iniciado" (`muted`) · `PENDING` "Em análise" (`warning`) · `APPROVED` "Aprovado" (`success`) · `REJECTED` "Recusado" (`destructive`).

**Repasse** (`payouts.status`): `SCHEDULED` "Agendado" (`info`) · `PAID` "Repassado" (`success`) · `FAILED` "Falhou" (`destructive`).

**Contestação** (`dispute.status` da API, com `respondBy`, `responseText`, `attachmentUrls` e `resolvedAt`): `AWAITING_RESPONSE` "Aguardando resposta" (`warning`) · `RESPONDED` "Resposta enviada" (`info`) · `WON` "Ganha" (`success`) · `LOST` "Perdida" (`destructive`).

**Lançamento** (`space_ledger_entries.kind`), sem badge, com o sinal no valor:

| Tipo | Rótulo | Sinal |
|---|---|---|
| `SALE` | Venda | + (`amount-positive`) |
| `PLATFORM_FEE` | Taxa de serviço | − |
| `REFUND` | Estorno ao cliente | − |
| `FEE_REFUND` | Taxa devolvida | + (`amount-positive`) |
| `CHARGEBACK` | Contestação no cartão | − |
| `PAYOUT` | Repasse | − |
| `ADJUSTMENT` | Ajuste | o da API |

**Modos:** reservas `ON_SITE` "Só no local" · `ONLINE_OPTIONAL` "No local ou online" · `ONLINE_REQUIRED` "Online obrigatório"; aulas `ON_SITE` "Só no local" · `ONLINE_OPTIONAL` "No local ou online". **Meios:** `PIX` "Pix" · `CARD` "Cartão de crédito" (curto: "Cartão"; com final: "Cartão final 1111") · no local "No local".

#### Selo "Ambiente de teste"

Aparece **só** quando a API indica o gateway fake. A API expõe o **ambiente de pagamento** (provedor `fake`, `none` ou real) e, com o fake, os **cartões de teste** (rótulo, número e resultado esperado, com validade, nome e código para preencher) e a **dica do documento que força a recusa** do cadastro. As telas mostram o que vier da API e não têm número de cartão, final de documento nem ambiente fixo no código.

- **Forma:** pílula `rounded-full`, altura mínima 24 (cresce com a fonte), padding 10, borda 1 `border-sandbox-border`, fundo `bg-sandbox`; ícone `FlaskConical` de 14 e o texto "Ambiente de teste" em 12/16 600 `text-sandbox-foreground`, 6 entre eles. Nunca interativo.
- **Onde, no app:** à direita do título "Como você quer pagar?" na etapa de pagamento; no `ScreenHeader` das telas do Pix, do cartão e do comprovante (no comprovante: "Comprovante de teste, sem valor"). Acessibilidade: o selo é lido como "Ambiente de teste: nenhum valor é cobrado de verdade".
- **Onde, no web:** faixa (`Alert` com as cores do selo, ícone 20) no topo do cadastro da conta de recebimento e da carteira ("Ambiente de teste: os valores são simulados."); no `/super`, a faixa do simulador e o selo na barra superior, ao lado de "Painel da plataforma".

---

#### Pagamento online desligado (`PAYMENTS_PROVIDER=none`)

Com o provedor `none` (RN-ONPAY-09), os modos voltam a `ON_SITE` na leitura e nenhuma cobrança nova é criada.
- **App:** nada a mostrar: a etapa de pagamento some (modo `ON_SITE`) e "Meus pagamentos" continua com o histórico. Um "Pagar" que encontrar o online desligado (tela aberta antes da mudança) mostra "O pagamento pelo app está indisponível agora. Pague no espaço." e volta.
- **Painel** (Recebimentos online): `Alert` `info` no topo, "O pagamento pelo app está desligado na plataforma. Reservas e mensalidades seguem pagas no local." O card da conta de recebimento fica só leitura (sem "Começar cadastro", "Corrigir e reenviar" nem "Trocar conta bancária"), as formas de pagamento ficam bloqueadas em "Só no local" e a carteira, os lançamentos e as contestações continuam visíveis para consulta. "Estornar" e "Responder" ficam desabilitados com a dica "Indisponível com o pagamento online desligado".
- **Super** (Pagamento online): `Alert` `info` no topo, "Pagamento online desligado (`PAYMENTS_PROVIDER=none`). Nenhuma cobrança nova é criada; o histórico continua aqui." As taxas continuam editáveis, a receita mostra o histórico e a aba Simulador não aparece.

#### App — (1) Etapa "Pagamento" do fluxo de reserva (RF-ONPAY-03)

A etapa entra em `espaco/[slug]/reservar.tsx` no lugar do passo "Como você vai pagar no espaço?" quando o modo de reservas do espaço não é `ON_SITE` e o serviço aceita pagamento online (a API informa os meios por serviço). Em `ON_SITE` nada muda.

- **Título** "Como você quer pagar?" (o `Step` atual) com o selo de teste à direita, se houver.
- **Opções** (componente `PaymentMethodOptions`, reaproveitado na folha "Pagar" do detalhe e da mensalidade): `radiogroup` de cartões de largura toda, um por meio disponível, 8 entre eles.
  - Cartão: altura mín. 64, `rounded-lg` (16), borda 1.5 `border-border`, fundo `bg-card`, padding 12/16; rádio de 20 à esquerda, ícone de 24 (`QrCode` Pix, `CreditCard` cartão, `Store` no local) em `foreground`, título 16/600 e descrição 14/20 `muted-foreground`. Selecionado: borda `chip-selected-border`, fundo `bg-accent` e `Check` de 20 à direita (a mesma receita do `OptionCards` da web: não depende só da cor). Pressionado: `active:bg-accent`. Alvo: o cartão inteiro.
  - Textos: **Pix** "Aprovação na hora"; **Cartão de crédito** "À vista"; **No local** "Pague no espaço no dia do jogo".
  - "No local" marcado abre, dentro do próprio cartão, os chips da forma pretendida que já existem (`acceptedPaymentMethods`), com o texto "Só para o espaço se preparar." Sem formas cadastradas, o cartão fica só com o título e a descrição.
  - **Pré-seleção:** Pix (ou o único meio, se só houver um).
- **`ONLINE_REQUIRED`:** sem "No local"; acima das opções, um bloco `info-subtle` (raio 12, padding 12, `Info` 16): "Este espaço pede o pagamento na reserva. O horário fica guardado por 15 min enquanto você paga."
- **Resumo** (card atual): o total continua o preço da reserva. Com Pix ou cartão marcado, entram duas linhas 14/20 `muted-foreground`: "Sem taxa extra no app." e, no lugar de "Cancelamento sem custo até…", "Cancelando até 2 h antes, o valor volta inteiro para você." (prazo do espaço, por `formatDuration`).
- **Botão** (48, largura toda): Pix "Pagar com Pix" · cartão "Pagar com cartão" · no local "Confirmar reserva"; em `ONLINE_REQUIRED`, "Reservar e pagar com Pix" / "Reservar e pagar com cartão". Carregando: "Reservando…".
- **Depois:**
  - **Pix:** cria a reserva com a forma escolhida e troca a tela (`router.replace`) pela pilha `reserva/[id]` → tela do Pix, para o voltar do Pix cair no detalhe da reserva, nunca no formulário.
  - **Cartão:** abre a tela do cartão (3). No **primeiro envio** do formulário a reserva é criada junto com o token; aprovado ou recusado, o app troca a pilha para `reserva/[id]` → tela do cartão, e toda nova tentativa vai para a cobrança dessa reserva, nunca para uma reserva nova (decisão 96; ver [Tentativas e troca de meio](#app--tentativas-troca-de-meio-e-cobranças-concorrentes-decisão-96)).
  - **No local:** como hoje.
- **Erros:** horário tomado entre a escolha e o envio segue o `notice` atual. Espaço que desligou o online no meio do caminho: "Este espaço não aceita mais pagamento pelo app. Escolha outra forma." e as opções recarregam.

#### App — (2) Tela do Pix (RF-ONPAY-03 e 05)

Uma tela para reserva e mensalidade (rotas sugeridas `pagamento/reserva/[id]` e `pagamento/mensalidade/[id]`), título "Pagar com Pix". De cima para baixo, `px-4`, numa `ScrollView`:

1. **Valor:** overline "Valor"; `R$ 120,00` em `font-display` 700 36/40; abaixo, 14/20 `muted-foreground`, o item ("Reserva · <espaço>" + "Sáb, 08/11 · 18:00–19:30", ou "Mensalidade de nov 2026 · <plano>").
2. **Prazo** (16 abaixo), card `rounded-lg border bg-card p-4`, `Clock` 20 e duas linhas:
   - **Reserva obrigatória:** "Pague em 14:32" (`font-display` 600 24/32, `tabular-nums`) e "Horário guardado até 18:47".
   - **Reserva opcional:** uma linha só, "Pix válido até 18:47" (14/20 `muted-foreground`, sem card).
   - **Mensalidade (24 h):** "Faltam 23 h 41 min" e "Válido até amanhã, 10:15"; abaixo de 1 h, em mm:ss.
   - **Urgente** (abaixo de `countdownUrgentMs`): o card vira `bg-warning-subtle border-warning-subtle-border`, ícone `AlarmClock` e textos `text-warning-subtle-foreground`; a segunda linha vira "O horário é liberado às 18:47" (reserva) ou "Gere outro depois, se precisar" (mensalidade).
3. **Copia e cola** (16 abaixo): overline "Pix copia e cola"; o código em fonte mono 14/20 `muted-foreground`, uma linha com corte no meio (começo e fim visíveis); 8 abaixo, o **botão primário** de 48 "Copiar código Pix" com `Copy` 20. Ao tocar: `expo-clipboard`, o botão vira "Copiado!" com `Check` por 2 s (`copiedFeedbackMs`), vibração leve (`expo-haptics`, se instalado) e `announceForAccessibility("Código Pix copiado")`. O botão vem antes do QR porque, quase sempre, quem paga está no mesmo celular.
4. **Passos** (8 abaixo), 14/20 `muted-foreground`: "1. Copie o código" · "2. No app do banco, escolha Pix copia e cola" · "3. Volte aqui: a confirmação aparece sozinha".
5. **QR** (24 abaixo): "Ou leia o QR code em outro celular" (14/500, centralizado); 8 abaixo, a placa `bg-qr-plate`, `rounded-lg`, borda 1 `border-border`, 248 × 248, com o QR de 216 centralizado. O SVG vem da API: a PG.2 desenha os módulos com `currentColor` (ou sem `fill`) para o app pintar em `qr-module`; se um gateway real mandar PNG, o app o mostra sobre a placa sem recolorir. Rótulo: "QR code do Pix de R$ 120,00".
6. **Aguardando** (16 abaixo): spinner de 16 `muted-foreground` + "Aguardando o pagamento…" 14/20, centralizado, região viva (`accessibilityLiveRegion="polite"`).
7. **Ação secundária** (8 abaixo): `ghost` "Pagar com cartão" (cria outra cobrança, que cancela a do Pix: RN-ONPAY-03; antes, a verificação de [troca de meio](#app--tentativas-troca-de-meio-e-cobranças-concorrentes-decisão-96)). Na reserva opcional, acima dele: "Prefere pagar no espaço? Pode sair: sua reserva já está confirmada."

**Atualização do status:** consulta a cobrança a cada 5 s com a tela em foco (`useIsFocused`), consulta na hora ao voltar ao app (`AppState` → `active`, a volta do app do banco) e reage ao push "Pagamento confirmado". Sem rede: segue tentando e, depois de duas falhas seguidas, troca o texto por "Sem conexão. Tentando de novo…".

**Estados** (os de tela inteira centralizam: círculo de 96 com o ícone de 48, título `h3` 24/32, texto 16/24 `muted-foreground` com até 3 linhas, 32 e os botões de 48 empilhados com 12 entre eles):

| Estado | Círculo / ícone | Título | Texto | Botões |
|---|---|---|---|---|
| Gerando | — | — | `Skeleton` da placa (248, `rounded-lg`) e "Gerando o Pix…" no lugar do aguardando | — |
| Aguardando | — | (a tela acima) | | |
| Conferindo (contagem em zero) | — | — | Contagem trocada por "Conferindo…" com spinner | — |
| Confirmado | `success-subtle` / `CircleCheck` `success-subtle-foreground` | Pagamento confirmado | "R$ 120,00 · Pix · 18:42" e "Sua reserva está confirmada." (mensalidade: "Mensalidade de nov 2026 paga.") | Primário "Ver reserva" (ou "Voltar ao plano") · contorno "Ver comprovante" |
| Vencido, reserva obrigatória | `muted` / `TimerOff` `muted-foreground` | O prazo para pagar acabou | "A reserva foi cancelada e o horário liberado. Se ainda estiver livre, você pode reservar de novo." | "Reservar de novo" (abre `reservar` do espaço) · contorno "Voltar" |
| Vencido, reserva opcional | igual | Este Pix venceu | "Sua reserva continua confirmada. Gere outro Pix ou pague no espaço." | "Gerar novo Pix" · contorno "Voltar para a reserva" |
| Vencido, mensalidade | igual | Este Pix venceu | "Gere outro quando quiser pagar." | "Gerar novo Pix" · contorno "Voltar ao plano" |
| Pago e estornado sozinho (RN-ONPAY-02, decisão 96), no Pix e no cartão | `info-subtle` / `Undo2` `info-subtle-foreground` | O pagamento chegou depois do prazo | Reserva cancelada (prazo vencido ou desistência): "A reserva já tinha sido cancelada. Os R$ 120,00 voltam para o mesmo Pix." (ou "cartão"). Cobrança trocada ou vencida: título "Este pagamento chegou atrasado" e "Você já tinha trocado de forma de pagamento (ou o Pix tinha vencido). Os R$ 120,00 voltam para o mesmo Pix." | Contorno "Ver comprovante" |
| Erro ao gerar | `destructive-subtle` / `CircleAlert` `destructive-subtle-foreground` | Não conseguimos gerar o Pix | "Confira a internet e tente de novo." (erro conhecido da API: a mensagem dela) | "Tentar de novo" |

Ao confirmar: vibração de sucesso e `announceForAccessibility("Pagamento confirmado")`. Os estados finais trocam o título do cabeçalho por "Pagamento".

**Sair e voltar:** sair não cancela nada. A cobrança fica aberta até vencer, e a reserva aparece em "Minhas reservas" como "Aguardando pagamento" com o botão de pagar (4). Voltar pelo botão "Pagar" (ou pela notificação) busca a cobrança aberta do item: `PENDING` e no prazo → a mesma tela com o **mesmo código** (nada de gerar outro); vencida → o estado "Vencido" correspondente; paga → "Confirmado". **Acessibilidade da contagem:** o texto visível muda a cada segundo, mas o rótulo de acessibilidade muda só a cada minuto ("Faltam 14 minutos para pagar"), e há anúncio aos 5 min e a 1 min. Com fonte grande, o QR desce e o botão de copiar continua sem rolar em 360 dp.

#### App — (3) Cartão de crédito (RF-ONPAY-03, RN-ONPAY-10)

Tela "Pagar com cartão", com o mesmo bloco de valor da tela do Pix e, na reserva obrigatória, a linha de prazo (`Clock` 16 + "Horário guardado por mais 12:41", 14/500, urgente igual ao Pix). Formulário pela [Anatomia de campo](#anatomia-de-campo) do app (48 de altura, 16 entre campos):

| Campo | Máscara e teclado | Autofill | Dica | Erro (ao sair do campo e ao enviar) |
|---|---|---|---|---|
| Número do cartão | grupos de 4 (`0000 0000 0000 0000`; 15 dígitos em 4-6-5), `number-pad`, até 19 dígitos | `cc-number` / `creditCardNumber` | — | "Confira o número do cartão" (Luhn ou tamanho) |
| Nome impresso no cartão | caixa alta, `autoCapitalize="characters"` | `cc-name` / `name` | — | "Informe o nome como está no cartão" |
| Validade | `MM/AA`, `number-pad` | `cc-exp` | "MM/AA" | "Confira a validade" · "Este cartão está vencido" |
| Código de segurança | 3 ou 4 dígitos, `number-pad`, sem `secureTextEntry` | `cc-csc` | "3 dígitos no verso" | "Informe o código de segurança" |

Validade e código lado a lado (duas colunas, 12 entre elas); o resto em largura toda. Abaixo, 16, a linha `Lock` 16 + "O Space Sports não guarda seu cartão." (14/20 `muted-foreground`) e o botão primário "Pagar R$ 120,00"; depois, `ghost` "Pagar com Pix".

- **Nada de salvar cartão:** sem caixa "lembrar", nada em `SecureStore`/estado global; o formulário é limpo ao sair da tela. O app só gera o token (no fake, o token de teste da PG.2) e manda o token.
- **Cartões de teste** (só com o fake): card `bg-muted rounded-lg p-3` acima do formulário, com o selo de teste e um chip por cartão que a API devolve no ambiente de pagamento (o rótulo da API, ex.: "Aprova", "Recusa", "Aprova e contesta"); o toque preenche número, nome, validade e código com os dados da API. Nada fixo na tela.
- **Processando:** campos desabilitados, botão desabilitado com spinner e "Processando…", voltar ignorado até a resposta. A chave de idempotência evita cobrança dupla.
- **Recusado:** `Alert` `destructive` no topo do formulário (`role="alert"`, foco nele): "Cartão recusado" + "O banco não autorizou. Confira os dados ou use outro cartão." (motivo conhecido da API, se houver, no lugar da segunda frase). Na **reserva opcional**, a segunda frase vira "Sua reserva está confirmada: tente outro cartão, pague com Pix ou no espaço."; na mensalidade, "Tente outro cartão ou pague com Pix." O código de segurança é limpo; o resto fica. Nova tentativa enquanto houver prazo, na cobrança da mesma reserva; sem prazo, o estado "Vencido" do Pix.
- **Sem resposta (rede caiu depois do envio):** nunca deixe tentar de novo às cegas. A tela mostra "Conferindo o pagamento…" e consulta a cobrança; sem cobrança criada, volta ao formulário com "Não conseguimos falar com o banco. Tente de novo." (`Alert` `destructive`).
- **Aprovado:** a tela de "Confirmado" do Pix com o título "Pagamento aprovado" e "R$ 120,00 · Cartão final 1111 · 18:42".

#### App — tentativas, troca de meio e cobranças concorrentes (decisão 96)

- **`Idempotency-Key` por tentativa:** um UUID novo a cada toque que cria algo ("Reservar e pagar…", "Pagar R$ 120,00", "Gerar novo Pix", "Pagar com cartão/Pix" depois da verificação), enviado na criação da reserva e na criação da cobrança. As repetições automáticas da **mesma** tentativa (queda de rede, timeout) reaproveitam a chave; um novo toque gera outra.
- **Depois do primeiro envio**, Pix ou cartão, aprovado ou recusado, o app está sempre na pilha `reserva/[id]` → tela de pagamento. As novas tentativas usam a cobrança dessa reserva (criar ou consultar a cobrança da reserva), nunca o formulário de reservar de novo.
- **Antes de trocar de meio ou gerar novo Pix**, o app consulta a cobrança aberta do item:
  - `PAID` → vai direto para o estado "Confirmado";
  - `PENDING` → diálogo (`Alert` nativo) **"Já pagou? Aguarde a confirmação"**: "Se você já pagou este Pix, a confirmação chega em alguns segundos. Trocar agora cancela este código." Botões "Aguardar" (volta à tela e consulta de novo) e "Trocar mesmo assim". Se a API recusar a troca porque a cobrança anterior acabou de ser paga, a tela mostra "Confirmado" (vale a paga);
  - `EXPIRED`, `FAILED` ou `CANCELLED` → segue sem perguntar.
- **Pagamento que chega numa cobrança trocada ou vencida, ou para reserva já cancelada**, é estornado sozinho pela API (integral). A tela de pagamento, se estiver aberta, mostra o estado "Pago e estornado sozinho"; em "Meus pagamentos" ele aparece como "Estornado" com o motivo "Estorno automático: o pagamento chegou depois do prazo" (ou "depois da troca da forma de pagamento").

#### App — (4) Reserva aguardando pagamento (RF-ONPAY-04)

**Lista "Minhas reservas":** as reservas `PENDING_PAYMENT` ficam numa seção própria no topo, "Aguardando pagamento" (overline). O `BookingCard` ganha:
- o badge "Aguardando pagamento";
- abaixo da linha de data e preço, `AlarmClock` 16 + "Pague até 18:47" (14/500 `text-warning-subtle-foreground`);
- separador `border-t border-border` e o botão primário "Pagar agora" (44, largura toda), que abre o pagamento direto (folha de meios ou a cobrança aberta). O card continua abrindo o detalhe; o botão tem alvo próprio.
- Rótulo: "<esporte> em <espaço>, <quando>, Aguardando pagamento, pague até 18:47".

Cancelada por falta de pagamento: badge "Cancelada" e, abaixo da data, "Pagamento não feito no prazo" (14/20 `muted-foreground`). Vai para o histórico como as outras canceladas.

**Detalhe (`reserva/[id]`):**
- **Aguardando:** no topo, no lugar do card "Reserva confirmada!", um card `bg-warning-subtle border-warning-subtle-border`: "Falta pagar para confirmar" (18/28 600 `foreground`), "O horário fica guardado até 18:47." e `Clock` + "Faltam 12:41" (`text-warning-subtle-foreground`, `tabular-nums`), e o botão primário "Pagar R$ 120,00". "Pagar" abre a cobrança Pix aberta se ela estiver no prazo; se não houver, a folha "Como você quer pagar?" (`BottomSheet` com o `PaymentMethodOptions`, sem "No local") e depois a tela do meio. Edição e convites ficam escondidos até pagar (a reserva pode sumir em 15 min). No lugar de "Cancelar reserva", o botão de contorno `destructive` **"Desistir da reserva"** (decisão 96), com o `Alert` "Desistir da reserva?" / "O horário é liberado e o código Pix deixa de valer. Se você já pagou, o valor volta sozinho." ("Voltar" e "Desistir"). Depois, o detalhe mostra a reserva cancelada com "Você desistiu antes de pagar.".
- **Cancelada por falta de pagamento:** o card "Reserva cancelada" diz "O pagamento não foi feito até 18:47 e o horário foi liberado." com o botão de contorno "Reservar de novo".
- **Bloco "Pagamento"** (o card atual, com "Total da reserva" e "Sua parte"), conforme a cobrança online mais recente:

| Situação | O que muda no bloco |
|---|---|
| Pago online | Badge "Pago"; linha "Pago com Pix em 08/11 às 18:42" (ou "com cartão final 1111"); `ghost` "Ver comprovante" |
| Opcional, sem pagar | Badge "Pagamento pendente"; contorno "Pagar online" e "Ou pague no espaço no dia do jogo." (só para o organizador, enquanto a reserva não começou) |
| Estornado | Badge "Estornado"; "R$ 120,00 devolvidos em 09/11 para o seu Pix." (ou "cartão. Pode aparecer na fatura seguinte."); "Ver comprovante" |
| Estorno parcial | Badge "Estorno parcial"; linhas "Pago com Pix · R$ 120,00" e "Devolvido em 09/11 · − R$ 40,00", o motivo entre aspas (14/20 `muted-foreground`) e "Ver comprovante". Com abatimento (o padrão da decisão 93), a reserva segue paga e nada mais aparece; se o espaço escolheu cobrar de novo, entra a linha "Falta pagar R$ 40,00 no espaço" (14/500) |
| Contestado no cartão | Badge "Contestado no cartão"; "Este pagamento foi contestado com o banco do cartão. A reserva voltou a constar como não paga." |

- **Cancelar reserva paga online** (organizador, dentro do prazo): o `Alert` de confirmação acrescenta "Os R$ 120,00 voltam para o seu Pix." (ou cartão). Fora do prazo nada muda: o botão já fica bloqueado.
- Convidado não vê o bloco de pagamento online (só o organizador paga: RN-ONPAY-03).

#### App — (5) "Pagar agora" na mensalidade (RF-ONPAY-05)

Em `ChargesList` (Meu plano), quando o modo de aulas do espaço é `ONLINE_OPTIONAL` e a mensalidade está `PENDING` ou `OVERDUE`:
- abaixo da linha da mensalidade, botão de **contorno** de 44, largura toda, "Pagar R$ 180,00" (o saldo em aberto: com pagamento parcial, "Pagar R$ 80,00"). Abre a folha "Como você quer pagar?" (Pix, cartão) e a tela do meio. O Pix vale 24 h.
- com um Pix aberto e válido, o botão vira "Continuar pagamento" e, abaixo, "Pix gerado · vale até amanhã, 10:15" (14/20 `muted-foreground`).
- paga online, a linha mostra o badge "Paga" e "Paga com Pix em 05/11" no lugar do vencimento.
- rótulo do botão: "Pagar a mensalidade de nov 2026, R$ 180,00".

#### App — (6) Meus pagamentos (RF-ONPAY-06)

Perfil → novo `MenuRow` "Meus pagamentos" (`Receipt`), entre "Meus planos de aula" e "Preferências de notificação". Rota `(conta)/meus-pagamentos`.

- **Topo:** `Info` 16 + "Pagamentos feitos pelo app. O dinheiro vai direto para o espaço: não existe saldo no Space Sports." (14/20 `muted-foreground`). Depois, 12, chips de filtro de escolha única (`Chip`, tocar de novo volta a "Todos"): **Todos** · **Pagos** (`PAID`, `PARTIALLY_REFUNDED`) · **Estornos** (`PARTIALLY_REFUNDED`, `REFUNDED`) · **Aguardando** (`PENDING`). O filtro vai para a API.
- **Lista** (`FlashList`, paginada pela API, "Carregando mais…" no rodapé): grupos por mês com overline "Novembro de 2026"; cada grupo num card `rounded-lg border bg-card` com linhas separadas por `border-border`. Linha (mín. 64, padding 12/16): círculo de 40 `bg-muted` com o ícone do meio (20, `muted-foreground`); título 16/500 de 1 linha ("Reserva · Arena Beira-Mar", "Mensalidade nov · Escola Areia"); abaixo, 14/20 `muted-foreground`, "Sáb, 08/11 · Pix"; à direita, o valor 16/600 `tabular-nums` e o badge abaixo dele. Rótulo: "<título>, R$ 120,00, <status>, <data>". Toque abre o detalhe.
- **Vazio:** `Receipt` 40 `muted-foreground`, "Nenhum pagamento pelo app ainda" e "Quando você pagar uma reserva ou mensalidade com Pix ou cartão, ela aparece aqui." Com filtro: "Nada com este filtro" + `ghost` "Ver todos". **Carregando:** 4 linhas `Skeleton` de 64. **Erro:** `ErrorView` com "Tentar de novo".
- **Comprovante** (`(conta)/meus-pagamentos/[id]`, título "Comprovante"):
  - Topo: valor `font-display` 36/40 e o badge à direita; "Pago em 08/11/2026 às 18:42" (ou "Aguardando pagamento até 18:47", "Recusado em…").
  - Linhas rótulo/valor (rótulo 14/20 `muted-foreground` à esquerda, valor 14/20 `foreground` à direita, 8 entre linhas, divisória antes e depois): Serviço · Quando (reserva) ou Competência (mensalidade) · **Recebido por** <espaço> · Pago por · Forma ("Pix", "Cartão de crédito final 1111") · Transação (código curto com `Copy` 16; copia o completo).
  - **Estornos** (overline), um por estorno: data e "− R$ 40,00" na mesma linha, o motivo entre aspas (nos automáticos, "Estorno automático: …", ver decisão 96) e "Volta para o mesmo Pix." ou "No cartão, pode aparecer na fatura seguinte."
  - Ações: contorno "Compartilhar comprovante" (`Share` do sistema com o texto do comprovante; sem PDF nesta etapa) e `ghost` "Ver reserva"/"Ver plano". Pendente no prazo: primário "Continuar pagamento".
  - Fake: selo no cabeçalho e, abaixo do valor, "Comprovante de teste, sem valor".

#### App — notificações

Textos sugeridos para a PG.2 (a API é dona do texto); o toque abre a tela indicada (PG.4).

| Evento | Título | Texto | Abre |
|---|---|---|---|
| Pagamento confirmado | Pagamento confirmado | Sua reserva em <espaço> em 08/11 às 18:00 está paga. | Detalhe da reserva (ou o plano) |
| Pix vencido (opcional/mensalidade) | O Pix venceu | Gere outro quando quiser pagar. | Detalhe / plano |
| Reserva cancelada por falta de pagamento | Reserva cancelada | O pagamento não foi feito a tempo e o horário foi liberado. | Detalhe da reserva |
| Estorno | Estorno de R$ 40,00 | <espaço> devolveu R$ 40,00 do pagamento de 08/11. | Comprovante |
| Estorno automático (decisão 96) | Pagamento devolvido | O pagamento de R$ 120,00 chegou depois do prazo e volta para o mesmo Pix. | Comprovante |

Nos textos, o nome do espaço entra **sem artigo** ("em Arena Beira-Mar", "Arena Beira-Mar devolveu"): o app não sabe o gênero do nome.


#### Implementação no app (PG.4)

O que a PG.4 entregou (com a revisão) e onde ficou diferente desta especificação por causa do contrato. Código em `apps/mobile/src/features/payments/`.
- **Rotas:** a tela de pagamento fica na pilha do item, para o voltar e o "Ver reserva"/"Voltar ao plano" caírem nele: `reserva/pagar/[id]` e `planos/pagar/[id]?plano=<assinatura>` (no lugar de `pagamento/reserva/[id]` e `pagamento/mensalidade/[id]`), com `?forma=pix|cartao`. Meus pagamentos em `(conta)/meus-pagamentos` e o comprovante em `(conta)/meus-pagamentos/[id]`.
- **Cartão no formulário de reservar:** a etapa do cartão abre dentro de `espaco/[slug]/reservar`, porque a reserva só nasce junto com o token; o primeiro envio cria a reserva e troca a pilha para `reserva/[id]` → `reserva/pagar/[id]`.
- **Cartão só com tokenizador:** o app gera o token só com o tokenizador de teste (`paymentEnvironment.sandbox`, `fakeCardToken` de `packages/shared`). Sem ele (gateway real ainda sem o SDK do provedor no app, ou pagamento online desligado), o cartão **não aparece** nas opções da etapa, da folha "Pagar" nem na tela do Pix; quem chega na tela do cartão por um link antigo vê "O pagamento com cartão não está disponível no app agora" e o botão do Pix.
- **`Idempotency-Key` ligada ao pedido** (na criação da reserva): a mesma chave enquanto o corpo for o mesmo; horário, quadra, duração, pessoas ou forma diferentes geram outra, e trocar o horário (ou a data, a duração, o esporte) a zera. Resposta definitiva (erro do domínio) também zera. Sem resposta (rede, 5xx sem código), as repetições automáticas usam a mesma chave e o formulário mostra "Não tivemos resposta. A reserva pode ter sido criada…" com o contorno **"Tentar de novo"**, que reenvia o mesmo pedido com a mesma chave. 422 `IDEMPOTENCY_KEY_REUSED`: "Este pedido mudou depois de uma tentativa sem resposta. Confira em Minhas reservas antes de tentar de novo." Como na API, o token do cartão não entra na comparação: trocar de cartão depois de ficar sem resposta reaproveita a chave (não cria outra reserva). Na cobrança (Pix ou cartão), uma chave nova a cada toque.
- **Sem resposta na cobrança:** a conferência compara com o id da cobrança que existia **antes** da tentativa; só uma cobrança diferente conta como criada.
- **Estados finais:** a tela nunca fica em "Gerando o Pix…" sem fim. Mensalidade paga, dispensada ou sem saldo (e a reserva quitada) mostra **"Nada a pagar"** (`CircleCheck`, `muted`); `ALREADY_PAID` leva ao confirmado (se a cobrança estiver paga) ou a "Nada a pagar"; o Pix cancelado depois de gerado (por exemplo, pela troca de meio em outro aparelho) mostra "Este Pix não vale mais" (`Ban`, `muted`) com "Gerar novo Pix"; a tentativa de cartão cancelada ou vencida sem cobrar mostra no formulário "O pagamento não foi concluído e nada foi cobrado. Tente de novo."
- **Aviso do modo obrigatório:** "O horário fica guardado por N min enquanto você paga", com N = `min(início, agora + 15 min)` no relógio do servidor ("9 min (até o início)" quando o jogo começa antes).
- **"Pagar online"** no detalhe: só na reserva feita pelo app (`source = APP`; balcão e mensalista seguem pagos no local), confirmada, do organizador, com saldo em aberto e antes do início no relógio do servidor. Com Pix aberto, o botão vira "Continuar pagamento" e a linha "Pix gerado · vale até 18:47".
- **Relógio:** a diferença servidor − aparelho vem do `serverTime` da resposta que trouxe o prazo e da hora em que ela chegou: o da reserva para o hold (detalhe, lista "Pague até", "Pagar online" e a tela do Pix na reserva obrigatória) e o da cobrança para o Pix opcional e a mensalidade.
- **Copia e cola:** fonte pelo token `fontFamily.mono` de `packages/ui-tokens` (Menlo no iOS, `monospace` no Android).
- **Comprovante:** "Pago por" vem do `payerName` da API. A data do estorno no bloco "Pagamento" da reserva vem de `GET /v1/me/payments/:id`. Na lista de Meus pagamentos, a cobrança com estorno automático ou de cancelamento ganha a linha do motivo ("Estorno automático: o pagamento chegou depois do prazo"); o motivo do estorno manual fica só no comprovante.
- **Pago e estornado sozinho (decisão 96):** o estado sai do `reasonCode` do estorno, lido do comprovante da cobrança: `PAID_AFTER_DEADLINE` com a reserva cancelada, "O pagamento chegou depois do prazo" / "A reserva já tinha sido cancelada."; sem a reserva cancelada, "Este pagamento chegou atrasado" / "O prazo para pagar já tinha acabado."; `PAID_AFTER_METHOD_CHANGE`, "Você já tinha trocado de forma de pagamento."; `ITEM_ALREADY_PAID`, "Este item já estava pago." A cobrança estornada por outro motivo (cancelamento, manual) mostra "Pagamento estornado" com "Ver comprovante".
- **Mensalidade paga:** "Paga com Pix em 05/11" (ou "com cartão") pelo último pagamento; com `channel = ONLINE`, o link "Ver comprovante".
- **Notificações:** o estorno (`refundId` nos dados) abre o comprovante; pagamento confirmado e Pix vencido abrem a reserva ou o plano e atualizam a tela do Pix na hora. Os avisos da gestão (contestação, cadastro, troca de conta, inclusive `MERCHANT_PAYOUT_CHANGE_REJECTED`, e repasse) só aparecem nas preferências de Dono e Admin.

---

#### Painel — (7) Recebimentos online (RF-ONPAY-01 e 02)

Novo item **"Recebimentos online"** (`CreditCard`) no grupo Gestão, logo abaixo de "Recebimentos", em `/painel/recebimentos-online`. Dono e Admin; Professor não vê o item e, pela URL, recebe o estado de sem permissão de hoje. Cabeçalho: "Recebimentos online" e "Pix e cartão pelo app, com o dinheiro direto na conta do espaço."

- **Antes do cadastro aprovado**, a página não tem abas: três cards empilhados (largura máx. 880, 24 entre eles) — Conta de recebimento, Formas de pagamento no app (bloqueado) e Taxa de serviço.
- **Depois de aprovado**, abas com trilho: **Carteira** (padrão) · **Contestações** (com o número das abertas, "Contestações 1") · **Configuração** (os três cards). A aba fica na URL (`?aba=carteira|contestacoes|configuracao`).

**Card "Conta de recebimento"** (`CardHeader` com o título e o badge do status à direita):

| Status | Conteúdo | Ação |
|---|---|---|
| `NOT_STARTED` | "Para receber pelo app, o espaço precisa de uma conta no nosso parceiro de pagamentos. As vendas caem nela e são repassadas todo dia para a conta bancária do espaço." e a lista "Você vai precisar de: CPF ou CNPJ e os dados de quem responde pelo espaço · Endereço · Conta bancária ou chave Pix no mesmo CPF/CNPJ" | Dono: primário "Começar cadastro". Admin: "Só o dono do espaço pode fazer o cadastro." (`muted-foreground`). Modo suporte: "No modo suporte, o cadastro e a conta bancária não podem ser alterados." |
| `PENDING` | "Recebemos o cadastro em 04/11/2026. Avisamos assim que o parceiro responder." e o resumo mascarado (documento e conta). Depois de uma **troca de conta**, também o `Alert` `warning` "Repasses pausados até a aprovação da nova conta. As vendas continuam entrando no saldo." | — (a página reconsulta a cada 15 s enquanto estiver aberta) |
| `APPROVED` | "Aprovado em 05/11/2026." e o resumo mascarado (documento, banco, agência, conta ou chave) | Dono, fora do modo suporte: contorno "Trocar conta bancária" (ver abaixo). Admin: "Só o dono do espaço pode trocar a conta." Modo suporte: o mesmo aviso do `NOT_STARTED` |
| `REJECTED` | `Alert` `destructive`: "O parceiro recusou o cadastro." + "Motivo: <motivo>" | Dono, fora do modo suporte: primário "Corrigir e reenviar" (abre o cadastro com os dados não sensíveis preenchidos; documento e conta são digitados de novo, porque a API só guarda o mascarado) |

**Quem pode (decisão 95):** cadastro, reenvio e troca de conta são **só do Dono e fora do modo suporte** (o Super em modo suporte vale como Dono no resto do painel, mas aqui não envia nada). Os botões não aparecem para Admin nem no modo suporte, e a rota do cadastro responde com o estado de sem permissão.

**Trocar conta bancária** (`APPROVED`): o mesmo cadastro, aberto direto na etapa 3 ("Onde receber") e seguido da revisão. Antes de enviar, `ConfirmDialog`: "Trocar a conta de recebimento?" / "O cadastro volta para análise e os repasses ficam pausados até a aprovação da nova conta. Todos os donos do espaço recebem um aviso." ("Cancelar" e "Trocar conta"). Enviado: o card vai para "Em análise" com o aviso de repasses pausados e o toast "Nova conta enviada para análise".

**Cadastro em etapas** (só Dono, fora do modo suporte), em `/painel/recebimentos-online/cadastro`, coluna de até 640:
- **Indicador de etapas:** `ol` com os quatro nomes ("Quem recebe · Endereço · Onde receber · Revisão e envio"), número em círculo de 24, a atual com `aria-current="step"` e sublinhado `primary`; as feitas com `Check`. Não é navegável (só "Voltar" e "Editar" da revisão).
- **1. Quem recebe:** tipo em `OptionCards` ("Empresa (CNPJ)" / "Pessoa física (CPF)"); documento com a máscara `cnpj` ou `cpf`; "Razão social" ou "Nome completo"; com CNPJ, "Responsável pela conta" e "CPF do responsável"; telefone (`phone`) e e-mail.
- **2. Endereço:** `CepField`, número, complemento (opcional), com o preenchimento automático de hoje.
- **3. Onde receber:** `OptionCards` "Conta bancária" / "Chave Pix". Conta: banco (lista com busca, "260 · Nu Pagamentos"), agência, conta com dígito, tipo (corrente/poupança, rádio). Chave: tipo (CPF/CNPJ, e-mail, telefone, aleatória) e a chave com a máscara do tipo. Dica do grupo: "A conta precisa estar no CPF/CNPJ informado."
- **4. Revisão e envio:** cada etapa num bloco (overline + resumo + `ghost` "Editar") e o checkbox "Li e aceito os termos do parceiro de pagamentos e as condições de recebimento do Space Sports." (links para os termos; sem marcar, o envio mostra o erro do grupo "Aceite os termos para continuar").
- Rodapé de cada etapa: contorno "Voltar" (na primeira, "Cancelar", que volta à página) e primário "Continuar"; na última, "Enviar cadastro" ("Enviando…"). Validação ao continuar, foco no primeiro inválido. Os dados ficam só na memória da página: fechar a aba pede a confirmação nativa do navegador (`beforeunload`), sem diálogo próprio.
- Com o fake, a faixa de teste no topo: "Ambiente de teste: o cadastro é aprovado sozinho em alguns segundos." seguido da dica de recusa que a API manda no ambiente de pagamento (ex.: "Documento terminado em 0000 é recusado."). Sem a dica, só a primeira frase.
- Enviado: volta para a página com o card em "Em análise" e o toast "Cadastro enviado".

**Card "Formas de pagamento no app"** (Dono e Admin): dois grupos com overline, cada um em `OptionCards` (3 colunas em ≥ 1024, empilhado abaixo):
- **Reservas pelo app:** "Só no local" — "Como hoje: o jogador paga no espaço." · "No local ou online" — "O jogador escolhe Pix, cartão ou no local. A reserva é confirmada na hora." · "Online obrigatório" — "Pagamento na reserva. O horário fica guardado por 15 min; sem pagamento, a reserva é cancelada sozinha. Ajuda contra faltas."
- **Mensalidades de aulas:** "Só no local" — "O aluno paga no espaço." · "No local ou online" — "O aluno pode pagar a mensalidade com Pix ou cartão pelo app."
- Nota abaixo: "Reservas de balcão e de mensalistas continuam pagas no local."
- Primário "Salvar alterações", habilitado só com mudança; toast "Formas de pagamento salvas".
- **Bloqueado** sem cadastro aprovado: `Alert` `info` no topo do card ("Disponível depois que a conta de recebimento for aprovada.") e as opções `disabled` (tokens `disabled`, sem `opacity`), com "Só no local" marcado.

**Card "Taxa de serviço"** (somente leitura): linhas rótulo/valor `tabular-nums` — "Pix 4%", "Cartão de crédito 6%", "Mínimo por pagamento R$ 1,00" (percentuais a partir dos pontos-base, sem casas decimais quando inteiros: 450 → "4,5%"). Com regra própria do espaço, badge `info` "Condição especial" no cabeçalho. Abaixo, divisória e o texto (14/20 `muted-foreground`): "Só nos pagamentos online. O jogador paga o preço normal, sem acréscimo; a taxa sai do valor que o espaço recebe e já inclui o custo do Pix e do cartão. Se houver estorno, a taxa volta na mesma proporção. Pagamentos no local não têm taxa." E o exemplo calculado com as taxas do espaço: "Exemplo: R$ 100,00 no Pix → taxa R$ 4,00 → o espaço recebe R$ 96,00." e "Abaixo de R$ 25,00 no Pix, vale o mínimo de R$ 1,00." (limite = mínimo × 10000 ÷ bps, arredondado para cima ao centavo). Com a taxa do Pix em 0% (ou o mínimo em zero) essa linha não aparece; o exemplo mostra o valor que a regra der.

#### Painel — (8) Carteira e contestações (RF-ONPAY-07 e 09)

**Avisos no topo** (antes dos números, um `Alert` por assunto): contestação aberta (`destructive`): "1 contestação aguardando resposta até 12/11." + link "Responder"; repasse que falhou (`destructive`): "Um repasse de R$ 410,00 não foi enviado. Confira a conta bancária com o suporte."; troca de conta em análise (`warning`, decisão 95): "Repasses pausados até a aprovação da nova conta."; fake: a faixa de teste "Ambiente de teste: os valores são simulados."

**Números** (`StatCard`, 3 colunas em ≥ 768): overline, valor `font-display` 4xl `tabular-nums` e legenda 13/18 `muted-foreground`:
- **Disponível** — "Entra no próximo repasse automático." (com os repasses pausados pela troca de conta: "Fica no saldo até a aprovação da nova conta.")
- **A liberar** — "Vendas ainda no prazo de liberação."
- **Repassado** — "Enviado para a conta do espaço desde a ativação."

Sem variação nem gráfico dentro dos cartões: são números de referência.

**Linha seguinte** (2 colunas em ≥ 1280, `2fr 1fr`; empilhado abaixo):
- **"A liberar por data"** (card): lista `ul` das próximas 7 datas com valor e uma linha final "Depois de 11/11" com o resto. Linha em grid `[data 96] [barra 1fr] [valor auto]`, 36 de altura: data "Qua, 05/11" 14/20; barra horizontal `bg-chart-1`, altura 8, raio 4, largura proporcional ao maior valor da lista (mín. 2 px quando > 0; nada quando zero, e o valor vira "—"); valor 14/500 `tabular-nums` à direita. A barra é só apoio visual (`aria-hidden`): o texto da linha já tem a data e o valor, então não há tooltip nem legenda (uma série só). Vazio: "Nada a liberar. Novas vendas aparecem aqui." Forma escolhida pela skill de visualização: magnitude por data, série única, sequencial numa cor (`chart-1` tem ≥ 7.3:1 sobre o card nos dois temas); sem biblioteca de gráficos.
- **"Repasses"** (card): as 5 últimas linhas (data, valor `tabular-nums`, badge) e, embaixo, "Conta ****-6" e `ghost` "Ver todos" (aplica o filtro Tipo = Repasse nos lançamentos e rola até eles).

**Lançamentos:** título de seção e, à direita, contorno "Exportar CSV" (`Download`). Uma linha de filtros: período (`DateRangePicker`, padrão últimos 30 dias), Tipo (`Select`: Todos, Vendas, Taxas de serviço, Estornos, Taxas devolvidas, Contestações, Repasses, Ajustes) e Meio (Todos, Pix, Cartão); os filtros ficam na URL. Tabela:

| Coluna | Conteúdo |
|---|---|
| Data | dd/mm/aaaa HH:mm |
| Tipo | rótulo da tabela de lançamentos |
| Descrição | "Reserva · Maria O. · 08/11 18:00", "Mensalidade · João S. · nov 2026", "Para a conta ****-6"; reserva e mensalidade são links que abrem o detalhe |
| Meio | Pix, Cartão ou "—" |
| Libera em | data futura (`muted-foreground`) ou "—" |
| Valor | à direita, `tabular-nums`, "+ R$ 120,00" em `amount-positive` ou "− R$ 4,80" em `foreground` |

Paginação da API (25 por página, "Anterior · Página 1 de 4 · Próxima"). Vazio: "Nenhum lançamento no período." Carregando: `LoadingBlock`. CSV com o período e os filtros da tela: `carteira-<slug>-<de>_<até>.csv`, colunas Data, Tipo, Descrição, Meio, Valor (R$) (com sinal), Libera em e Cobrança (id), pelo `toCsv`/`formatCsvMoney` de hoje (ou o CSV da API, se a PG.2 entregar um).

**Aba Contestações:** tabela com Aberta em, Cliente, Item, Valor contestado, "Responder até" (data; com 3 dias ou menos, "12/11 · faltam 3 dias" em `text-warning-subtle-foreground`; vencido, "Prazo encerrado" em `muted-foreground`), Situação (badge) e a ação: contorno "Responder" (aguardando) ou `ghost` "Ver". Vazio: "Nenhuma contestação. Quando um cliente contestar um pagamento com o banco do cartão, ela aparece aqui."

**Diálogo "Responder contestação"** (até 560): resumo "Maria Oliveira contestou R$ 120,00 com o banco do cartão (reserva de 08/11, 18:00). Quem decide é o banco." e "O valor já saiu do saldo, e a taxa de serviço dele foi devolvida. Se o banco der razão ao espaço, o valor volta."; `Textarea` "Sua resposta" (obrigatória, 20 a 2000 caracteres, contador; dica "Conte o que comprova o serviço: reserva usada, conversa com o cliente, horário de chegada."; erro "Escreva pelo menos 20 caracteres"); anexos opcionais (contorno "Adicionar arquivo", até 3, PDF, JPG ou PNG de até 5 MB, lista com nome, tamanho e remover; erro "Envie PDF, JPG ou PNG de até 5 MB"); rodapé contorno "Cancelar" + primário "Enviar resposta" ("Enviando…"). Depois: toast "Resposta enviada" e o "Ver" mostra a resposta e os anexos só para leitura.

#### Painel — (9) Detalhe da reserva e da mensalidade, e estorno (RF-ONPAY-08, RN-ONPAY-05)

**Reserva aguardando pagamento:** na `BookingDetailSheet`, badge "Aguardando pagamento" no status e, em "Quando e onde", "Horário guardado até 18:47 · o cliente está pagando pelo app." Na **agenda**, o bloco usa `bg-warning-subtle` com **borda tracejada** 1.5 `border-warning-subtle-border` (provisório) e a segunda linha "Aguardando pagamento · até 18:47". Na **lista de reservas**, o filtro de status ganha "Aguardando pagamento". Cancelada por falta de pagamento: motivo "Pagamento não feito no prazo".

**Seção "Valores"** (reserva) e o diálogo de pagamentos da mensalidade:
- **Linhas de valores** (`tabular-nums`): "Total" · "Abatimento por estorno − R$ 40,00" (só quando houve estorno com abatimento, decisão 93) · "Recebido" (o líquido do que ficou com o espaço do cliente, sem a taxa: o extrato mostra só o líquido) · "Em aberto" (500). Exemplo, Pix de R$ 120,00 com estorno de R$ 40,00 e abatimento: Total R$ 120,00 · Abatimento por estorno − R$ 40,00 · Recebido R$ 80,00 · Em aberto R$ 0,00. Se a gestão escolheu cobrar de novo: Total R$ 120,00 · Recebido R$ 80,00 · Em aberto R$ 40,00 (e aí "Receber" volta a aparecer).
- O registro de pagamento com `channel = ONLINE` leva a etiqueta neutra "Online" (`Badge` `muted`) ao lado de "R$ 120,00 · Pix" e **não tem o botão "Estornar" manual**: aquele estorno só desfaz o registro e não devolve dinheiro. Devolução de pagamento online é sempre pelo bloco abaixo.
- **Registrar pagamento no local** (decisão 96): em `PENDING_PAYMENT` o botão "Receber" não aparece (nem na reserva, nem em "A receber hoje"). Com uma cobrança online **aberta** (modo opcional), o `PaymentDialog` mostra no topo o `Alert` `warning` "O cliente tem um Pix aberto pelo app até 18:47. Registrar o pagamento no local cancela essa cobrança." Se a API recusar porque a cobrança acabou de ser paga, o diálogo mostra o `FormError` "O cliente acabou de pagar pelo app. A reserva foi atualizada." e recarrega o detalhe.
- **Bloco "Pagamento online"** (overline com `CreditCard`), um por cobrança **paga** e mais um para a cobrança **aberta**, se houver; `rounded-md border p-3 grid gap-2`:
  - **Cobrança aberta:** ícone do meio 16 + "Pix aberto até 18:47" (cartão: "Cartão em processamento") e o badge "Aguardando pagamento"; sem linhas de valor (a taxa só existe depois do pagamento) e sem ações.
  - **Cobrança paga** — cabeçalho: ícone do meio 16 + "Pix · pago em 08/11 18:42" (14/500) e o badge do status à direita.
  - Linhas `flex justify-between tabular-nums` (14/20): "Valor pago R$ 120,00" · "Taxa de serviço (4%) − R$ 4,80" · se houver, "Estornado ao cliente − R$ 40,00" e "Taxa devolvida + R$ 1,60" (`amount-positive`) · divisória · "O espaço recebe R$ 76,80" (500). Com contestação: "Contestação no cartão − R$ 120,00". O percentual da taxa é o **gravado na cobrança** (snapshot de `fee_bps`), não a taxa atual do espaço; quando valeu o mínimo, a linha diz "Taxa de serviço (mínimo) − R$ 1,00".
  - Rodapé 12/16 `muted-foreground`: "Libera em 09/11" (ou "Liberado") e "Transação a8f3…91c2" com botão de copiar (ícone de 14, alvo de 32, `aria-label="Copiar código da transação"`).
  - Histórico de estornos: "Estorno em 09/11 por Ana (Admin):", o motivo entre aspas e, em `muted-foreground`, "abatido do valor da reserva" ou "volta a ser cobrado"; os automáticos dizem "Estorno automático (cancelamento dentro do prazo)", "(cancelado pelo espaço)" ou "(pagamento depois do prazo)".
  - Ação: contorno pequeno "Estornar" à direita, só Dono/Admin e só com valor ainda não estornado (`PAID` ou `PARTIALLY_REFUNDED`).
- Professor não vê nada disso (decisão 53, como os valores de hoje).

**Cancelar reserva paga online** (gestão): a descrição do diálogo atual ganha "O cliente recebe R$ 120,00 de volta automaticamente, e a taxa de serviço volta para o espaço." (decisão 86: cancelamento pelo espaço sempre estorna o total).

**Diálogo de estorno** (`RefundDialog`, até 520):
- Título "Estornar pagamento online"; descrição "Pix de R$ 120,00 · Maria Oliveira · pago em 08/11" e, se houver, "Já estornado: R$ 40,00".
- "Quanto devolver", `OptionCards` em 2 colunas: "Tudo o que falta" (com o valor, "R$ 80,00") e "Parte do valor". Com parte, o campo `MaskedInput` `money` "Valor a devolver", dica "Até R$ 80,00", erros "Informe um valor acima de R$ 0,00" e "Informe um valor até R$ 80,00". Quando já houve estorno parcial, a primeira opção continua sendo "Tudo o que falta".
- **"O valor devolvido volta a ser cobrado?"** (decisão 93), `OptionCards` em 2 colunas, padrão a primeira: **"Não, é um abatimento"** — "A reserva continua paga; o valor devolvido vira desconto." (mensalidade: "A mensalidade continua paga…") · **"Sim, cobrar de novo"** — "O valor devolvido volta a ficar em aberto para receber no local."
- `Textarea` "Motivo" (obrigatório, 5 a 500), dica "O cliente vê este motivo no app.", erro "Informe o motivo do estorno".
- **Efeito** (bloco `bg-muted rounded-md p-3`, atualizado ao digitar, `aria-live="polite"`): "O cliente recebe R$ 30,00 no Pix" · "Taxa devolvida ao espaço + R$ 1,20" (`amount-positive`) · "O espaço deixa de receber − R$ 28,80" · "Fica em aberto na reserva R$ 0,00" (ou "R$ 30,00" com "cobrar de novo") e, em 12/16 `muted-foreground`, "Estimativa; o valor final aparece nos lançamentos."
- **Taxa devolvida pela regra acumulada** (decisão 94; a API é a fonte de verdade): `devolvida = arredondar(taxa × (já estornado + este estorno) ÷ valor pago) − taxa já devolvida`, em centavos, meio para cima; o estorno que zera o pago devolve exatamente o resto da taxa. Exemplo com taxa de R$ 4,80 sobre R$ 120,00 e R$ 40,00 já estornados (R$ 1,60 de taxa devolvida): estornar mais R$ 30,00 devolve `arredondar(480 × 7000 ÷ 12000) − 160 = 280 − 160` = R$ 1,20; estornar os R$ 80,00 restantes devolve R$ 3,20 (o resto exato).
- Na reserva, a nota (12/16 `muted-foreground`): Para cancelar a reserva e devolver tudo, use **Cancelar reserva**: o estorno é automático.
- Rodapé: contorno "Cancelar" e `destructive` "Estornar R$ 30,00" ("Estornando…"). Sem segundo diálogo: o botão já diz o valor. Erro da API em `FormError` no topo (ex.: "O saldo do espaço não cobre este estorno agora. Tente depois do próximo recebimento."). Sucesso: toast "Estorno de R$ 30,00 enviado ao cliente." e o bloco atualizado.

**Extrato e "a receber"** (`/painel/recebimentos`): coluna ou etiqueta "Canal" com "No local" / "Online" (`Badge` `muted`) e o filtro correspondente no extrato. Reserva `PENDING_PAYMENT` não entra no "a receber hoje": ela está sendo paga pelo app. Reserva com Pix aberto (modo opcional) entra, com a etiqueta "Pix aberto" (`muted`) ao lado do status, e o "Receber" abre o `PaymentDialog` com o aviso acima.

#### Painel — notificações da gestão

Para Dono e Admin (a troca de conta, para todos os Donos), na central e por push; textos sugeridos para a PG.2. O nome do espaço entra sem artigo.

| Evento | Título | Texto | Abre |
|---|---|---|---|
| Cadastro aprovado | Conta de recebimento aprovada | Arena Beira-Mar já pode receber Pix e cartão pelo app. Escolha as formas de pagamento. | Recebimentos online → Configuração |
| Cadastro recusado | Cadastro recusado | O cadastro de Arena Beira-Mar foi recusado: <motivo>. Corrija e envie de novo. | Recebimentos online → Configuração |
| Conta bancária trocada (decisão 95) | Conta de recebimento alterada | <nome> trocou a conta de Arena Beira-Mar. Os repasses ficam pausados até a aprovação. | Recebimentos online → Configuração |
| Contestação aberta | Contestação no cartão | Maria Oliveira contestou R$ 120,00 em Arena Beira-Mar. Responda até 12/11. | Recebimentos online → Contestações |
| Repasse falhou | Repasse não enviado | O repasse de R$ 410,00 de Arena Beira-Mar não foi enviado. Confira a conta bancária com o suporte. | Recebimentos online → Carteira |
| Troca de conta recusada (decisão 98; `MERCHANT_PAYOUT_CHANGE_REJECTED`, todos os Donos) | Troca de conta recusada | A nova conta de Arena Beira-Mar foi recusada: <motivo>. A conta anterior continua valendo; você pode tentar outra. | Recebimentos online → Configuração |

O web não tem central de notificações (ela fica no app); no painel, a troca recusada aparece no card "Conta de recebimento".

---

#### Super — (10) Pagamento online (RF-ONPAY-10 a 12)

Novo item **"Pagamento online"** (`CreditCard`) na navegação do Super, abaixo de "Financeiro", em `/super/pagamentos`, com abas na URL (`?aba=receita|taxas|cadastros|simulador`): **Receita** (padrão) · **Taxas** · **Cadastros** (com o número em análise) · **Simulador** (só quando a API expõe as rotas). No Super os termos técnicos valem ("tarifa do gateway", "chargeback" entre parênteses). O "Financeiro" consolidado de hoje passa a separar "No local" e "Online" nas somas.

**Receita:** filtros numa linha — período (`DateRangePicker`, padrão o mês corrente), espaço (busca) e meio (Todos, Pix, Cartão) — e, à direita, contorno "Exportar CSV" e contorno "Relatório NFS-e".
- 5 `StatCard`: **Volume pago** (legenda "402 pagamentos") · **Taxa bruta** ("4,9% do volume") · **Tarifa do gateway** ("− R$ 611,20") · **Taxa devolvida** ("7 estornos e contestações") · **Receita líquida** ("taxa bruta − tarifa − devolvida"). Grid de 5 colunas em ≥ 1280, 3 + 2 abaixo.
- Abas com trilho **Por espaço · Por mês · Por meio**, tabela com as colunas Pagamentos, Volume, Taxa bruta, Tarifa, Devolvida e Líquida (números à direita, `tabular-nums`), ordenável, padrão Líquida decrescente, e uma linha de total (500, `border-t`). O nome do espaço leva ao detalhe dele no Super. Sem gráfico: o web não tem biblioteca de gráficos, e a tabela responde às perguntas (quem gera receita, quanto custa o gateway).
- CSV da visão atual: `receita-pagamentos-<de>_<até>.csv`. "Relatório NFS-e" abre um diálogo com o mês (`Select`) e baixa `taxas-nfse-<aaaa-mm>.csv` (Espaço, Documento, Taxa bruta, Taxa devolvida, Base da nota). O relatório (`GET /v1/super/online-payments/reports/monthly` e `.csv`) traz o **documento completo** do cadastro no gateway, o único lugar em que ele aparece, com cada leitura na auditoria (`super.payment_report.*`).

**Taxas:**
- Card **"Taxa padrão"**: Pix e Cartão em campo de percentual (máscara de 2 casas, "4,00 %", gravado em pontos-base, com `maskPercent`, `parsePercentToBps`, `bpsToInput` e `formatBpsPercent` de `packages/shared`), Mínimo em `money`, "Quem paga: Espaço" só leitura com a dica "Pagamento da taxa pelo jogador depende de decisão futura (decisão 82)". Exemplo ao vivo: "R$ 100,00 no Pix → taxa R$ 4,00 · no cartão → R$ 6,00". "Última alteração: 04/11/2026 por <nome>". Primário "Salvar taxa padrão" com confirmação: "A nova taxa vale para cobranças criadas a partir de agora. As já criadas mantêm a taxa da época." Erros: "Informe um percentual entre 0% e 100%", "Informe um valor de R$ 0,00 ou mais". Com Pix ou cartão em 0%, o exemplo mostra só o mínimo ("taxa R$ 1,00 por pagamento").
- Card **"Condições especiais por espaço"**: tabela (Espaço, Pix, Cartão, Mínimo, Atualizado; campo vazio aparece como "padrão" em `muted-foreground`) e ações `ghost` "Editar" e "Remover". Primário "Adicionar condição" abre o diálogo com o espaço (busca entre os ativos; quem já tem condição não aparece) e os três campos opcionais ("Vazio = taxa padrão"). "Remover" confirma: "O espaço volta à taxa padrão nas próximas cobranças."

**Cadastros:** `ChipButton` de status com contagem (Todos · Em análise · Recusados · Aprovados · Não iniciados) e tabela Espaço, Situação (badge), Documento (mascarado), Enviado, Decidido e Motivo (1 linha com reticências e `title` completo). Só leitura; o nome leva ao detalhe do espaço.

**Simulador** (RF-ONPAY-12, só com o fake):
- **Faixa no topo**, largura toda: `bg-sandbox`, borda 1.5 `border-sandbox-border`, `rounded-lg`, padding 16, `FlaskConical` 20, título em overline "Simulador · ambiente de teste" e o texto 14/20 "Estas ações fingem eventos do parceiro de pagamentos. Só existem com o gateway simulado e nunca em produção. Nada aqui movimenta dinheiro de verdade." (`role="note"`). A faixa não fecha.
- Abaixo, cards com **borda tracejada** 1.5 `border-sandbox-border` (no escuro o próprio laranja; no claro, Noite): **Cobranças pendentes** (tabela com Espaço, Item, Valor, Meio, Vence e as ações contorno "Pagar" e contorno `destructive` "Vencer"), **Contestação** (cobrança paga com cartão em `Select` + "Gerar contestação"), **Cadastros em análise** ("Aprovar" e "Recusar", com motivo num `ReasonDialog`) e **Saldos** (espaço ou todos, "Liberar tudo agora" e "Rodar repasse").
- Sem confirmação (é teste); cada ação dá um toast com o resultado ("Pix de R$ 120,00 pago. O webhook foi enviado.") e recarrega a lista. Erro da API em toast `destructive`.
- Com o fake ligado, o selo "Ambiente de teste" também fica na barra superior do `/super`.

#### Implementação no web (PG.3)

O que a PG.3 entregou e onde ficou diferente desta especificação por causa do contrato da PG.2:
- **Rotas:** `/painel/recebimentos-online` (abas `?aba=carteira|contestacoes|configuracao` depois da primeira aprovação), `/painel/recebimentos-online/cadastro` (e `?troca=1` para a troca de conta) e `/super/pagamentos` (`?aba=receita|taxas|cadastros|simulador`). Item do menu por `payments.online.manage` (Dono/Admin); cadastro e troca por `merchant.manage` (só Dono) e fora do modo suporte.
- **Rótulos e regras de tela** em `apps/web/src/lib/painel/labels.ts`, `lib/painel/online-payments.ts` e `lib/super/online-payments.ts` (testados). Valor com sinal por `formatSignedMoney` (menos U+2212 e espaço fino **inseparável**, para o sinal não quebrar a linha).
- **"Estornar"** aparece pelo `refundableCents` (a contestação ganha volta a aceitar estorno); os estornos `PENDING` entram no histórico com "em processamento". O registro `ONLINE` leva a etiqueta "Online" e não tem o estorno manual.
- **Cadastro:** com CNPJ, o campo **"CPF do responsável"** (obrigatório, máscara `cpf`, validado pelo dígito; não aparece com CPF, em que o titular é o responsável) vai como `responsibleCpf`; depois de enviado, o card mostra só o mascarado ("Responsável: <nome> · CPF ***.982.247-**", `responsibleCpfMasked`, decisão 97). Banco por código COMPE com sugestões (`datalist`) dos bancos mais comuns.
- **Carteira:** filtros Período, Tipo e **Meio** (Todos, Pix, Cartão: só os lançamentos de cobranças desse meio; repasses e ajustes saem) e paginação "Anterior · Página X de N · Próxima", com N pelo `total` dos filtros (25 por página; a API pagina por cursor). O CSV usa os mesmos filtros (período, tipo e meio). Mudar qualquer filtro volta à página 1; "Ver todos" dos repasses põe o tipo em Repasses e limpa o meio. Os filtros ficam no estado da tela, não na URL.
- **Contestação:** os anexos são **links `https`** (até 3, um por linha), porque a API recebe `attachmentUrls`, não arquivos.
- **Super, Receita:** seis números (com **Taxa recobrada**, decisão 94) em três colunas e a coluna "Recobrada" nas tabelas. "Relatório NFS-e" mostra o relatório do mês (documento completo, taxa bruta, devolvida, recobrada e base) antes de baixar o CSV; cada consulta fica na auditoria.
- **Revisão da PG.3 e PG.3c:** as formas de pagamento liberam pelo `onlineReady` das configurações (a regra da API: gateway ligado, espaço ativo e cadastro já aprovado; a troca em análise não bloqueia). Bloqueadas sem cadastro aprovado, o aviso é "Disponível depois que a conta de recebimento for aprovada."; com o cadastro aprovado e `onlineReady` falso, "O pagamento pelo app não está disponível para o espaço agora. Fale com o suporte.". Espaço já aprovado nunca abre o cadastro inteiro (decisão 98). **Troca de conta recusada** (`lastRejectedPayoutChange`): o card continua "Aprovado" com a conta anterior e ganha o `Alert` `warning` "O parceiro recusou a troca para a conta ****-9 em 06/11/2026. A conta anterior continua valendo.", o motivo e "Os repasses e o pagamento pelo app seguem normalmente."; "Trocar conta bancária" abre só "Onde receber" com o mesmo aviso no topo. `REJECTED` com o card vermelho e "Corrigir e reenviar" fica só para o primeiro cadastro. No diálogo de pagamentos da mensalidade, o registro com `channel` `ONLINE` leva a etiqueta "Online" e não tem o "Estornar" manual (sai pelo estorno da cobrança online). O estorno manda sempre `amountCents` (também em "Tudo o que falta"), o toast usa o valor devolvido pela API, e o 422 `REFUND_EXCEEDS_BALANCE` recarrega a cobrança no diálogo. "Ver todos" dos repasses volta à página 1. O exemplo ao vivo da taxa padrão é calculado por meio. O relatório da NFS-e não é refeito ao voltar o foco da janela.
- **Simulador:** a aba aparece só quando `GET …/simulator/charges` responde (404 sem o fake). "Saldos" tem uma ação só, "Liberar tudo e repassar agora" (a API libera e repassa juntos), e o card "Contestação" também decide a contestação aberta (ganha/perdida).

### Avaliações

Especificação da tarefa AV.1 para o web (AV.3) e o app (AV.4). Decisões 99 a 106 de `07-perguntas-em-aberto.md`; RF-REVIEW-01 a 09 e RN-REVIEW-01 a 07 (`02-requisitos-funcionais.md`, seção 12). Mockups em [`avaliacoes/`](avaliacoes/README.md): [app](avaliacoes/app.md), [página pública, painel e Super](avaliacoes/web.md) e a tela de avaliar com o bloco da página do espaço nos dois temas ([`avaliar-claro-escuro.png`](avaliacoes/avaliar-claro-escuro.png), com o `.svg` ao lado). Medidas em `reviewLayout` e o desenho da nota em `starFills()` (`@space-sports/ui-tokens`, `rating.ts`); use as constantes, não os números soltos.

#### Princípios

1. **Avaliar leva 10 segundos.** Só a nota é obrigatória; chips e comentário são opcionais e ficam abaixo. Um toque nas estrelas do card da reserva passada já grava a nota.
2. **A nota é sempre número e estrela juntos.** Estrela nunca aparece sozinha como informação ("★ 4,8", "4 de 5 estrelas" no leitor de tela). A cor nunca é o único sinal: a estrela cheia também tem forma cheia, e a vazia é só contorno.
3. **Sem resumo abaixo de 5 avaliações** (RN-REVIEW-03): no lugar da média, o selo "Novo". Os comentários que houver aparecem.
4. **O espaço não manda na avaliação.** No painel há responder e denunciar, nada de apagar, ocultar ou editar a avaliação de alguém. A resposta sai em público com o nome do espaço.
5. **Moderação esconde o texto, não a nota** (RN-REVIEW-04): o item mostra "Comentário oculto pela moderação" e continua com a nota e os chips.
6. **Privacidade do autor:** primeiro nome + inicial do sobrenome ("Ana S."), foto ou iniciais, e o selo do uso ("Jogou aqui" ou "Aluno"). Nunca o sobrenome inteiro, o e-mail ou a data do jogo. Conta excluída: "Usuário removido", sem foto nem selo.

#### Tokens novos (`packages/ui-tokens`)

Acréscimos da AV.1 em `colors.ts` (gerados em `theme.css` e `nativewind.css`). No web, as classes `fill-rating`, `stroke-rating-border` e `stroke-rating-empty` (vencem os atributos `fill`/`stroke` do SVG do Lucide); no app, `color(name, 'rating')`, `color(name, 'ratingBorder')` e `color(name, 'ratingEmpty')` nas props `fill` e `color`.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `rating` | `#FBBD10` | `#FBBD10` | Preenchimento da estrela cheia (e da metade cheia): o Sol da marca nos dois temas |
| `rating-border` | `#8F6407` | `#FBBD10` | Contorno da estrela cheia. No claro o Sol tem 1.6:1 com o fundo e reprova como ícone (diretriz "nunca o Sol como ícone sobre fundo claro"); o contorno Sol 700 dá os 3:1 (≥ 4.6:1 em fundo, card, popover e `muted`), a mesma solução da borda Noite do chip selecionado. No escuro o Sol já tem ≥ 8:1 |
| `rating-empty` | `#7F8C93` | `#607B89` | Contorno da estrela vazia, sem preenchimento: a cor da borda de campo (`input`), ≥ 3:1 em fundo, card, popover e `muted` nos dois temas |

As barras da distribuição não usam a estrela: trilho `muted` e barra `primary` (Mar no claro, Sol no escuro; ≥ 7:1 sobre o trilho), a mesma receita do indicador do carrossel. O resto vem dos tokens existentes. Testes (`contrast.test.ts`): contorno da cheia e contorno da vazia ≥ 3:1 sobre fundo, card, popover e `muted`; a vazia fora da escala Sol; no claro o contorno diferente do preenchimento; tudo também nos valores HSL do mobile.

#### (1) Estrela

- **Ícone:** `Star` e `StarHalf` do Lucide (`lucide-react` no web, `lucide-react-native` no app, os dois já instalados), na grade 24×24 com traço 2 e pontas redondas. Sem SVG novo: o desenho do Lucide já combina com o resto dos ícones.
  - **Cheia:** `<Star fill={rating} color={ratingBorder} />` (web: `className="fill-rating stroke-rating-border"`).
  - **Vazia:** `<Star fill="none" color={ratingEmpty} />` (web: `fill-none stroke-rating-empty`).
  - **Meia:** a vazia com a `StarHalf` cheia por cima, na mesma caixa (`absolute inset-0`). A `StarHalf` é a metade esquerda; o preenchimento fecha no eixo vertical. Em RTL não há caso (o app só tem pt-BR).
  - Nota inteira (item, entrada) só tem cheia e vazia. Média: `starFills(average)` arredonda para a meia mais próxima (4,2 → 4; 4,3 e 4,7 → 4½; 4,8 → 5). O número ao lado é que diz a média exata.
- **Tamanhos** (`reviewLayout.star`):

| Uso | Ícone | Entre estrelas | Alvo de toque | Onde |
|---|---|---|---|---|
| `badge` | 14 | 4 até o número | — | Selo "★ 4,8 (23)": uma estrela só |
| `item` | 14 | 2 | — | Nota de cada avaliação na lista |
| `summary` | 20 | 4 | — | Sob a média grande; cards do painel |
| `prompt` | 32 | 4 entre os alvos | 44 | Card "Avalie sua experiência" (236 de largura) |
| `input` | 40 | 0 (alvos encostados) | 52 | Tela de avaliar (260 de largura) |

- **Estado pressionado** (só nas tocáveis): o alvo de 44/52 ganha `bg-accent rounded-full` enquanto o dedo está em cima (`active:`); no web, `hover:bg-accent` e o anel de foco `focusRing` no alvo. Ao escolher, as estrelas até a tocada enchem juntas, sem animação de "pulo" (com "reduzir movimento" ligado também não há transição de cor).
- **Acessibilidade:** fora da entrada, o grupo de estrelas é decorativo (`aria-hidden`) e o texto ao lado ou o rótulo do contêiner dizem a nota: "Nota 4,8 de 5, 23 avaliações", "4 de 5 estrelas". Na entrada, ver (3).

#### (2) Selo no card da vitrine, no callout do mapa e no cabeçalho da página

Dois formatos, a partir de `rating: { count, average }` do card (`average` nulo com menos de 5):

| `count` | Selo | Rótulo de acessibilidade |
|---|---|---|
| ≥ 5 | ★ **4,8** (23) | "Nota 4,8 de 5, 23 avaliações" |
| 0 a 4 | badge **Novo** | "Novo, ainda poucas avaliações" |

- **"★ 4,8 (23)":** estrela `badge` (14, cheia), 4, média em 14/20 600 `text-foreground` `tabular-nums` com uma casa e vírgula (a formatação da média de `packages/shared`, criada na AV.2), espaço e a contagem entre parênteses em 14/20 `text-muted-foreground` (milhar com ponto: "(1.234)"). Linha sem quebra (`numberOfLines={1}`, `shrink-0`).
- **"Novo":** o `Badge` `info` do app (`border-info-subtle-border bg-info-subtle`, texto `info-subtle-foreground`, raio 6, 600, `sm` com padding 3/10). No web, o badge de status `info` (`xs` no painel, `sm` nas públicas). É situação, não escolha: badge, não chip. Sem estrela, para não parecer nota zero.
- **Onde fica no card da vitrine** (`SpaceCard`): no começo da linha de baixo do nome, antes de bairro · distância, separado por " · ". Essa linha já é a segunda coisa que se lê; a nota entra sem acrescentar altura nem mexer na foto, no selo "Patrocinado" (que fica sobre a foto, no canto superior esquerdo), nos chips ou no rodapé de preço.

```
┌ (logo 44) Arena Beach Savassi ─────────────┐   nome h4, 1 linha
│           ★ 4,8 (23) · Savassi · 1,2 km    │   selo shrink-0; o local encolhe com "…"
│           [Novo] · Savassi · 1,2 km        │   com menos de 5 avaliações
```

  - A linha vira `flex-row items-center gap-1.5`: selo (fixo), o separador "·" `text-muted-foreground` e o texto de local (`flex-1`, `numberOfLines={1}`). Em 320 dp com fonte 1.3× o local corta antes; o selo nunca.
  - O rótulo de acessibilidade do card ganha a nota depois do nome: "Arena Beach Savassi, nota 4,8 de 5, 23 avaliações, Savassi, 1,2 km, R$ 120,00 por hora" (ou ", novo, ainda poucas avaliações,").
  - **Card patrocinado de espaço sem imagem própria:** é o `SpaceCard`, então leva o selo igual. **Com imagem própria** (anunciante espaço): o selo entra no começo da linha de destino do rodapé ("★ 4,8 (23) · Savassi · Belo Horizonte"), antes do `ChevronRight`. Anunciante de site ou WhatsApp não tem nota.
  - **Espaços recentes:** sem selo. O card é para voltar a um lugar conhecido, não para comparar, e com 152 de largura a nota tiraria o bairro.
- **Callout do mapa:** a mesma linha de local do callout ganha o selo no começo ("★ 4,8 (23) · Savassi · 1,2 km"); o preço continua na terceira linha. Rótulo: "<nome>, nota 4,8 de 5, 23 avaliações, R$ 120,00 por hora. Abrir página do espaço". Os pinos do mapa não mudam.
- **Cabeçalho da página do espaço** (app e web): uma linha abaixo de bairro · cidade, com o selo e, com resumo, " · 23 avaliações" em vez de "(23)": "★ 4,8 · 23 avaliações". É um link para o bloco "Avaliações" (app: `scrollTo` até o bloco; web: `href="#avaliacoes"`), `role="link"`, alvo de 44 no app (a linha tem `min-h-11` e o toque cobre a largura do texto). Com "Novo": o badge e "Ainda poucas avaliações" em `text-muted-foreground`; sem nenhuma avaliação, só o badge.

#### (3) Tela de avaliar (app)

**Tela cheia**, rota `espaco/[slug]/avaliar` (empilhada, com `ScreenHeader` "Avaliar" e voltar), e não sheet, porque:
- ela abre direto do push, do item da central e do deep link `spacesports://espacos/<slug>/avaliar`, muitas vezes sem a página do espaço por baixo: uma sheet precisaria de uma tela hospedeira e de um voltar que não existe;
- tem campo de texto de várias linhas com o teclado aberto, que no Android briga com o `@gorhom/bottom-sheet` (sheet que sobe junto com o teclado e esconde o botão);
- a altura muda com a nota (os chips trocam de grupo) e com o tamanho da fonte; numa tela com rolagem isso não pula;
- dá para avisar ao sair com alterações não enviadas ("Descartar a avaliação?"), o que a sheet fechada por arrasto não permite com clareza.

**Hierarquia, de cima para baixo** (360 dp, `px-4`, rolagem com o botão fixo embaixo):

```
┌ ← Avaliar ──────────────────────────────┐  ScreenHeader
│ (logo 56) Arena Beach Savassi            │  nome 18/28 600, até 2 linhas
│           Savassi · Belo Horizonte       │  14/20 muted
│                   ↕ 24                   │
│ Como foi sua experiência?                │  font-display-semibold 20/28
│                   ↕ 16                   │
│      ☆    ☆    ☆    ☆    ☆               │  5 × alvo 52, estrela 40, centralizadas
│                   ↕ 8                    │
│          Toque para dar a nota           │  16/24 muted → depois: "Bom" 18/28 600
│                   ↕ 24                   │
│ O que se destacou? (opcional)            │  rótulo de grupo 14/500 + (opcional)
│ Escolha até 5                            │  dica 14/20 muted
│ [Quadra boa] [Bom atendimento] [Limpo]   │  Chip pill, alvo 44, 8 entre eles
│ [Bom custo-benefício] [Fácil de reservar]│
│ [Boa iluminação] [Horário respeitado]    │
│ [Boa estrutura]                          │
│                   ↕ 24                   │
│ Comentário (opcional)                    │  Field do app
│ ┌──────────────────────────────────────┐ │  multilinha, mín. 120, cresce até 200
│ │ Conte como foi o jogo ou a aula      │ │  placeholder
│ └──────────────────────────────────────┘ │
│ Aparece com seu primeiro nome.    0/500  │  dica à esquerda, contador à direita
├──────────────────────────────────────────┤  rodapé fixo: border-t, bg-background, p-4
│ [         Enviar avaliação          ]    │  primário 48
└──────────────────────────────────────────┘
```

- **Cabeçalho do espaço:** `SpaceAvatar` de 56 (logo ou iniciais), nome 18/28 600 `text-foreground` (até 2 linhas) e bairro · cidade 14/20 `text-muted-foreground`. Não é link (a pessoa veio para avaliar; o voltar leva ao espaço quando ela veio de lá).
- **Estrelas:** `role="radiogroup"` com `accessibilityLabel="Nota"`; cada alvo `role="radio"`, `aria-checked` só na escolhida, rótulo "1 estrela, Péssimo" … "5 estrelas, Excelente". Tocar escolhe; tocar na escolhida não apaga (a nota é obrigatória). Arrastar o dedo sobre as estrelas não muda a nota (evita nota errada ao rolar a tela).
- **Rótulo da nota** (centralizado abaixo, `accessibilityLiveRegion="polite"`; no iOS, `announceForAccessibility`):

| Nota | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Rótulo | Péssimo | Ruim | Regular | Bom | Excelente |

  Sem nota: "Toque para dar a nota" em 16/24 `text-muted-foreground`. Com nota: o rótulo em 18/28 600 `text-foreground`. Sem cor por nota (nada de vermelho no 1): a nota baixa não é erro.
- **Chips de destaque** (catálogo abaixo): o `Chip` do app (`pill`, alvo 44, padding 8/14, 14/500), múltipla escolha (`role="checkbox"` com `aria-checked`), em `flex-row flex-wrap gap-2`, na ordem do catálogo.
  - Sem nota: o grupo mostra só a dica "Dê a nota para ver as opções" (sem chips), para a tela não pular quando eles entram.
  - Nota 4–5: positivos; nota 1–3: negativos. Ao trocar de grupo, os chips do outro grupo saem da tela e do envio (a API recusa a mistura, `REVIEW_TAGS_MISMATCH`), mas a tela **lembra** a escolha de cada grupo enquanto estiver aberta: voltar de 3 para 5 devolve os positivos marcados antes. Nenhum aviso ao trocar.
  - Até 5: com 5 marcados, os outros ficam desabilitados (`disabled`, receita do chip desabilitado) e a dica vira "Você escolheu 5 de 5". Desmarcar libera.
- **Comentário:** o `Field` do app com `Input` multilinha (`textAlignVertical="top"`, altura mínima 120, cresce até 200 e depois rola por dentro), `maxLength={500}`, rótulo "Comentário" com "(opcional)", placeholder "Conte como foi o jogo ou a aula", dica "Aparece com seu primeiro nome." e o **contador** "0/500" à direita da linha da dica (14/20 `text-muted-foreground` `tabular-nums`; a partir de 450, `text-foreground` 500; em 500, "500/500" e o `maxLength` segura). Rótulo de acessibilidade do contador: "123 de 500 caracteres", lido só quando a pessoa para de digitar (não em cada tecla). Espaços nas pontas saem ao enviar; comentário só de espaços conta como vazio.
- **Botão:** "Enviar avaliação" (nova) ou "Salvar alterações" (edição), primário 48, no rodapé fixo (sobe com o teclado, `KeyboardAvoidingView`). Fica habilitado; enviar sem nota mostra, abaixo das estrelas, o erro de grupo "Escolha de 1 a 5 estrelas" (`input-error-foreground`, ícone `CircleAlert`) e rola até elas.
- **Edição** (a pessoa já avaliou o espaço: `myReview` da elegibilidade): mesma tela, preenchida. Vale **a qualquer momento**, mesmo depois dos 6 meses do uso (RN-REVIEW-01: a elegibilidade só conta para criar). No fim da rolagem, depois do comentário, "Excluir avaliação" (botão `ghost` com texto `destructive`, ícone `Trash2`). Confirma com `Alert`: "Excluir sua avaliação?" / "A nota sai da média do espaço. Para avaliar de novo, é preciso ter jogado ou feito aula aqui nos últimos 6 meses." / [Cancelar] [Excluir]. Excluiu: volta à tela anterior; a lista, o resumo e a elegibilidade são recarregados.
  - Comentário oculto pela moderação: `Alert` `info` no topo, "Seu comentário está oculto pela moderação e não aparece para os outros. Editar o texto não o reexibe." (RN-REVIEW-04).
  - Vindo do card da reserva com a nota já gravada: `Alert` `success` no topo, "Nota salva. Quer contar mais?".
- **Só leitura** (o autor tem vínculo ativo na equipe do espaço: `myReview` presente e a elegibilidade com `reason` `REVIEW_NOT_ALLOWED`, ou `canEdit` falso na elegibilidade; também ao receber 403 `REVIEW_NOT_ALLOWED` ao salvar). RN-REVIEW-01: a equipe não edita a própria avaliação do espaço, mas pode excluí-la.
  - `ScreenHeader` "Sua avaliação". No topo, `Alert` `info`: "Você faz parte da equipe deste espaço. Sua avaliação continua publicada, mas não pode ser editada enquanto você estiver na equipe. Você pode excluí-la."
  - O conteúdo aparece como no item de (5), sem controles: estrelas `summary` com o rótulo da nota, as etiquetas dos chips escolhidos (`Badge` `sport`), o comentário em 16/24 (ou a linha de comentário oculto) e a resposta do espaço, se houver. Sem campo, sem chips tocáveis, sem contador.
  - Rodapé fixo só com "Excluir avaliação" (botão de contorno com borda e texto `destructive`, ícone `Trash2`), com o mesmo `Alert` de confirmação. Sem "Salvar".
  - Ao receber o 403 durante uma edição, a tela troca para este estado e mantém o aviso acima (o que foi digitado se perde; o aviso explica por quê).
  - Os pontos de entrada mudam junto: o botão da página do espaço vira **"Ver minha avaliação"**, o card da reserva troca "Editar" por "Ver", e em Minhas avaliações e no menu do item some o "Editar" (fica "Excluir").
- **Estados:**

| Estado | Tela |
|---|---|
| Carregando (elegibilidade e espaço) | `ScreenHeader` + `LoadingView` |
| Não pode avaliar (`canReview` falso sem `myReview`; com `myReview`, é edição ou só leitura) | `EmptyView` com o motivo e o botão "Ver o espaço": `REVIEW_NOT_ELIGIBLE` "Você pode avaliar depois de jogar ou ter aula aqui." / "Vale para reservas e aulas dos últimos 6 meses."; `REVIEW_NOT_ALLOWED` "Você faz parte da equipe deste espaço." / "A equipe não avalia o próprio espaço."; espaço fora da vitrine (404) "Este espaço não está recebendo avaliações agora." |
| Enviando | Botão "Enviando…" (ou "Salvando…") desabilitado, com spinner de 16; estrelas, chips e campo continuam visíveis e travados (`editable={false}`) |
| Erro | `Alert` `destructive` acima do botão, no rodapé, com `role="alert"`; os dados ficam. Mensagens: sem conexão "Sem conexão. Sua avaliação não foi enviada. Tente de novo."; ao criar, `REVIEW_NOT_ELIGIBLE`/`REVIEW_NOT_ALLOWED`/404 com os textos acima; ao editar, `REVIEW_NOT_ALLOWED` leva ao estado só leitura (editar não cai em `REVIEW_NOT_ELIGIBLE`); `REVIEW_TAGS_MISMATCH` "Os destaques não combinam com a nota. Confira e envie de novo." (não deve acontecer, a tela já impede); outro "Não foi possível enviar agora. Tente de novo." |
| Sucesso (nova ou edição) | A tela troca o formulário por um estado centralizado: ícone `CircleCheck` de 48 em `success-subtle-foreground` sobre círculo `success-subtle` de 80, título "Obrigado pela avaliação!" (edição: "Avaliação atualizada"), texto "Ela já aparece na página do <espaço>." e os botões "Ver no espaço" (primário, abre `espaco/[slug]` com o bloco à vista) e "Fechar" (`ghost`, volta; sem histórico, vai ao Explorar). A nota escolhida aparece acima do título, em estrelas `summary`. Invalida resumo, lista, elegibilidade, Minhas avaliações e o card da reserva |
| Sair com alterações | `Alert` "Descartar a avaliação?" / "O que você escolheu não será enviado." / [Continuar avaliando] [Descartar] |

- **Catálogo de chips** (fixo; a AV.2 cria o enum `review_tag` com estes ids, na ordem da tabela, que é a ordem da tela). Os pares positivo/negativo têm a mesma posição, para o painel comparar elogio e crítica do mesmo assunto:

| # | Positivo (nota 4–5) | id | Negativo (nota 1–3) | id |
|---|---|---|---|---|
| 1 | Quadra boa | `GOOD_COURT` | Quadra ruim | `BAD_COURT` |
| 2 | Bom atendimento | `GOOD_SERVICE` | Atendimento ruim | `BAD_SERVICE` |
| 3 | Limpo | `CLEAN` | Sujo | `DIRTY` |
| 4 | Bom custo-benefício | `GOOD_VALUE` | Caro | `EXPENSIVE` |
| 5 | Fácil de reservar | `EASY_BOOKING` | Difícil de reservar | `HARD_BOOKING` |
| 6 | Boa iluminação | `GOOD_LIGHTING` | Iluminação ruim | `BAD_LIGHTING` |
| 7 | Horário respeitado | `ON_TIME` | Atraso no horário | `DELAYS` |
| 8 | Boa estrutura | `GOOD_FACILITIES` | Estrutura ruim | `POOR_FACILITIES` |

  - "Atraso" do briefing virou "Atraso no horário" (sozinho, não diz de quem foi o atraso) e ganhou o par "Horário respeitado". "Boa estrutura"/"Estrutura ruim" cobrem vestiário, banheiro, estacionamento e bar, que não cabem nos outros. "Fácil/Difícil de reservar" vale para o app e para o atendimento do espaço.
  - Sem chips de aula ou professor: o catálogo é o mesmo para jogador e aluno, e um chip de aula na avaliação de quem só alugou seria ruído. Comentário cobre o resto.
  - Rótulo de no máximo 20 caracteres, sem emoji. Os rótulos ficam em `packages/shared` junto do enum (`REVIEW_TAG_LABELS`), para o web e o app usarem os mesmos.

#### (4) Card "Avalie sua experiência" (reserva e aula passadas)

No detalhe da reserva (`reserva/[id]`) logo **abaixo do card principal** (espaço, data, quadra), e no detalhe da aula (`aulas/[id]`) logo abaixo do card da sessão.

**Quando aparece:** o uso já terminou (`endsAt` no passado) há no máximo 6 meses, a reserva está `CONFIRMED` ou `COMPLETED` (a aula não foi cancelada e a presença da pessoa é `CONFIRMED` ou `PRESENT`), e `GET …/reviews/eligibility` responde `canReview` (ou traz `myReview`). Sem resposta da elegibilidade (carregando ou erro), o card não aparece: ele é convite, não pode empurrar a tela nem mostrar erro.

```
┌ Card (raio 16, p-4, gap-3) ──────────────┐
│ Avalie sua experiência                   │  `large` (18/28 600)
│ Como foi jogar no Arena Beach? Toque     │  14/20 muted (aula: "Como foi a aula no …?")
│ numa estrela.                            │
│ ☆   ☆   ☆   ☆   ☆                        │  `prompt`: 32 em alvos de 44, à esquerda
└──────────────────────────────────────────┘
```

- **Um toque grava, só para criar:** o card mostra as estrelas só quando a pessoa ainda não tem avaliação do espaço. Tocar na estrela N pinta até N, chama `PUT …/reviews/me` **no modo só-criar** (`?createOnly=true`, que nunca sobrescreve uma avaliação existente) só com `rating: N` e, com sucesso, abre `espaco/[slug]/avaliar` em modo de edição com o aviso "Nota salva. Quer contar mais?". Se a pessoa voltar sem mexer, a nota fica. Mesma acessibilidade das estrelas da tela de avaliar (`radiogroup` "Sua nota para <espaço>").
- **Gravando:** as estrelas ficam pintadas até a tocada e travadas, com o texto da segunda linha trocado por "Salvando sua nota…". **Erro:** as estrelas voltam a vazias e a segunda linha vira o `InlineError` "Não foi possível salvar a nota. Tente de novo." (o motivo da API quando for `REVIEW_NOT_ELIGIBLE` ou `REVIEW_NOT_ALLOWED`, e aí o card some na próxima carga). **409 `REVIEW_ALREADY_EXISTS`** (a pessoa avaliou por outro caminho, ex. pelo push, com esta tela aberta): não é erro e não navega. O card recarrega a elegibilidade e passa ao estado "Sua avaliação" abaixo, com a nota que já existia, e mostra por 4 s a linha 14/20 `text-muted-foreground` "Você já tinha avaliado este espaço.".
- **Já avaliou** (`myReview`): o card vira uma linha compacta, "Sua avaliação" (`large`) à esquerda e "Editar" (botão `ghost` `sm`, `text-link`) à direita; abaixo, as 5 estrelas `item` e o rótulo da nota ("Bom") em 14/20 `text-muted-foreground`. "Editar" abre a tela de avaliar; no estado só leitura (equipe), o botão é "Ver" e abre a tela só leitura. Nesse estado as estrelas não são tocáveis: mudar a nota é na tela de avaliar. `testID` `reserva-avaliacao` (o card) e `reserva-avaliacao-estrela-N`.
- Reserva cancelada, no-show ou futura: nada (a elegibilidade é do espaço, mas o convite só faz sentido no uso que deu certo).

#### (5) Bloco "Avaliações" na página do espaço

**App:** entre os serviços (Alugar/Aulas) e o "Sobre" (`SpaceInfo`), com o título `SpaceSection` "Avaliações" (`large`, `role="heading"`) e `px-4`. **Web pública:** seção `id="avaliacoes"` na coluna principal, depois de "Infraestrutura", com o título `h2` `text-h3`. As duas trazem o mesmo conteúdo.

**Com resumo (`count` ≥ 5):**

```
Avaliações
┌ Card (raio 16, p-4) ─────────────────────────┐   app (empilhado)
│ 4,8   ★★★★★                                  │  média 40/44 display 700 · estrelas `summary` (20)
│       23 avaliações                          │  14/20 muted
│                    ↕ 16                      │
│ 5 ★ ███████████████████████████░░░░░  18     │  barras: trilho muted, barra primary, 8 de altura
│ 4 ★ ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░   3     │
│ 3 ★ █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   1     │
│ 2 ★ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0     │
│ 1 ★ █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   1     │
│ ──────────────────────────────────────────── │  border-t, pt-3
│ Mais citados                                 │  overline muted
│ (👍 Quadra boa 12) (👍 Limpo 9) (👎 Caro 4)  │  etiquetas, não interativas
└──────────────────────────────────────────────┘
[         Avaliar este espaço         ]           botão de contorno 48 (se pode avaliar)
(item) (item) (item)                             3 comentários mais recentes, divididos por border-t
Ver todas as 23 avaliações  ›                    link 16/24 600 `text-link`, alvo 44
```

- **Média:** número com uma casa e vírgula, `font-display` 700, 40/44 no app e 48/56 no web, `text-foreground`, `tabular-nums`. 5 estrelas `summary` com meias (`starFills`) e "23 avaliações" (ou "1 avaliação") em 14/20 `text-muted-foreground`. **App:** empilhado: a média à esquerda e, ao lado (12 de distância), as estrelas sobre o total; a distribuição vem abaixo (16), na largura toda, para as barras terem ~220 em 360 dp. **Web ≥ 640 px:** lado a lado, a coluna da média com 160 (`reviewLayout.summaryAsideWidth`; média, estrelas e total empilhados) e as barras à direita; abaixo de 640, como no app. Rótulo do bloco: "Nota 4,8 de 5, 23 avaliações".
- **Distribuição:** 5 linhas, de 5 para 1, com 6 entre elas. Cada linha: o número (14/20 500 `text-foreground`, 28 de largura com a estrela `badge` cheia depois), a barra (`flex-1`, 8 de altura, `rounded-full`, trilho `bg-muted`, barra `bg-primary` com largura = contagem ÷ total, mínimo de 4 quando a contagem é > 0) e a contagem (14/20 `text-muted-foreground` `tabular-nums`, 32 de largura, à direita). No card, o trilho `muted` se separa do card pelo tom (bg/raised sobre bg/surface), e a barra tem ≥ 7:1 com o trilho. Cada linha tem o rótulo "5 estrelas: 18 avaliações" e as barras são decorativas. No web, uma `<ul>` com `<li>` por linha (texto visível em `sr-only` onde precisar).
- **Mais citados:** rótulo `overline` `text-muted-foreground` "Mais citados" e até 3 etiquetas (`reviewLayout.topTagsCount`) na ordem da API: o `Badge` `sport` do app (neutro, pílula; web: `Chip` como `span`) com o ícone `ThumbsUp` (positivo) ou `ThumbsDown` (negativo) de 14 em `text-muted-foreground`, o rótulo e a contagem em 500 `tabular-nums` ("Quadra boa 12"). O ícone diz se é elogio ou crítica sem depender de cor. Rótulo de acessibilidade: "Quadra boa, citado 12 vezes". Sem chips citados, a linha e o divisor saem.
- **Botão "Avaliar este espaço"** (sem avaliação) ou **"Editar minha avaliação"** (com `myReview`; **"Ver minha avaliação"** no estado só leitura): botão de contorno 48, largura toda no app, abaixo do card. Só com `canReview` ou `myReview` (RF-REVIEW-02): deslogado, equipe ou sem uso, o botão não aparece. No **web** não há avaliação: no lugar do botão, uma linha 14/20 `text-muted-foreground` "Jogou aqui? Avalie pelo app." com "pelo app" como link para `appDeepLink(slug)` + `/avaliar` (o mesmo esquema do "Abrir no app").
- **Comentários recentes** (RF-REVIEW-03): os **3 comentários mais recentes** (`reviewLayout.recentCount`), isto é, as 3 avaliações mais novas **com comentário visível**; avaliação só com nota e chips, ou com comentário oculto pela moderação, não entra aqui (aparece em "Ver todas"). Formato do item (abaixo), separados por `border-t border-border` com 16 de cada lado. No web, sem card em volta; no app também (o card é só do resumo). Sem nenhum comentário visível, a área não aparece.
- **"Ver todas as N avaliações"** (link com `ChevronRight` 16; web: link para `/espacos/<slug>/avaliacoes`). Aparece sempre que o total (`count`) for maior que o número de comentários mostrados acima: avaliações só com nota ficam acessíveis por aqui.

**Sem resumo (`count` 0–4):**

```
Avaliações
┌ Card ────────────────────────────────────────┐
│ [Novo]  Ainda poucas avaliações              │  badge info + 16/24 foreground
│ A nota aparece a partir de 5 avaliações.     │  14/20 muted
└──────────────────────────────────────────────┘
[         Avaliar este espaço         ]
(item) (item)                                    os comentários visíveis que houver (até 3)
```

- Com 0 avaliações, o texto do card é "Ninguém avaliou ainda." / "Jogou aqui? Sua avaliação ajuda outros jogadores." (a segunda linha só para quem pode avaliar; os outros veem "A nota aparece a partir de 5 avaliações."). Sem distribuição nem chips: com tão poucas, as barras mostrariam cada nota individual com cara de estatística.
- **Carregando:** no app, `Skeleton` do card (altura 168, raio 16) e de 2 itens (linhas de 14 e 48); no web o bloco vem do servidor. **Erro** (só no app; o resumo é independente da página): o bloco mostra "Não foi possível carregar as avaliações." com "Tentar de novo" (`ghost`), sem derrubar a página.

**Item de avaliação** (bloco, lista "Ver todas", Minhas avaliações e painel):

```
(AS) Ana S.  [Jogou aqui]                    ⋮     avatar 36 · nome 14/20 600 · badge muted · menu 44
     ★★★★☆ · há 3 dias                             estrelas `item` · 14/20 muted
     (Quadra boa) (Limpo)                          etiquetas, gap 6
     A quadra estava ótima e o pessoal foi         comentário 16/24 (web 14/20), até 4 linhas
     super atencioso. Voltaremos!…  Ler mais       (web 6) e "Ler mais" text-link
     ┌──────────────────────────────────────┐
     │ (logo 20) Resposta do Arena Beach ·  │     recuo 48; bg-muted, raio 12, p-3
     │ há 1 dia                             │     14/20 600 + muted
     │ Valeu, Ana! Esperamos vocês de novo. │     14/20 (app 16/24) foreground
     └──────────────────────────────────────┘
```

- **Autor:** `UserAvatar` de 36 (foto ou iniciais; o mesmo componente do Perfil). Nome formatado pela API ("Ana S."), 14/20 600 `text-foreground`, 1 linha. Ao lado, o selo do uso: `Badge` `muted` "Jogou aqui" (`PLAYER`) ou "Aluno" (`STUDENT`), com ícone `LandPlot` ou `GraduationCap` de 12 antes do texto. **Conta excluída:** avatar com o ícone `User` de 18 em `text-muted-foreground` sobre `bg-muted`, nome "Usuário removido" em 14/20 500 `text-muted-foreground`, sem selo.
- **Nota e data:** 5 estrelas `item` (`aria-hidden`), " · " e a data relativa em 14/20 `text-muted-foreground`. Rótulo da linha: "4 de 5 estrelas, há 3 dias (12/10/2026)". Data relativa a partir do `createdAt` em `America/Sao_Paulo`, por dia de calendário: "hoje", "ontem", "há N dias" (2–6), "há N semana(s)" (7–29 dias, divisão inteira por 7), "há N mês(es)" (30–364 dias, divisão inteira por 30), "há N ano(s)". A data completa (dd/mm/aaaa) vai no rótulo de acessibilidade e no `title`/`<time dateTime>` do web. Editar a avaliação **não** muda a data. **Marca "editada":** quando há resposta do espaço e o `updatedAt` da avaliação é posterior ao `reply.repliedAt`, a linha ganha " · editada" (mesmo estilo), com o rótulo de acessibilidade e o `title` "Editada depois da resposta do espaço", porque a resposta pode se referir a um texto que mudou. Sem resposta, ou editada antes dela, nada (o histórico de versões não é guardado).
- **Etiquetas (chips):** os chips escolhidos, na ordem do catálogo, como etiquetas não interativas (`Badge` `sport` no app, `Chip` `span` no web), 6 entre elas, sem ícone de polegar (no item, a nota já diz o tom).
- **Comentário:** 16/24 `text-foreground` no app e 14/20 no web, quebras de linha preservadas (`whitespace-pre-line`), até 4 linhas no app e 6 no web (`reviewLayout.commentClampLines`) com "Ler mais" (`text-link` 500, alvo 44 no app), que expande no lugar ("Ler menos" volta). Sem comentário: a linha não existe.
- **Comentário oculto:** no lugar do texto, uma linha com `EyeOff` de 14 e "Comentário oculto pela moderação." em 14/20 itálico `text-muted-foreground`. A nota e as etiquetas continuam. No leitor de tela: "Comentário oculto pela moderação".
- **Resposta do espaço:** recuada 48 (alinhada ao texto do autor, `reviewLayout.item.replyIndent`), `bg-muted rounded-md p-3 gap-1`. Cabeçalho: `SpaceAvatar` de 20, "Resposta do <espaço>" 14/20 600 `text-foreground` (nome com reticências), " · há 1 dia" `text-muted-foreground`. Texto 16/24 no app e 14/20 no web, `text-foreground`, mesmo corte e "Ler mais" do comentário. Rótulo do bloco: "Resposta do Arena Beach, há 1 dia: …". No web, `<blockquote>`-like `div role="group" aria-label="Resposta do <espaço>"`.
- **Menu** (`EllipsisVertical` de 20, botão `ghost` de 44, canto superior direito, `accessibilityLabel="Mais opções da avaliação de Ana S."`): só para quem está logado.
  - De outra pessoa: "Denunciar avaliação" (abre o diálogo de (9)). **"Denúncia enviada"** (item desabilitado) é **estado local** da tela, ligado depois do sucesso ou do 409 de denúncia repetida; não vem da API e não persiste: ao reabrir a tela, o menu volta a "Denunciar avaliação", e uma nova tentativa recebe o 409, que mostra "Você já denunciou esta avaliação." e marca o item de novo.
  - A minha (só no app): o item é o meu quando o `id` dele é igual a `eligibility.myReview.id` (a lista pública não traz id de usuário). Mostra o selo `info` "Sua avaliação" ao lado do nome, e o menu tem "Editar" e "Excluir" (o mesmo fluxo da tela de avaliar; no estado só leitura, só "Excluir"). Nunca "Denunciar".
  - Deslogado: sem menu (o espaço fica vazio, a linha do nome vai até a borda).
  - **Web pública:** sem o ramo "a minha" (o jogador não usa o web logado). O menu aparece para quem tem sessão no web e tem só "Denunciar avaliação", com o mesmo estado local de "Denúncia enviada".
  - App: menu nativo do RN Reusables (`DropdownMenu`) ou `ActionSheetIOS`/sheet; web: `DropdownMenu` do shadcn.
- **Espaços:** avatar → texto 12; nome → estrelas 2; estrelas → etiquetas 8; etiquetas → comentário 8; comentário → resposta 12. Item → item: divisor `border-t border-border` com 16 de cada lado.

#### (6) Lista "Ver todas"

**App:** rota `espaco/[slug]/avaliacoes`, `ScreenHeader` "Avaliações", `FlashList` com cursor (20 por página, `reviewLayout.pageSize`).
- **Cabeçalho da lista** (`ListHeaderComponent`, `px-4 pt-4 gap-3`): linha resumida "★ 4,8 · 23 avaliações" (ou o badge "Novo") e, abaixo, a faixa de filtro.
- **Filtro por nota:** faixa horizontal de `Chip` de escolha única (`role="radiogroup"`, "Filtrar por nota"), sem barra: "Todas" (padrão), "5 ★", "4 ★", "3 ★", "2 ★", "1 ★" (a estrela é a `badge` cheia, rótulo "5 estrelas"). Com resumo, cada chip mostra a contagem da distribuição ("5 ★ 18"), e chip com 0 fica desabilitado; sem resumo, os chips não têm contagem e ficam todos ativos. O filtro vai na URL (`?nota=5`), para o "voltar" e o deep link manterem.
- **Itens:** o item de (5), com `px-4` e divisor.
- **Paginação:** carrega a próxima página a 1 tela do fim (`onEndReachedThreshold={1}`); rodapé com `ActivityIndicator` enquanto carrega; erro no rodapé: "Não foi possível carregar mais." + "Tentar de novo". Fim da lista: nada.
- **Estados:** carregando (primeira página) 3 esqueletos de item; vazio sem filtro "Ninguém avaliou ainda" (`EmptyView`); vazio com filtro "Nenhuma avaliação com 2 estrelas" + botão "Ver todas" (limpa o filtro); erro `ErrorView` com tentar de novo. Puxar para atualizar recarrega do começo.
- `review.replied` abre esta rota com `?avaliacao=<id>` e rola até o item (destaque de 2 s com `bg-accent` no item; sem destaque com "reduzir movimento"). Se o item não estiver na primeira página, abre "Minhas avaliações" no item.

**Web:** página `/espacos/<slug>/avaliacoes` (renderizada no servidor; título "Avaliações de <espaço>"; indexação no item SEO abaixo), com o breadcrumb "‹ <espaço>", o resumo do bloco (5) no topo, o filtro e a lista.
- **Filtro:** os mesmos chips, como links (`<a href="?nota=5">`, `aria-current="true"` no ativo; estilo `ChipButton` selecionado). Funciona sem JavaScript.
- **Paginação:** os 20 primeiros vêm do servidor; no fim, o botão de contorno "Carregar mais avaliações", que é um link `?nota=…&cursor=…` melhorado pelo cliente: com JS, busca e acrescenta na mesma página (foco no primeiro item novo, `aria-live="polite"` com "20 avaliações carregadas"); sem JS, navega para a página seguinte, que mostra só aquela página e um link "‹ Voltar ao começo".
- **SEO:** a página sem `cursor` é a única indexável. Toda URL com `?cursor=` leva `robots: noindex, follow` e `canonical` para a primeira página (`/espacos/<slug>/avaliacoes`, sem `cursor` e sem `nota`), para o buscador não indexar páginas que mudam a cada avaliação nova. A página com só `?nota=` também aponta o `canonical` para a primeira página sem filtro.
- Largura do conteúdo `max-w-3xl`; itens com divisor como no app.

#### (7) Painel `/painel/avaliacoes`

Item "Avaliações" (ícone `Star`) no grupo **Gestão** da sidebar, depois de "Contatos" e antes de "Espaço", visível para Dono, Admin e Professor (permissão de ver da matriz da AV.2). Página no padrão do painel: título `font-display text-h3` "Avaliações", subtítulo `text-muted-foreground` "O que jogadores e alunos dizem do <espaço>. As respostas são públicas.".

**Faixa de indicadores** (`StatCard` em `grid gap-4 sm:grid-cols-3`):

| Card | Valor | Linha de apoio |
|---|---|---|
| Média | "4,8" `font-display` 30/36 700 + estrelas `summary` | "Aparece no app e no site" (≥ 5) ou "Aparece no app a partir de 5 avaliações (faltam 2)" (< 5, o painel mostra a média mesmo assim; com 0, "—"). Espaço fora da vitrine (`showcase.visible` falso no `getManagedSpace` ou no `superGetSpace`): "Não aparece no app nem no site: espaço fora da vitrine", seja qual for o total (com 5 o público continuaria sem ver a nota) |
| Total | "23" | "5 sem resposta" como link que liga o filtro "Sem resposta" (ou "Todas respondidas") |
| Últimos 90 dias | "4,6" (média das avaliações criadas no período; "—" sem nenhuma) | "12 avaliações · geral 4,8" e o gráfico de tendência abaixo |

- **Tendência de 90 dias:** sem biblioteca de gráficos (o web não tem): colunas semanais em `div`s (`flex items-end gap-1`, 48 de altura), a semana mais recente à direita. A altura é a média da semana na escala 1–5 (1 = 20%, 5 = 100%), cor `bg-chart-1`, raio 2 no topo; semana sem avaliação = traço de 2 em `bg-border`. Cada coluna com `title` e o conjunto com `role="img"` e `aria-label` "Média semanal dos últimos 90 dias, de 4,2 a 5,0" + uma tabela `sr-only` (semana, média, quantidade). **Os pontos vêm prontos da API:** use a série semanal (`trend.granularity = WEEK`), uma coluna por ponto, **quantos vierem** (13 é o normal, mas não fixe o número), na ordem da API com o mais recente à direita, sem agrupar nem completar no cliente. Ponto sem avaliação (média nula ou contagem 0) = o traço de 2.

**Segunda faixa** (`grid gap-4 lg:grid-cols-2`):
- **Distribuição** (card "Notas"): as barras de (5), com a contagem e o percentual ("18 · 78%").
- **Mais citados** (card "Destaques"): duas colunas, "Elogios" (`ThumbsUp`) e "Críticas" (`ThumbsDown`), cada uma com até 5 chips do grupo em linhas "Quadra boa ……… 12" (rótulo 14/20 à esquerda, contagem `tabular-nums` à direita, `justify-between`). Vazio: "Nenhum destaque escolhido ainda".

**Lista** (card com a barra de filtros no topo):
- **Filtros:** `Select` "Nota" (Todas, 5 estrelas … 1 estrela) e o `ChipButton` "Sem resposta" (`aria-pressed`), à esquerda; à direita, "23 avaliações" (`text-muted-foreground`). Na URL (`?nota=&sem-resposta=1`).
- **Itens:** o item de (5) em densidade de painel (texto 14/20, comentário sem corte), com a coluna de ações abaixo do comentário:
  - Sem resposta: botão de contorno `sm` "Responder" (`MessageSquareReply`).
  - Com resposta: o bloco da resposta e, abaixo dele, os botões `ghost` `sm` "Editar resposta" e "Remover resposta". Remover confirma com o `ConfirmDialog`: "Remover a resposta?" / "Ela sai da página do espaço e do app." / [Cancelar] [Remover].
  - Menu `⋯`: "Denunciar avaliação" (o diálogo de (9)); "Denúncia enviada" desabilitado é estado local depois do sucesso ou do 409, como no item público.
- **Compositor da resposta** (abre no lugar do botão, no próprio item; um aberto por vez):

```
┌ Responder como Arena Beach Savassi ─────────────────────────┐   rótulo 14/500 com SpaceAvatar 20
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Obrigado pela visita, Ana! …                            │ │   Textarea, 3 linhas, cresce até 8
│ └─────────────────────────────────────────────────────────┘ │
│ A resposta é pública e aparece com o nome do espaço. 42/500 │   dica + contador
│                                [Cancelar] [Publicar resposta] │   ghost + primário (sm)
└─────────────────────────────────────────────────────────────┘
```

  - `Field` do web com `Textarea` (`maxLength` 500, contador como no app), foco no campo ao abrir. "Publicar resposta" (editar: "Salvar resposta") desabilitado só enquanto envia ("Publicando…"); vazio dá o erro de campo "Escreva a resposta". `Esc` ou "Cancelar" fecha; com texto digitado, pergunta "Descartar a resposta?". Sucesso: o compositor fecha, a resposta aparece no item e o toast "Resposta publicada" (editar: "Resposta atualizada"; remover: "Resposta removida"). Erro: `FormError` dentro do compositor, texto mantido.
- **Professor:** a mesma página sem "Responder", "Editar resposta", "Remover resposta" e sem o menu; no topo, `Alert` `info`: "Você vê as avaliações do espaço. Só o Dono e os Administradores respondem." Os filtros e indicadores ficam iguais.
- **Modo suporte (Super):** vale como Dono, com a faixa do modo suporte de sempre.
- **Estados:** carregando, `Skeleton` dos 3 cards e de 3 itens; sem avaliações, `EmptyState` "Nenhuma avaliação ainda" / "Quem joga ou faz aula aqui recebe um pedido de avaliação cerca de 2 horas depois."; filtro sem resultado, "Nenhuma avaliação com esses filtros" + "Limpar filtros"; erro, o `ErrorState` do painel. Paginação: "Carregar mais" no fim da lista (cursor), 20 por vez.

#### (8) Super

Item "Avaliações" (ícone `Star`) na navegação do Super, depois de "Anúncios". Mesmos tokens do painel.

- **Fila de denúncias** (`/super/avaliacoes`): `Tabs` de status na URL (`?status=OPEN` padrão): "Abertas", "Resolvidas", "Descartadas". Tabela (cabeçalho compacto do Super):

| Coluna | Conteúdo |
|---|---|
| Recebida | data e hora (dd/mm/aaaa HH:mm) |
| Espaço | nome (link para "Avaliações por espaço") |
| Avaliação | estrelas `item` + as 80 primeiras letras do comentário (ou "Sem comentário" / "Comentário oculto" em `muted`) |
| Motivo | rótulo do motivo; com texto, ícone `MessageSquareText` e o texto no `title` |
| Denunciante | nome do usuário, ou "Espaço · <nome>" quando a denúncia veio da gestão |
| Status | badge: `OPEN` "Aberta" (`warning`), `RESOLVED` "Resolvida" (`success`), `DISMISSED` "Descartada" (`muted`) |

  A linha inteira abre o detalhe. Paginação por cursor ("Carregar mais"). Vazio em "Abertas": "Nenhuma denúncia aberta".
- **Detalhe** (`/super/avaliacoes/<reviewId>`): duas colunas em ≥ 1280 px (uma em telas menores).
  - Esquerda: o item completo como aparece em público (com o comentário mesmo quando oculto, em `bg-muted` e com o selo `muted` "Oculto"), o espaço (link), o autor com o nome **completo** e o link para o usuário no Super, a data de criação e a de edição. Autor bloqueado (`author.blocked`, ou a avaliação com `counted` falso): selo `muted` com ícone `Ban` **"Autor bloqueado · fora da média"** ao lado do nome, com o `title` "A nota desta pessoa não entra na média enquanto ela estiver bloqueada." (RN-REVIEW-03).
  - Direita: card "Denúncias" (todas, da mais nova à mais antiga: motivo, texto, denunciante, data e status, com "Descartar" `ghost` `sm` em cada aberta) e card "Histórico de moderação" (linha do tempo da auditoria: "Ocultado por <nome> · 04/11/2026 14:32 · Motivo: …", "Reexibido…", "Denúncia descartada…").
  - Ações no topo da página: "Ocultar comentário" (contorno com texto `destructive`; só com comentário visível) ou "Reexibir comentário" (contorno; só com comentário oculto). As duas abrem o `ReasonDialog` com **motivo obrigatório** (`Textarea`, até 500, erro "Escreva o motivo"; vai para a auditoria, não para o autor): "Ocultar o comentário?" / "A nota e os chips continuam valendo. As denúncias abertas desta avaliação são resolvidas." e "Reexibir o comentário?" / "Ele volta a aparecer no app e no site.". "Descartar" pergunta "Descartar esta denúncia?" com o motivo opcional. Toasts: "Comentário ocultado", "Comentário reexibido", "Denúncia descartada".
  - Avaliação sem comentário: "Ocultar comentário" não aparece (não há o que ocultar; a nota não sai, decisão 103).
- **Avaliações por espaço** (`/super/espacos/<id>/avaliacoes`, link "Avaliações" no detalhe do espaço no Super, com a nota e o total, "4,8 (23)", ou só o total abaixo de 5, "(3)"; sem avaliações, só "Avaliações"): os indicadores e a lista do painel (7), só leitura para a resposta (responder é no modo suporte), com o filtro a mais "Com comentário oculto" e, em cada item, o link "Moderar" para o detalhe acima, o selo `warning` "N denúncias abertas" quando houver e o selo `muted` "Autor bloqueado · fora da média" quando a nota não conta. O mesmo selo aparece na coluna "Avaliação" da fila de denúncias. No painel do espaço e nas telas públicas ele não existe (a avaliação de autor bloqueado segue as regras da AV.2 para aparecer ou não).

#### (9) Denunciar (app e web)

- **App:** sheet (`BottomSheet` do app; aqui sim: é curta, abre sobre a lista e não tem teclado na maior parte do uso), título "Denunciar avaliação" e o texto "A equipe da Space Sports analisa cada denúncia. A avaliação continua no ar enquanto isso.". **Web:** `Dialog` do shadcn com o mesmo conteúdo (no painel, o título é o mesmo e o texto diz "…analisa a denúncia. O espaço não apaga avaliações.").
- **Motivo** (obrigatório, `radiogroup` "Motivo"), um cartão de opção por linha (altura mínima 48, rádio à esquerda, rótulo 16/24 no app e 14/20 no web, explicação curta em `text-muted-foreground`):

| Valor | Rótulo | Explicação |
|---|---|---|
| `SPAM` | Spam ou propaganda | Divulga outro negócio ou não tem a ver com o espaço |
| `OFFENSIVE` | Ofensivo ou discriminatório | Xinga, ameaça ou discrimina alguém |
| `FALSE_INFO` | Informação falsa | Conta algo que não aconteceu |
| `PERSONAL_DATA` | Expõe dados pessoais | Telefone, endereço ou nome completo de alguém |
| `OTHER` | Outro motivo | Conte nos detalhes |

- **Detalhes:** `Field` "Detalhes (opcional)", multilinha (3 linhas), até 500 com contador. Com `OTHER`, o rótulo vira "Detalhes" com a dica "Conte o que há de errado" (continua opcional para a API).
- **Botões:** "Enviar denúncia" (primário; não `destructive`: denunciar não apaga nada) e "Cancelar". Enviar sem motivo: erro de grupo "Escolha um motivo". **Enviando:** "Enviando…". **Sucesso:** fecha e mostra "Denúncia enviada. Obrigado por avisar." (app: `Alert` `success` no topo da lista por 4 s ou o toast do app quando existir; web: toast `sonner`); o menu do item passa a "Denúncia enviada" (estado local, não persiste). **Erros:** já denunciou (409) "Você já denunciou esta avaliação." (fecha e marca o item, também só localmente); a própria avaliação "Você não pode denunciar a sua avaliação."; outros "Não foi possível enviar a denúncia. Tente de novo." no topo do diálogo, com os dados mantidos.

#### (10) Minhas avaliações (Perfil do app)

- **Entrada:** `MenuRow` "Minhas avaliações" (ícone `Star`) no Perfil, logo depois de "Meus pagamentos". Rota `(conta)/minhas-avaliacoes`, `ScreenHeader` "Minhas avaliações", `FlashList` com cursor.
- **Item** (card raio 16, `p-4 gap-3`): cabeçalho com `SpaceAvatar` 40 + nome do espaço (16/24 600) + bairro · cidade (14/20 muted) e o menu `⋮` ("Editar", "Excluir", "Ver no espaço"); abaixo, as estrelas `item` · data relativa; etiquetas; comentário (corte de 4 linhas); resposta do espaço (como em (5)). Tocar no card abre a tela de avaliar em modo de edição. Editar vale a qualquer tempo (RN-REVIEW-01).
  - Só leitura (a pessoa está na equipe do espaço; `canEdit` falso no item de `GET /v1/me/reviews`, ou o 403 ao salvar): o menu fica "Excluir" e "Ver no espaço", sem "Editar", e tocar no card abre a tela só leitura.
  - Comentário oculto: o texto da pessoa aparece (se a API devolver), em `text-muted-foreground`, com a linha `EyeOff` "Oculto pela moderação: só você vê este comentário. A nota continua valendo.".
  - Espaço fora da vitrine: o card fica, sem "Editar" nem "Ver no espaço", com a linha `muted` "Este espaço não está mais no app.".
- **Excluir:** o mesmo `Alert` da tela de avaliar; o item sai da lista.
- **Estados:** carregando, 3 esqueletos de card; vazio, `EmptyView` "Você ainda não avaliou nenhum espaço" / "Depois de jogar ou ter aula, a gente pede sua opinião."; erro, `ErrorView`.

#### (11) Nota no Explorar: filtro e ordem (app, decisão 109, RF-REVIEW-10)

Na folha de filtros do Explorar (`FiltersSheet`, `BottomSheet` "Filtros"), com os mesmos componentes que ela já usa: título de grupo `Text variant="small"` e `Chip` `pill` (neutro; Sol só no selecionado, tokens `chip*`, nos dois temas, prancha 06 no claro e 07 no escuro). Nenhum token novo.

```
Filtros
Ordenar por
[● Mais perto] [  Melhor avaliados ]          chips de rádio (radiogroup)
Distância
[2 km] [5 km] [● 10 km] [25 km] [50 km]       (só com localização, como antes)
Nota
[★ 4+ estrelas]                               chip de caixa de seleção (liga e desliga)
Esporte · Serviço · Infraestrutura            (sem mudança)
[ Limpar ]  [ Ver espaços ]
```

- **"Ordenar por"** (primeiro grupo, `role="radiogroup"`): "Mais perto" (padrão, `sort` não vai na query) e "Melhor avaliados" (`sort=rating`). Sem localização, a API ordena por nome, e o primeiro chip diz **"Por nome"** em vez de prometer distância. Só um marcado por vez; não há "desmarcar".
- **"Nota"** (grupo `role="group"`): um chip só, **"4+ estrelas"** (`minRating=4`), com `role="checkbox"` e `aria-checked`. A estrela (`Star` 16, cheia) vai **na cor do texto do chip** (`chip-foreground`; selecionado, `chip-selected-foreground`), e não no `rating`: o Sol da estrela de nota sumiria no fundo Sol do chip selecionado. Os pares do chip já têm contraste testado nos dois temas.
- **Conta como filtro**: os dois entram no selo do botão de filtros (`countActiveFilters`), em "Limpar" (volta a "Mais perto" e tira o "4+ estrelas", mantendo a busca por nome) e escondem o carrossel e os recentes, com o título "Resultados", como esporte, serviço e infraestrutura ([Explorar e anúncios](#explorar-e-anúncios), tabela de estados). "Mais perto" não conta.
- **Mapa** (`context="map"`): só o "4+ estrelas" vale. A folha não mostra "Ordenar por", o selo não conta a ordem e "Limpar" não mexe nela (a ordem escolhida no Explorar continua lá). Sem pins com o "4+ estrelas", o aviso ganha: "O “4+ estrelas” só mostra espaços com nota (a partir de 5 avaliações)." (`mapa-vazio`).
- **Lista vazia com o "4+ estrelas"** (`EmptyView`), em dois casos (AV2.3):
  - **Só o "4+ estrelas" ligado** (sem busca por nome e sem outro filtro; a ordem não conta, porque não tira espaço da lista; `isOnlyMinRatingOn`): `explorar-vazio-nota`, no lugar do vazio genérico. Título "Nenhum espaço com 4+ estrelas"; texto "O filtro “4+ estrelas” só mostra espaços com nota, e a nota aparece a partir de 5 avaliações. Tire o filtro para ver também os espaços novos."; botão `outline` "Tirar “4+ estrelas”" (`explorar-vazio-tirar-nota`).
  - **"4+ estrelas" com busca por nome ou outro filtro** (esporte, serviço, infraestrutura ou raio): o vazio genérico (`explorar-vazio`), título "Nenhum espaço encontrado", com o texto "Tente outro nome ou afrouxe os filtros. O “4+ estrelas” só mostra espaços com nota (a partir de 5 avaliações)." e dois botões `outline` empilhados e centrados (`gap-2`): "Tirar “4+ estrelas”" (`explorar-vazio-tirar-nota`, tira só esse filtro; a busca e o resto continuam) e "Limpar filtros" (`explorar-vazio-limpar`).
  - **"Limpar filtros" do vazio** (com ou sem o "4+ estrelas") volta tudo ao padrão, **inclusive a busca por nome** (diferente do "Limpar" da folha, que mantém a busca); com busca digitada, o rótulo vira "Limpar busca e filtros". Sem o "4+ estrelas", segue o vazio genérico de antes, com esse botão.
  - Nos dois temas, só componentes já usados: `EmptyView` (título `large`, texto `muted`) e `Button` `outline`; nada de cor nova.
- **Rótulo do botão de filtros** para leitor de tela: "Filtros, 1 ativo" / "Filtros, N ativos".
- **testIDs:** `filtros-ordem-distancia`, `filtros-ordem-nota`, `filtros-nota-4`, `filtros-limpar`, `filtros-ver-espacos`; `explorar-vazio-nota`, `explorar-vazio`, `explorar-vazio-tirar-nota`, `explorar-vazio-limpar`; `mapa-vazio`.

#### Notificações e textos

| Tipo | Para | Título | Texto | Abre |
|---|---|---|---|---|
| `review.request` | Jogador/aluno | Como foi no <espaço>? | Dê sua nota em poucos segundos. | `espaco/[slug]/avaliar` |
| `review.created` | Dono e Admin | Nova avaliação: ★ 4 | O <espaço> recebeu uma avaliação. Toque para ver e responder. | `/painel/avaliacoes` (no app, só o item na central) |
| `review.replied` | Autor | Resposta à sua avaliação | O <espaço> respondeu sua avaliação. Toque para ver a resposta. | `espaco/[slug]/avaliacoes?avaliacao=<id>` |

- **Nenhum texto escrito por usuário** no título ou no corpo (RF-REVIEW-09): nem comentário, nem resposta, nem o nome do autor. Só a nota e o nome do espaço. A notificação fica gravada na central e no aparelho, e um texto copiado ali escaparia da moderação (comentário oculto depois) e da anonimização da conta (RN-REVIEW-06). O conteúdo aparece só ao abrir a avaliação.

- **Tipos na API** (`NOTIFICATION_TYPES`): `REVIEW_REQUEST`, `REVIEW_CREATED` e `REVIEW_REPLIED` (os nomes `review.*` acima são os eventos).
- **Preferências:** "Pedidos de avaliação" (`review.request`, jogador), "Respostas às suas avaliações" (`review.replied`, jogador) e "Avaliações novas do espaço" (`review.created`, gestão), na lista de preferências que já existe, com a mesma linha (rótulo + `Switch`).
- Na central, o ícone do item é `Star` (pedido e nova) e `MessageSquareReply` (resposta).

#### Implementação no web (AV.3)

- **Sessão na página pública:** `/espacos/<slug>` e `/espacos/<slug>/avaliacoes` ficam fora do `matcher` do `proxy.ts` e são renderizadas no servidor sem ler cookies (cache de 5 min da página e de 60 s das avaliações, para SEO). Como o cookie de sessão é `HttpOnly`, quem decide se há sessão é o browser, com um `GET /v1/me` pelo rewrite de `/v1` (`useWebSession`, sem repetir e sem redirecionar no 401). Com sessão, o item ganha o menu "Denunciar avaliação"; sem sessão (ou enquanto a resposta não chega), o menu não aparece. Quem entra no web como jogador vai para `/sem-acesso`, mas o cookie continua valendo e a pessoa vê o "Denunciar" (a API aceita a denúncia de qualquer conta logada).
- **Rótulos:** "Ver a avaliação" quando o total é 1. Nas notas sem avaliação do filtro "Ver todas", o chip fica desabilitado, sem link (tokens `disabled`).
- **Painel:** a contagem à direita dos filtros vem do resumo (total, `unansweredCount` ou a linha da distribuição); com nota e "Sem resposta" juntos ela não aparece, porque a lista por cursor não tem total. O rótulo do compositor é "Responder como <espaço>", sem a logo de 20 (o `Field` só aceita texto). "Descartar a resposta?" usa o `ConfirmDialog` ("O texto escrito será perdido."). Os filtros guardam estado local e o espelham na URL, para duas mudanças seguidas não se perderem.
- **Super:** a fila tem a data como link para o detalhe, e a linha inteira também abre. Na lista por espaço há também o filtro "Com denúncia aberta" (`reported=true`). Os indicadores de "Avaliações por espaço" são "Média" e "Na média" (com "N fora da média (autor bloqueado)", de `uncountedCount`), sem o card "Últimos 90 dias": o resumo do Super não traz a tendência. O link "Avaliações" do detalhe do espaço mostra "4,5 (23)" (ou "(3)" abaixo de 5, como o card da vitrine). Cada denúncia resolvida ou descartada mostra o motivo (`resolutionReason`) abaixo da data.
- **Linha de apoio da "Média"** (painel e Super): com 5 ou mais e o espaço fora da vitrine (`publicSummaryVisible` falso), "Não aparece no app nem no site: espaço fora da vitrine".
- **Preferências de notificação:** o web não tem essa tela; os tipos novos ficam só no app.

#### Resumo de testIDs (app) e `data-testid` (web)

`avaliar-estrela-N`, `avaliar-chip-<ID>`, `avaliar-comentario`, `avaliar-enviar`, `avaliar-excluir`, `avaliar-sucesso`; `reserva-avaliacao`, `reserva-avaliacao-estrela-N`, `aula-avaliacao`; `espaco-avaliacoes` (bloco), `espaco-avaliar`, `espaco-avaliacoes-ver-todas`, `avaliacao-item-<id>`, `avaliacao-menu-<id>`; `avaliacoes-filtro-N`; `selo-avaliacao` (card e callout), `selo-novo`; `filtros-ordem-distancia`, `filtros-ordem-nota`, `filtros-nota-4`, `explorar-vazio-nota`, `explorar-vazio-tirar-nota` (Explorar, (11)); `denuncia-motivo-<VALOR>`, `denuncia-enviar`; `minhas-avaliacoes`. No web, os mesmos nomes em `data-testid`, mais `painel-avaliacoes-responder-<id>` e `super-avaliacao-ocultar`.

#### Implementação no app (AV.4)

O que a implementação do app definiu além do que está acima:
- **Menu do item** (`⋮`): a sheet do app (`BottomSheet`), montada só enquanto aberta ou fechando, com "Editar"/"Excluir" (a minha) ou "Denunciar avaliação"/"Denúncia enviada". Excluir pela lista mostra o aviso `success` "Sua avaliação foi excluída." por 4 s, no lugar do de denúncia.
- **Ação do menu depois que ele fecha** (AV.6c): no iOS, abrir o `Alert` de excluir ou a folha de denúncia no mesmo toque em que outro Modal fecha falha sem erro. O `useMenuSheet` (`components/bottom-sheet.tsx`) guarda a escolha, fecha a folha e só roda a ação no `onDismissed` da `BottomSheet`: no iOS, o `onDismiss` do Modal, com reserva de 500 ms (`IOS_DISMISS_FALLBACK_MS`); nas outras plataformas, no tick seguinte. Vale para o menu do item (bloco e "Ver todas") e para o de Minhas avaliações (inclusive "Editar" e "Ver no espaço"). O `InteractionManager` saiu do React Native 0.88, por isso a reserva é por tempo. A folha "Foto do perfil" de Editar perfil usa o mesmo padrão (AV2.3): "Tirar foto" e "Escolher da galeria" só abrem o seletor de imagem depois que a folha some, e toques durante o fechamento são ignorados. "Remover foto" fica fora da folha (botão da tela com `Alert`) e não muda.
- **"Ver no espaço"** (sucesso da tela de avaliar) volta à página do espaço com `?avaliacoes=1`, que rola até o bloco.
- **Destino guardado do deep link** `espacos/<slug>/avaliar` deslogado: o mesmo armazenamento do `espacos/<slug>`, com o valor `<slug>/avaliar`; o `EntryGate` abre a tela de avaliar depois do login.
- **Push e central:** `REVIEW_REQUEST` (dados com `promptId` e `slug`) abre `espaco/[slug]/avaliar`; `REVIEW_REPLIED` (`slug` e `reviewId`) abre `espaco/[slug]/avaliacoes?avaliacao=<id>`, que rola até o item da primeira página e o destaca por 2 s (sem destaque com "reduzir movimento" ou leitor de tela); fora da primeira página, troca para `minhas-avaliacoes?avaliacao=<id>`, que carrega até 5 páginas (`TARGET_MAX_PAGES`) atrás do item, rola até ele e o destaca; sem achar, fica a lista do começo. `REVIEW_CREATED` não navega no app. A central ainda não tem ícone por tipo (o item segue com o ponto de não lida).
- **Preferências:** `REVIEW_CREATED` só aparece para quem é Dono ou Admin de algum espaço (permissão `review.reply`), como os avisos da gestão do pagamento online.
- **Atualização do selo depois de criar, editar ou excluir** (AV.6c): além do resumo, da lista, da elegibilidade, de Minhas avaliações e da página do espaço, `useInvalidateReviews` invalida as buscas da vitrine (prefixo `['spaces', 'search']`, do Explorar e do mapa) e os Espaços recentes (`/v1/me/recent-spaces`). Os anúncios ficam de fora (limite de 60 buscas por minuto); o card patrocinado atualiza na próxima abertura do Explorar.
- **Selo:** `RatingBadge` usa o `testID` recebido nos dois estados (média e "Novo"); sem `testID`, `selo-avaliacao` e `selo-novo`. O card patrocinado passa `<testID>-nota`.
- **Minhas avaliações:** "bairro · cidade" (ou só a cidade) sob o nome, de `space.neighborhood` e `space.city` do item de `GET /v1/me/reviews`, com `spaceLocationLabel`.
- **"Ver todas as N avaliações"** concorda com o total (`seeAllReviewsLabel`): com uma só (fora das recentes), "Ver a avaliação", como o web (AV2.3).
- **testIDs a mais:** `reserva-avaliacao-editar` e `reserva-avaliacao-nota` (e os mesmos com `aula-`) no estado "Sua avaliação"; `avaliar-rotulo-nota`, `avaliar-erro-nota`, `avaliar-contador`, `avaliar-nota-salva`, `avaliar-aviso-oculto`, `avaliar-erro`, `avaliar-so-leitura`, `avaliar-bloqueado`, `avaliar-ver-no-espaco`; `espaco-nota` (linha do cabeçalho), `avaliacoes-resumo`, `avaliacoes-media`, `avaliacoes-novo`, `avaliacoes-lista`, `avaliacoes-filtro-todas`, `avaliacoes-limpar-filtro`; `avaliacao-minha-<id>`, `avaliacao-denunciar-<id>`, `avaliacao-denunciada-<id>`, `avaliacao-editar-<id>`, `avaliacao-excluir-<id>`; `denuncia-detalhes`; `minhas-avaliacoes-item-<id>`, `minhas-avaliacoes-menu-<id>`, `minhas-avaliacoes-editar-<id>`, `minhas-avaliacoes-excluir-<id>`, `minhas-avaliacoes-ver-espaco-<id>`, `minhas-avaliacoes-local-<id>`, `minhas-avaliacoes-lista`; `mapa-callout`.
- **Maestro:** o `Alert` nativo não tem `testID`; o botão de confirmar é localizado por `android:id/button1` (o positivo, último botão do `Alert.alert`) junto com o texto. O contador `avaliar-contador` tem `accessibilityLabel` ("32 de 500 caracteres", atualizado 0,8 s depois da digitação), que no iOS substitui o texto "32/500": os fluxos conferem o `testID` com o rótulo. `avaliacoes-lista.yaml` confere a média 4,2 e as 6 avaliações da Arena E2E do seed.

### Estrutura de navegação e telas
- Cards da vitrine com foto 4:5, nome, nota ("★ 4,8 (23)" ou "Novo") + bairro + distância, chips de esportes e "R$ X/h".
- Barra inferior do app: **Explorar · Mapa · Agenda (minhas reservas/aulas) · Perfil**. Usuários de gestão ganham uma aba **Meu Espaço**. A aba **Torneios** existe, mas fica oculta com o resto de torneio no app (aba, filtro, serviço nos cards, página do espaço): para voltar, ligue `FEATURES.tournaments` em `apps/mobile/src/lib/features.ts`.
- Cabeçalho fixo das abas do app (`TabHeader`, sob a área segura): logo horizontal no Explorar e título (`h3`) nas outras abas, à esquerda; sino à direita (`NotificationBell`, alvo de 44pt) com contador de não lidas (acima de 99, "99+"), que abre `/notificacoes` e relê o contador ao voltar. No Perfil ficam só as preferências de notificação.
- Página do espaço no app, de cima para baixo: galeria; nome, local e esportes; grade de informações rápidas (`QuickInfo`, ícone + rótulo curto: preço, quadras, horário de hoje, duração); serviços; na aba Alugar, botões de reserva e mensalista, regras em lista compacta e quadras; Avaliações (resumo ou "Novo", avaliar, 3 recentes, ver todas); depois Sobre (recolhido em 3 linhas se for longo), Comodidades, Horários (bloco recolhível), Pagamento no espaço, Contato (WhatsApp em destaque) e Localização (prévia do mapa, endereço, Como chegar e Waze). Cada bloco só aparece com dado preenchido (doc 08).
- Datas no app: sempre dd/mm/aaaa, por `lib/datetime.ts`, com o dia da semana quando ajuda (`Seg, 02/11/2026`). O ano só sai nos chips de data da reserva (`formatDayCompact`), em que a janela é curta. Competência de mensalidade é mês, não data, e segue `nov 2026`.
- Máscaras do app: `maskPhone` (`@space-sports/shared`), com `keyboardType="phone-pad"`; o valor vai à API em E.164 (`phoneToE164`, validado pelo `brazilianPhoneSchema`). A única data digitada é o nascimento, em dd/mm/aaaa com teclado numérico (`maskBirthDate`, em `features/profile/birth-date.ts`), enviada como `yyyy-MM-dd`. O app não tem campo de CPF, CEP nem valor.
- Painel do espaço (`/painel`): sidebar com seletor de espaço no topo; seções Hoje, Agenda, Reservas (avulsas, mensalistas), Aulas (Turmas, Sessões, Planos, Alunos, Mensalidades, Professores), Torneios, Recebimentos, Recebimentos online (Dono/Admin: carteira, contestações, configuração), Contatos, Avaliações (Dono/Admin respondem; Professor só lê), Espaço (dados, fotos, quadras, configurações), Equipe.
- Painel Super (`/super`): mesmas cores do painel do espaço; diferencia-se pela navegação e pelo rótulo "Painel da plataforma". Seções: Dashboard, Espaços, Implantações, Financeiro (consolidado), Pagamento online (receita, taxas, cadastros, simulador), Usuários, Contatos, Anúncios, Avaliações (denúncias e moderação), Catálogos, Auditoria.
- Anúncios no `/super` (AD.3, RF-ADS-01, 02, 03 e 09; decisões 73 a 76), em `/super/anuncios`:
  - **Abas Campanhas | Anunciantes**: a URL é a fonte única da aba (`?aba=anunciantes`) e do filtro de anunciante (`?anunciante=<id>`, que é o link do número de campanhas na lista de anunciantes e abre as campanhas filtradas). Trocar de aba entra no histórico (voltar/avançar trocam a aba); trocar o anunciante no seletor substitui a URL. `?anunciante=` que não é UUID é ignorado.
  - **Anunciantes:** busca por nome e filtros de tipo, categoria e situação; tabela com tipo, categoria, contato comercial, nº de campanhas e o badge Ativo/Inativo. Criar/editar num diálogo: tipo em `OptionCards` (Empresa ou Espaço; não muda depois), no tipo Espaço o seletor do espaço (busca entre os espaços ativos e `<select>` nativo; o nome do espaço preenche o nome do anunciante e a categoria vira "Espaço esportivo"), categoria só com as permitidas (a dica lembra que apostas e álcool não anunciam), contato (nome, e-mail, telefone com máscara) e observações. Desativar e reativar pedem confirmação; o erro da API (ex.: `AD_SPACE_NOT_FOUND` ao reativar anunciante de espaço suspenso, `ADVERTISER_SPACE_TAKEN`) aparece no diálogo.
  - **Campanhas:** busca (campanha ou anunciante) e filtros de anunciante, vaga, status e "no ar agora"; tabela com vaga, período (horário de Brasília), peças ativas, peso, o **selo de situação** e "Duplicar". Selo a partir do status e dos motivos de `delivery` da API, nesta ordem: "Arquivada" (neutro); "No ar" (`success`); o status escolhido pelo Super, "Pausada" (`warning`) e "Rascunho" (neutro), mesmo sem peças; "Encerrada" (neutro); "Anunciante inativo" (`destructive`); "Sem peças" (`warning`); "Agendada" (`info`); e, para campanha ativa fora do ar sem motivo conhecido, "Fora do ar" (neutro). O `title` do selo diz por que está fora do ar.
  - **Formulário da campanha** (`/super/anuncios/campanhas/nova` e `/[id]/editar`): anunciante (não muda depois), nome, vaga em `OptionCards` com a explicação e o formato da imagem (travada quando a campanha tem peças), início e fim com `DatePicker` + `TimeInput` em horário de Brasília (enviados em UTC), cidades e esportes em `ChipButton` (nenhum marcado = todos), peso de 1 a 10 e o status inicial (rascunho, ativa ou pausada). Na edição o status muda pelos botões do detalhe.
  - **Detalhe da campanha** (`/super/anuncios/campanhas/[id]`): selo e motivo no cabeçalho, botões de status (Ativar, Pausar, Arquivar, conforme a transição permitida, com confirmação; arquivar é definitivo), Editar e Duplicar; dados da campanha; abas **Peças** e **Relatório** (`?aba=relatorio`).
  - **Peças:** lista ordenada com miniatura na proporção da vaga ("Capa do espaço" quando a peça não tem imagem), título, texto, botão e destino (aviso `warning` quando o espaço de destino está fora da vitrine), badge Ativa/Inativa, botões de subir/descer (a ordem só organiza a lista; a entrega sorteia), Editar e Ativar/Desativar.
  - **Editor da peça** (`.../pecas/nova` e `.../pecas/[id]`): imagem (o mesmo recorte da foto de perfil, `ImageCropDialog`, na proporção da vaga; o recorte menor que o mínimo da vaga não deixa enviar; o arquivo sai na proporção exata, sem ampliar, até 1600 px no banner e 1080 no card, e cai para JPEG se passar de 2 MB; se nem assim couber, o diálogo diz que a imagem passou de 2 MB e mantém os controles para ajustar ou trocar o arquivo), orientação de enquadramento da seção "Contraste conferido", título, texto e botão com contador de caracteres, destino em `OptionCards` (Site com URL `https://`, WhatsApp com máscara e mensagem pronta, ou Espaço com o seletor; com o espaço de destino fora da vitrine, um `Alert` `warning` avisa que a peça não é entregue e diz o que falta) e "Peça ativa". Anunciante Espaço com destino no próprio espaço pode ficar sem imagem (aviso e botão "Usar a capa do espaço"). Ao lado (≥ 1600 px) ou abaixo, a pré-visualização descrita em [Pré-visualização no `/super`](#pré-visualização-no-super-ad3-rf-ads-03) (componentes em `components/super/ads/ad-preview.tsx`). Se a API responder `AD_PLACEMENT_CHANGED` (ou outro erro de imagem), a imagem enviada é descartada e a mensagem pede o envio de novo.
  - **Relatório:** período com `DateRangePicker` (padrão da API: do início da campanha até hoje), totais em `StatCard` (impressões, cliques, CTR), tabela por dia e por peça e "Exportar CSV" (o CSV da API, nome `anuncio-<campanha>-<de>_<até>.csv`). Sem gráfico: o web não tem biblioteca de gráficos instalada.
  - Erros da API em português claro (`lib/super/ads.ts`, `adErrorMessage`), destacando o campo quando há um (categoria, espaço, período, vaga, imagem).
- Conta no web (decisões 64 a 71):
  - **Cadastro** em duas etapas: "Conta" em `/cadastro` (nome, e-mail, telefone obrigatório com a máscara `phone`, senha e confirmação; o e-mail fica travado quando vem do convite de equipe) e, com a conta criada, "Sobre você" em `/cadastro/sobre-voce?next=…`, rota própria que sobrevive ao recarregamento (nascimento com `DatePicker` `yearDropdown`, gênero em `Select` nativo, esportes do catálogo em `ChipButton` com o nível opcional em `Select` ao lado de cada um), com "Salvar e continuar" e "Pular" (botão `ghost`). Depois, a confirmação do e-mail com o `next` de antes.
  - **Completar cadastro** (`/completar-cadastro`): cartão das telas públicas que pede só o que falta em `profile.missing` (nome e/ou telefone), com "Continuar" e "Sair". O `proxy.ts` leva para lá quem abre `/painel` ou `/super` com o cadastro incompleto. Conta sem nada de "Sobre você" (a do Google ou uma antiga) passa uma vez por essa etapa, com "Pular".
  - **Meu perfil** (`/painel/perfil` e `/super/perfil`, o mesmo componente), pelo menu da conta da barra superior, que mostra a foto (ou as iniciais, `UserAvatar`, círculo em `secondary`) ao lado do nome. Cartões: Foto (enviar/trocar abre o diálogo "Recortar foto": quadro arrastável com o mouse ou o toque, controles deslizantes nativos de zoom e de posição horizontal e vertical para o teclado e o leitor de tela, e o círculo `ring-primary` que mostra o recorte; a saída mantém o formato da imagem, então PNG e WebP não perdem a transparência; remover pede confirmação), Dados pessoais (nome, telefone com a dica "não verificado", nascimento, gênero e esportes; "Salvar alterações" só com mudança e "Descartar"), E-mail (só leitura, selo `success` "Verificado" ou `warning` "Não verificado" com "Reenviar verificação") e Senha (senha atual, nova e confirmação; conta só Google vê o texto de que o login é pelo Google).
  - No Super, o telefone do usuário (lista e detalhe) leva o selo `muted` "Não verificado" enquanto não for confirmado por SMS.
- Conta no app (decisões 64 a 71), nas telas de auth (`AuthLayout`: logo vertical, título e subtítulo):
  - **Cadastro** (`(auth)/cadastro`) em duas etapas na mesma rota: "Conta" (nome, e-mail, telefone obrigatório com `maskPhone` e senha; Google/Apple abaixo, quando habilitados) e, com a conta criada, "Sobre você": nascimento (campo `Field` com máscara), gênero em `Chip` de escolha única (tocar de novo desmarca), esportes do catálogo em `Chip` de múltipla escolha e, para cada esporte escolhido, um cartão "Nível em <esporte>" com os níveis em `Chip` (opcional), com "Salvar e continuar" e "Pular" (`ghost`). O voltar do sistema nessa etapa vale como "Pular". Depois, a confirmação do e-mail por cima das abas, como antes.
  - **Completar perfil** (`completar-perfil`): pede só o que falta em `profile.missing` (nome e/ou telefone), com "Continuar" e "Sair"; é a única rota liberada até completar. Conta sem nada de "Sobre você" (a do Google ou uma antiga) passa uma vez por essa etapa, com "Pular".
  - **Aba Perfil**: foto (ou iniciais, `UserAvatar`, o mesmo círculo da logo do espaço) de 64 pt ao lado do nome, e-mail e telefone; no menu, "Editar perfil" e "Alterar senha".
  - **Editar perfil** (`(conta)/editar-perfil`): foto de 96 pt no topo com "Adicionar/Trocar foto" (`BottomSheet` "Foto do perfil" com "Tirar foto" e "Escolher da galeria"; o recorte quadrado é o do sistema) e "Remover foto" (`Alert` de confirmação), com "Enviando foto…" e o erro abaixo; nome, telefone (validado só se mudar), E-mail só leitura com o `Badge` `success` "Verificado" ou `warning` "Não verificado" e "Reenviar verificação", os campos do "Sobre você", "Salvar" e o atalho para "Alterar senha".
  - **Alterar senha** (`(conta)/alterar-senha`): senha atual, nova e confirmação; ao concluir, aviso `success` de que as outras sessões foram encerradas. Conta só Google vê o texto de que o login é pelo Google, sem formulário.

## Telas principais (para o designer)

**App:** Onboarding/login · Permissão de localização · Vitrine · Filtros · Mapa · Página do espaço · Fluxo de reserva (esporte → data/duração/horário → quadra → pessoas → forma de pagamento: no local, Pix ou cartão → confirmação) · Pagar com Pix · Pagar com cartão · Convidar jogadores / dividir conta · Solicitar mensalista · Minhas reservas · Planos e turmas do espaço · Contratar plano (escolher turmas fixas) · Meu plano (mensalidades, cancelamento) · Aulas da semana · Detalhe da aula (lista de presença, confirmar/desistir, lista de espera) · Torneios · Detalhe do torneio/chave · Inscrição em dupla (convite ao parceiro) (ocultos por enquanto) · Perfil · Meus pagamentos (comprovante) · Avaliar o espaço · Avaliações do espaço (ver todas) · Minhas avaliações · Notificações · *(visão de equipe, só leitura)* Hoje, listas de presença, horários, placar.

**Painel do espaço:** Login · Seleção de espaço · Hoje · Agenda por quadra · Reserva de balcão · Aprovações (mensalistas, matrículas) · Mensalistas (mensalidades) · Quadras · Configurações (preço/hora, valor geral do mensalista, prazos, modo da lista de presença) · Turmas · Sessões/listas · Planos · Alunos e matrículas · Mensalidades/inadimplentes · Professores/Equipe · Torneios (criar, categorias, inscrições de duplas, sorteio, agenda de jogos, placares) · Recebimentos · Recebimentos online (cadastro, formas de pagamento, carteira, contestações, estorno) · Avaliações (indicadores, lista, responder) · Página pública do espaço · Página pública da chave.

**Conta (web, `/painel` e `/super`):** Cadastro (Conta → Sobre você) · Completar cadastro · Meu perfil (foto com recorte, dados pessoais, e-mail, senha).

**Conta (app):** Cadastro (Conta → Sobre você) · Completar perfil · Perfil (foto ou iniciais) · Editar perfil (foto pela câmera ou galeria, dados, e-mail, Sobre você) · Alterar senha.

**Painel Super:** Dashboard (espaços, usuários, uso) · Espaços (lista, detalhe, suspender/reativar, modo suporte) · Implantação (checklist) · Financeiro consolidado (recebimentos registrados) · Pagamento online (receita, taxas, cadastros no gateway, simulador) · Avaliações (fila de denúncias, ocultar/reexibir, por espaço) · Usuários · Catálogos (esportes, infraestrutura, cidades) · Auditoria.

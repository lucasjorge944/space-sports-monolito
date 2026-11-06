# Auditoria do web contra o kit de marca (tarefa 2.34)

Data: 2026-10-29. Base: `main` em `fd4c1de` (depois das tarefas 2.27, 2.28 e 2.33). Web rodando com a API simulada do e2e (`e2e/mock-api.mjs`), viewport 1440×900, temas claro e escuro. Referência: `docs/brand/kit/` (prancha 04 paleta, 06 componentes no claro, 07 tema escuro e tabela de tokens dos dois temas).

**Esta lista é a especificação da tarefa 2.35 (web).** Cada linha diz o que fazer e com quais classes. "ui-tokens" = já feito nesta tarefa (2.34); "web" = fica para a 2.35. Os tokens novos estão em `packages/ui-tokens/generated/theme.css` e `super.css` e na [seção "Diretrizes visuais" do `docs/05-design-system.md`](../05-design-system.md#diretrizes-visuais).

## Resumo

O que já segue o kit: a paleta semântica (bg/base, surface, raised, texto, ação, link, status), a logo, as fontes, os status tingidos, o botão primário e o destaque, o anel de foco Sol com offset e os raios. **Não há hex nem classe da paleta padrão do Tailwind nas telas** (a varredura de `apps/web/src` só encontrou as primitivas `mar-*`, `sol-*`, `neutral-*` em três arquivos e opacidades sobre tokens).

Por que o web ainda "não parece a marca":

1. **A marca só aparece nos botões.** O item ativo da sidebar é cinza (`sidebar-accent`, bg/raised), os títulos de card e os rótulos de número são cinza, as tabelas não têm cabeçalho no estilo do kit, os gráficos usam `primary` e o campo em foco não tem o fundo Sol 50 da prancha 06. Telas inteiras (Hoje, Turmas, Relatórios) ficam neutras, como um shadcn padrão.
2. **Diálogos, sheets e alert-dialogs estão em `bg-background`** (bg/base), e não em bg/surface como a prancha 07 pede ("Cards, sheets"). No escuro o diálogo tem a mesma cor do fundo da página.
3. **Faltavam tokens** para peças que o kit desenha: botão Escuro, chip e chip selecionado, campo (fundo e foco), desabilitado, rótulo de seção (eyebrow), hover de link e o véu dos diálogos. O web resolveu com primitivas e `dark:` (chip, foco do campo grande) ou com opacidade (`/90`, `/50`, `/40`, scrim provisório no `globals.css`).
4. **A escala tipográfica não é a do kit no painel:** títulos de página em `text-3xl`/`text-2xl` soltos, e a regra global `h1, h2, h3 { font-display }` deixa rótulos pequenos (títulos de card usados como rótulo, "Turmas ativas", "Reservas hoje") em Space Grotesk de 14 px, que é para títulos.
5. **Bug no `super.css`** (corrigido nesta tarefa): os tokens que o Super troca só no claro (ex.: `--ring-offset: #F7F9FA`) vazavam para o Super escuro, porque a regra `.super` vencia a herança do `.dark`. O anel de foco do Super escuro tinha uma faixa clara; agora a faixa é o fundo.

## Tokens novos (ui-tokens, feito)

Acréscimos; nenhum nome existente mudou. Classes do Tailwind v4 entre crases.

| Token (classe) | Claro | Escuro | Super | De onde vem |
|---|---|---|---|---|
| `inverse` / `-foreground` (`bg-inverse text-inverse-foreground`) | `#06202E` / `#FFFFFF` | `#F2F6F8` / `#06202E` | herda | Botão "Escuro" (Noite + branco), prancha 06. No escuro inverte: Noite sumiria no fundo |
| `disabled` / `-foreground` | `#DCE3E6` / `#66757D` | `#1E4152` / `#7F949F` | herda | Botão "Indisponível", prancha 06. Escuro derivado (borda do kit e o `#7F949F` da tabela da 07) |
| `link-hover` (`hover:text-link-hover`) | `#033A54` | `#C2DCEA` | herda | `a:hover` das pranchas (Mar 700); no escuro Mar 100 |
| `eyebrow` (`text-eyebrow`) | `#03547D` | `#FCCD45` | `#6D28D9` / `#A78BFA` | Rótulo acima do título ("04 · Interface" na 06, "05 · Tema" na 07). Use com `text-overline uppercase` |
| `input-background` (`bg-input-background`) | `#FFFFFF` | `#12313F` | herda | Campo da 06 (branco) e da 07 (bg/raised) |
| `input-focus` (`focus-visible:border-input-focus`) | `#03547D` | `#8FBFD8` | `#6D28D9` / `#A78BFA` | "Estado em foco: borda Mar" (06). No escuro o tom do link: o anel já é Sol |
| `input-focus-background` (`focus-visible:bg-input-focus-background`) | `#FFF8E1` | `#12313F` | `#F4F1FB` / `#12313F` | "…fundo Sol 50" (06). O kit não traz o foco no escuro: fica bg/raised |
| `chip` / `-foreground` / `-border` | `#FEECB3` / `#033A54` / `#FEECB3` | `#12313F` / `#F2F6F8` / `#1E4152` | herda | Chips de esporte não selecionados (06: Sol 100 + Mar 700; 07: raised com borda) |
| `chip-selected` / `-foreground` | `#06202E` / `#FFFFFF` | `#FBBD10` / `#06202E` | herda | Chip selecionado (06: Noite; 07: Sol + Noite) |
| `scrim` (`bg-scrim`) | `#06202E99` (Noite 60%) | `#000000CC` (preto 80%) | herda | Véu de diálogo e sheet. Único token com alfa (`#RRGGBBAA`) |

Também verificados e **sem mudança de valor**: todos os tokens existentes batem com a tabela da prancha 07; os desvios já documentados continuam (borda de campo `input`, erro no claro, sucesso/alerta com texto Noite, `ring-offset`). Sombras: já no tom Noite; o kit não usa sombra em cards (só borda) e quase nenhuma no escuro, o que vira regra de uso abaixo, sem token novo.

## Componentes (`apps/web/src/components/ui`)

| Peça | Como está | Como o kit pede | Correção (web, 2.35) |
|---|---|---|---|
| Botão primário | `bg-primary text-primary-foreground`, `rounded-md` (12), `font-semibold`; painel `h-9 text-sm`, público `xl` 48 | 06: Mar + branco, 48, raio 12, Inter 16/600; 07: Sol + Noite | OK. Manter a densidade do painel (`h-9`) e `size="xl"` nas páginas públicas e telas de entrada |
| Botão destaque (`secondary`) | Sol + Noite / Mar 400 + branco | 06 "Ver horários" Sol + Noite; 07 Mar 400 + branco | OK. Ver usos em "Tokens no propósito errado" |
| Botão escuro | **Não existe** | 06 "Entrar": Noite + branco | Nova variante `inverse`: `bg-inverse text-inverse-foreground hover:bg-inverse/90` |
| Botão contorno (`outline`) | `border-[1.5px] border-foreground bg-card`; escuro `dark:border-muted-foreground dark:bg-transparent` | 06: borda 1.5 Noite, fundo branco; 07: borda 1.5 `#A9BCC6`, transparente | OK (valores batem). Hover: `hover:bg-accent` |
| Botão ghost | `hover:bg-accent`, texto `foreground` | 06 "Cancelar": transparente, **texto Mar**, padding 16 | `text-link hover:bg-accent hover:text-link-hover`. Nos botões só de ícone (`size="icon*"`, ações de tabela) manter neutro: `text-muted-foreground hover:text-foreground` (via `compoundVariants`) |
| Botão desabilitado | `disabled:opacity-50` | 06 "Indisponível": fundo `#DCE3E6`, texto `#66757D` | Nas variantes cheias (`default`, `secondary`, `inverse`, `destructive`): `disabled:bg-disabled disabled:text-disabled-foreground disabled:opacity-100`. Em `outline`/`ghost`: `disabled:border-disabled disabled:text-disabled-foreground disabled:opacity-100` |
| Botão: estado inválido | `aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40` | — | Remover os `ring-destructive/*` (brigam com o anel de foco Sol); fica `aria-invalid:border-destructive` |
| Link | `text-link` + `hover:underline` (19 usos); "Esqueci minha senha" em `text-muted-foreground`; links da página pública (`app/(public)/espacos/[slug]/page.tsx` ~201–220) e de `presencas-view.tsx:370` sem `text-link` | 04/06/07: Mar no claro (`a:hover` Mar 700), `#8FBFD8` no escuro | Todo link de texto: `text-link hover:text-link-hover underline-offset-4 hover:underline`. Variante `link` do Button igual |
| Campo (`input`, `textarea`, `select`, gatilho do `select-menu`) | `border border-input bg-card dark:bg-muted shadow-xs`; foco `focus-visible:border-link` + anel; `FormField large` com `focus-visible:bg-sol-50 dark:focus-visible:bg-muted` | 06: 48, raio 12, borda 1.5 `#BCC6CB`, fundo branco; foco borda 2 Mar e fundo Sol 50. 07: fundo bg/raised, borda `#1E4152` | `border-[1.5px] border-input bg-input-background` (sem `dark:` e sem `shadow-xs`); foco `focus-visible:border-input-focus focus-visible:bg-input-focus-background` + `focusRing`, no painel e no público. Tirar o `bg-sol-50`/`dark:` do `FormField` (`components/auth/form-field.tsx:26`) e de `delete-account-request.tsx:135`. Altura: painel `h-9`, público `h-12` |
| Campo: rótulo, ajuda, erro | Rótulo `text-sm font-medium`; erro `text-destructive text-sm`; ajuda `text-muted-foreground text-xs` | 06: rótulo 14/500 Noite; ajuda 13 px; erro: o kit não desenha (usar o erro dos status) | OK. Erro: `aria-invalid:border-destructive` + mensagem `text-destructive text-sm` com ícone opcional. Remover `aria-invalid:ring-destructive/*` |
| Campo desabilitado | `disabled:opacity-50` | — (derivado do botão Indisponível) | `disabled:bg-disabled disabled:text-disabled-foreground disabled:border-disabled disabled:opacity-100` (ver "Nome" bloqueado em [formulario-claro](auditoria-web/formulario-claro.png)) |
| Checkbox, switch | Marcado `bg-primary`; switch com `dark:` no polegar | Ação principal (Mar/Sol) | OK nas cores. Switch: desmarcado `bg-input`, polegar `bg-card` nos dois temas (tirar os `dark:data-[state=*]`) |
| Chip de esporte (`chip.tsx`) | Primitivas e `dark:`: `bg-neutral-900 text-neutral-50 dark:bg-primary…` / `bg-sol-100 text-mar-700 dark:border-border dark:bg-muted…` | 06: selecionado Noite + branco, demais Sol 100 + Mar 700, pill, 14/500, padding 8/14. 07: selecionado Sol + Noite, demais raised + borda | `border bg-chip text-chip-foreground border-chip-border`; selecionado `bg-chip-selected text-chip-selected-foreground border-chip-selected`. Sem `dark:` e sem primitivas |
| Badge de status | `rounded-sm` (6), `text-xs font-semibold`, `-subtle` | 06/07: raio 6, 13/600, padding 4/10 | OK (densidade do painel mantém `text-xs`). Variante `secondary` (Sol) não é status: reservar a destaque ("Lotada" usa `warning`, correto) |
| Card | `rounded-lg border bg-card shadow-sm`; `CardTitle` `font-display font-semibold` (16) | 06: raio 16, borda 1 `#DCE3E6`, **sem sombra**; 07: surface + borda, elevação por superfície | Tirar `shadow-sm` do `Card`. `CardTitle`: `font-display text-lg font-semibold`. Rótulos de número (ver Telas) não são `CardTitle` |
| Card de quadra/espaço (público) | Lista de quadras em `bg-card rounded-xl border p-4` | 06: raio 24, foto em Sol (claro) / raised (escuro), chip do esporte sobre a foto, h3, horários em raised e o escolhido em Mar (Sol no escuro), preço em Space Grotesk | `rounded-xl` (24) só no card com foto do espaço/quadra; itens de lista em `rounded-lg`. Horários: `bg-muted` e o escolhido `bg-primary text-primary-foreground`; preço `font-display font-bold tabular-nums`. Não inventar dados |
| Tabela (`table.tsx`) | Cabeçalho `h-10 font-medium text-foreground`; linhas `hover:bg-muted/50` | 07 (tabela de tokens): cabeçalho 12/600, `+0.1em`, caixa alta, `#A9BCC6` (texto secundário), divisória mais forte | `TableHead`: `font-sans text-overline uppercase text-muted-foreground`; linha `hover:bg-muted` (sem `/50`); rodapé `bg-muted` |
| Abas (`tabs.tsx`) | Lista `bg-muted`; ativa `bg-background shadow-sm`, no escuro `dark:border-input dark:bg-input/30` | Sem abas no kit; padrão de seleção do kit: superfície mais clara (07) | Ativa `bg-card text-foreground shadow-sm` nos dois temas (sem `dark:` e sem `bg-input/30`) |
| Abas sublinhadas (`espaco-nav.tsx`) | Ativa `border-primary text-foreground` | — | OK (Mar no claro, Sol no escuro). Acrescentar `font-semibold` na ativa |
| Sidebar | Fundo `sidebar` (surface) e borda OK. **Item ativo em `sidebar-accent` (cinza)**; rótulo de grupo `text-xs font-medium text-sidebar-foreground/70` | Item ativo é seleção: o kit seleciona com a cor de ação (horário escolhido em Mar/Sol, chip em Noite/Sol). `sidebar-primary` já é "Item ativo" nos tokens | Ativo: `data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:font-semibold` (ícone herda). Hover segue `sidebar-accent`. Rótulo de grupo: `text-overline uppercase text-muted-foreground` (sem `/70`). No Super vira violeta sozinho |
| Cabeçalho de página | Painel `text-3xl font-semibold tracking-tight` (`components/painel/states.tsx:19`), Super `text-2xl` (`components/super/page-header.tsx:26`) | 05: h1 48, h2 36, h3 24/32 600 (Space Grotesk) | Painel e Super: `<h1 className="font-display text-h3">` (24/32, a densidade do painel). Seções (`h2` hoje em `text-xl font-semibold`): `font-display text-lg font-semibold`. Públicas: `text-h1`/`text-display` como já estão |
| Rótulo de seção (overline) | Não usado | 05: overline 12/16 600 `+0.12em` caixa alta; 06/07: rótulo de seção em texto secundário, eyebrow em Mar/Sol 300 | Rótulo: `font-sans text-overline uppercase text-muted-foreground`. Eyebrow acima de título das páginas públicas: `text-overline uppercase text-eyebrow` |
| Anel de foco | `focusRing` em quase tudo; `ring-destructive/*` em campos inválidos | 07: focus/ring Sol nos dois temas | OK com a receita. Tirar os `ring-destructive/*` |
| Diálogo, alert-dialog, sheet | **`bg-background`** (bg/base); véu `bg-scrim` com a variável provisória do `globals.css` | 07: sheets e cards em bg/surface; elevação por superfície | `bg-popover text-popover-foreground border` em `dialog.tsx:34`, `alert-dialog.tsx:52`, `sheet.tsx:56`. Apagar o bloco `--scrim` de `globals.css` (e o `--color-scrim` do `@theme inline`): o token já vem do `theme.css` |
| Popover, dropdown, select (conteúdo) | `bg-popover`, `rounded-md`, `shadow-md`; item destrutivo `focus:bg-destructive/10` | Surface | OK. Item destrutivo: `focus:bg-destructive-subtle focus:text-destructive-subtle-foreground` |
| Tooltip | `bg-foreground text-background` | Noite + branco (botão escuro) | `bg-inverse text-inverse-foreground` (mesmo valor, token certo) |
| Toast (`sonner.tsx`) | Tokens `popover` e `-subtle` | Status tingidos 06/07 | OK |
| Alert | `destructive`: `border-destructive/50 text-destructive` | Status tingidos | Variantes `destructive`, `warning`, `success`, `info`: `border-<status> bg-<status>-subtle text-<status>-subtle-foreground`. Usar nas telas que hoje montam o alerta à mão: `turmas-view.tsx:335`, `space-scope.tsx:70`, `agenda-view.tsx:251`, `dados-view.tsx:86` |
| Skeleton | `bg-accent` | — | `bg-muted` (o `accent` vira violeta no Super) |
| Gráficos | Barras de ocupação em `bg-primary` sobre `bg-muted` (`ocupacao-report.tsx:130`); `chart-1..5` sem uso | 04: séries Mar, Sol, neutro, sucesso, coral | Séries: `bg-chart-1`…`bg-chart-5` (fill/stroke `var(--chart-N)`), trilho `bg-muted` |

## Telas

| Tela | Como está | Correção (web) | Capturas |
|---|---|---|---|
| Login, cadastro, convite, recuperação | Próximo do kit: logo vertical, primário 48, contorno. "Esqueci minha senha" em cinza; campo em foco sem Sol 50 no escuro (fica raised, correto); erro com anel vermelho translúcido | Link com `text-link`; campo pela receita nova; botão "Entrar" pode usar `inverse` se a tela quiser o "Escuro" do kit, mas o primário Mar é o certo para a ação principal | [claro](auditoria-web/login-claro.png), [escuro](auditoria-web/login-escuro.png), [erro](auditoria-web/login-erro-claro.png) |
| Hoje | Rótulos dos cards ("Reservas hoje") em Space Grotesk 14 cinza via `CardTitle`; números em Space Grotesk; item ativo da sidebar cinza | Rótulo: `font-sans text-overline uppercase text-muted-foreground` (não `CardTitle`); número `font-display text-3xl font-bold tabular-nums`; sidebar ativa em `sidebar-primary`; `PageHeader` em `text-h3` | [claro](auditoria-web/hoje-claro.png), [escuro](auditoria-web/hoje-escuro.png) |
| Agenda | Reservas tingidas por status (OK); linha do agora em `bg-destructive`; coluna do dia de hoje marcada com `text-link` (`agenda-grid.tsx:107`), que é cor de link usada como destaque | OK nas cores das reservas. Hoje: `text-primary font-semibold` (Mar no claro, Sol no escuro; o link não é marcador de estado); linha do agora mantém `destructive` | [claro](auditoria-web/agenda-claro.png), [escuro](auditoria-web/agenda-escuro.png) |
| Aulas (Turmas) | Alerta de conflito montado à mão; tabela com cabeçalho comum; ações em ícones | Alert `warning`; `TableHead` no estilo do kit; ícones `ghost` neutros | [claro](auditoria-web/aulas-claro.png), [escuro](auditoria-web/aulas-escuro.png) |
| Relatórios | Rótulos dos números em Space Grotesk; barras em `primary` | Rótulos em overline; barras em `chart-1` | [claro](auditoria-web/relatorios-claro.png) |
| Formulário (Espaço › Dados) | Campos em `bg-card`/`dark:bg-muted`; "Nome" desabilitado por opacidade; aviso de vitrine montado à mão | Receita nova de campo e de desabilitado; Alert `success`/`warning` | [claro](auditoria-web/formulario-claro.png), [escuro](auditoria-web/formulario-escuro.png) |
| Diálogo (Nova turma) | Fundo bg/base; no escuro some no fundo; foco Sol visível | `bg-popover`; véu pelo token | [claro](auditoria-web/dialogo-claro.png), [escuro com foco](auditoria-web/dialogo-escuro.png) |
| Super | Violeta na primária e na sidebar (OK, não se confunde com a marca); item ativo em `sidebar-accent` (violeta claro); "Desbloquear" em `secondary` (Sol) ao lado de dois contornos | Item ativo `sidebar-primary` (violeta cheio); "Desbloquear" (`super/users/user-detail.tsx:116`) em `default` (violeta), já que o Sol é da marca do espaço; links continuam `text-link` (Mar) | [claro](auditoria-web/super-claro.png), [escuro](auditoria-web/super-escuro.png) |
| Página pública do espaço | h1 em Space Grotesk (OK); chip do esporte em Sol 100 (OK no claro, raised no escuro); botão 48 (OK); lista de quadras em `rounded-xl` | Chip pelos tokens novos; quadras da lista em `rounded-lg`; links da seção de contato com `text-link`; eyebrow opcional acima do nome (`text-eyebrow`) | [claro](auditoria-web/publica-claro.png), [escuro](auditoria-web/publica-escuro.png) |
| Faixa de suporte | `bg-primary` com botão `secondary` (Mar + Sol no claro, Sol + Mar 400 no escuro: par aprovado do kit, 4.8:1) | OK | — |

## Cores fixas e tokens no propósito errado

| Onde | O quê | Correção |
|---|---|---|
| `app/globals.css` | `--scrim` provisório (`neutral-900` 60% / `black` 80%) | Apagar; usar o token `scrim` |
| `components/ui/chip.tsx:20-21` | Primitivas `neutral-900`, `neutral-50`, `sol-100`, `mar-700` + `dark:` | Tokens `chip*` |
| `components/auth/form-field.tsx:26`, `components/account/delete-account-request.tsx:135` | `focus-visible:bg-sol-50` + `dark:focus-visible:bg-muted` | `focus-visible:bg-input-focus-background` (já no `Input`) |
| `button.tsx` | `hover:bg-primary/90`, `hover:bg-secondary/80`, `hover:bg-destructive/90` | Aceito (opacidade sobre token, contraste conferido); trocar `secondary/80` por `/90` para igualar |
| `table.tsx`, `session-card.tsx:17` | `hover:bg-muted/50`, `hover:bg-accent/40` | `hover:bg-muted` / `hover:bg-accent` sem opacidade |
| `tabs.tsx` | `dark:bg-input/30` (borda de campo usada como fundo) | `bg-card` |
| `sidebar.tsx` | `text-sidebar-foreground/70` no rótulo de grupo | `text-muted-foreground` |
| `input`, `textarea`, `select`, `select-menu`, `checkbox`, `button` | `aria-invalid:ring-destructive/20`, `dark:aria-invalid:ring-destructive/40` | Remover |
| `alert.tsx` | `border-destructive/50` | `border-destructive` com `-subtle` |
| `dropdown-menu.tsx` | `focus:bg-destructive/10` (e `dark:…/20`) | `focus:bg-destructive-subtle` |
| `skeleton.tsx` | `bg-accent` (hover usado como superfície) | `bg-muted` |
| `dialog`, `alert-dialog`, `sheet` | `bg-background` (fundo da página usado como superfície) | `bg-popover` |
| `tooltip.tsx` | `bg-foreground text-background` (texto usado como fundo) | `bg-inverse text-inverse-foreground` |
| `super/users/user-detail.tsx:116` | `variant="secondary"` (Sol) no Super | `default` |

Não foram encontrados hex, `rgb()`, classes `gray-*`, `slate-*`, `zinc-*`, `red-*`, `green-*`, `amber-*`, `blue-*`, `violet-*` nem `black/*`/`white/*` em `apps/web/src`. O SVG da logo de teste no `e2e/mock-api.mjs` tem hex, mas é dado de teste.

## Regras de uso (para a 2.35 e telas novas)

- **Cards sem sombra**, só borda (`border bg-card rounded-lg`); sombra só no que flutua (popover, dropdown, diálogo, toast). No escuro a elevação é por superfície: `background` → `card`/`popover` → `muted`.
- **Seleção usa a cor de ação**: item ativo da sidebar, horário escolhido e aba sublinhada em `primary`/`sidebar-primary`; chip de esporte selecionado em `chip-selected`. `accent` é só hover.
- **`muted` é superfície neutra** (trilho de barra, skeleton, horário livre); `secondary` é o botão destaque (Sol), nunca cinza.
- **Títulos em Space Grotesk só a partir de 18 px** (`text-lg`); rótulos pequenos em Inter (`font-sans text-overline uppercase`). A regra global `h1, h2, h3 { font-display }` continua; quem usar `h2` como rótulo põe `font-sans`.
- **Sem `dark:` para cor** nos componentes: se precisar, falta token (registrar para a ui-designer).
- **Densidade:** painel com controles de 36 (`h-9`), páginas públicas e telas de entrada com 48 (`size="xl"`, `FormField large`).

## Mobile

Nenhum valor existente mudou, então o app não precisa de ajuste. O `nativewind.css` ganhou os tokens novos; o `scrim` sai em canais HSL com alfa (`201 76.9% 10.2% / 0.6`), o que mantém `hsl(var(--scrim))` válido, mas ainda não foi testado num componente do app (nenhum usa o véu hoje). Os tokens `chip*`, `inverse`, `disabled*` e `input-*` servem ao app do mesmo jeito (tarefa futura do mobile).

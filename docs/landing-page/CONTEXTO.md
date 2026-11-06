# Space Sports: contexto para a landing page

> Documento autocontido para desenvolver a landing page de conversão em outro repositório.
> Gerado a partir do repositório do produto em 2026-11-03. Fontes: `docs/01-visao-produto.md`,
> `docs/02-requisitos-funcionais.md`, `docs/06-roadmap.md`, `docs/05-design-system.md`,
> `docs/brand/kit/` e `packages/ui-tokens`.
>
> **Assets nesta pasta:** `assets/brand/*.svg` (logos aprovadas), `assets/png/*` (OG image,
> ícones, favicons) e `assets/theme.css` (todos os tokens em CSS, claro e escuro, pronto para
> Tailwind v4). São cópias: a fonte de verdade é `packages/ui-tokens`.

---

## 1. O que é a Space Sports, em uma frase

**Uma plataforma para quadras de areia: o jogador encontra e reserva quadra pelo app, e o espaço esportivo gere agenda, alunos, mensalidades e torneios em um painel web, sem planilha nem WhatsApp.**

É um **SaaS B2B** para espaços esportivos que também funciona como **vitrine** (marketplace de descoberta) para jogadores, que usam de graça.

- **Foco inicial:** quadras de areia em **Belo Horizonte/MG**: **futevôlei, beach tennis e vôlei de praia**.
- **Expansão prevista:** outros esportes e outras cidades (o produto já foi modelado de forma genérica).
- **Domínio:** `spacesports.com.br`. O painel web roda em `app.spacesports.com.br` (production). A landing provavelmente fica na raiz `spacesports.com.br` (a confirmar).

## 2. Públicos e objetivo de conversão

A landing fala com **dois públicos**. O principal, para receita, é o **espaço esportivo** (quem paga).

| Público | Quem é | Dor | Conversão desejada |
|---|---|---|---|
| **Espaço esportivo** (dono / admin) — **público pagante** | Dono de arena de areia, gestor, recepção | Agenda no WhatsApp, mensalidades em planilha, inadimplência, turmas lotadas ou vazias, torneio organizado no papel | **Falar com a equipe / agendar demonstração** (implantação assistida) |
| **Jogador / aluno** — gratuito | Quem joga futevôlei, beach tennis ou vôlei de praia em BH | Descobrir quadras é fragmentado (Instagram, indicação, Maps); reservar exige ida e volta no WhatsApp | **Baixar o app** (ou entrar na lista de espera enquanto o app não está nas lojas) |
| Professor | Dá aulas em um espaço | Saber quem vem, abrir e fechar lista de presença | Secundário: entra pelo espaço |

**Recomendação:** hero voltado ao **espaço** (B2B), com uma seção/faixa clara para o **jogador**. Ou duas páginas: `/` (espaços) e `/jogadores`.

## 3. Propostas de valor (oficiais, do documento de visão)

- **Para o jogador:** "Encontre e reserve sua quadra de areia em BH em 30 segundos e divida com a galera."
- **Para o espaço:** "Pare de gerir agenda, mensalidades e torneios por planilha e WhatsApp."

### Problemas que o produto resolve
1. A descoberta de espaços é fragmentada (Instagram, indicação, Google Maps).
2. A reserva de quadra é feita por WhatsApp, com idas e vindas.
3. O controle de alunos, planos e presença fica em planilha → inadimplência e turmas lotadas ou vazias.
4. Torneios são organizados manualmente (inscrição por formulário, chaveamento em papel/Excel).

## 4. Modelo de negócio (o que pode e o que não pode ser prometido)

- **Espaço paga** uma **taxa de implantação** (setup único) + **mensalidade recorrente**. A cobrança é feita **fora da plataforma**. **Os preços não estão definidos/publicados: não exibir valores na landing.** Use "Fale com a gente" / "Peça uma demonstração".
- **Grátis para o jogador/aluno.**
- **Pagamento dos serviços é direto no espaço** (Pix, cartão na maquininha, dinheiro). A plataforma **não processa pagamentos**: ela **registra e controla** quem pagou, quem deve e a forma de pagamento.
  - ⚠️ Não escrever "pague pelo app", "pagamento online" ou "checkout". Pagamento online integrado é evolução futura.
- **Implantação assistida:** a equipe Space Sports cadastra o espaço junto com o dono (dados, fotos, quadras, preços, equipe). Bom argumento de conversão: "a gente coloca seu espaço no ar com você".

## 5. Funcionalidades (o que existe hoje)

Status em 2026-11-03: Fase 1 (descoberta + aluguel + Super) e Fase 2 (aulas e planos) **implementadas**; **beta fechado e publicação nas lojas ainda pendentes**; torneios estão no escopo, mas **ocultos no app por enquanto**.

### 5.1 App do jogador (iOS e Android, gratuito)
- **Vitrine** em feed vertical (estilo Instagram/Wellhub): foto, nome, bairro + distância, esportes, preço/hora e serviços.
- **Busca e filtros:** distância/raio, esporte, serviço (aluguel/aula), infraestrutura, nome. **Mapa** com pins.
- **Página do espaço:** galeria, descrição, infraestrutura (banheiro, vestiário, bar, estacionamento, iluminação noturna…), localização (abrir no Maps/Waze), contatos, formas de pagamento aceitas.
- **Reserva de quadra confirmada na hora** (sem esperar aprovação): esporte → data → duração → horário livre → quadra → nº de pessoas → forma de pagamento no local. Preço proporcional em frações de 30 min.
- **Dividir a conta com a galera:** convite por link (WhatsApp, e-mail ou busca no app); cada um vê a sua parte. O convidado pode confirmar **sem ter conta**, por uma página web.
- **Mensalista:** pedir um horário fixo semanal; o espaço aprova e as reservas são geradas toda semana.
- **Minhas reservas:** próximas e passadas, cancelar dentro do prazo do espaço, adicionar ao calendário, como chegar.
- **Aulas:** ver planos (1x, 2x, 3x/semana ou ilimitado) e turmas com vagas, contratar escolhendo as turmas, **confirmar presença** nas aulas, **lista de espera** com promoção automática, acompanhar mensalidades.
- Favoritos, notificações, perfil; login com e-mail, Google, Apple ou telefone.
- Tema claro e escuro.

### 5.2 Painel web do espaço (gestão)
- **Agenda por quadra** (dia/semana), reserva de balcão, bloqueio de horários.
- **Mensalistas:** solicitações, aprovar/recusar, encerrar, conflitos de agenda.
- **Aulas:** turmas fixas, planos, professores (mais de um por aula), calendário de sessões, **lista de presença automática ou manual**, presença real (presente/faltou), cancelar aula com aviso aos alunos.
- **Alunos e mensalidades:** matrículas, aprovações, geração automática das mensalidades, **inadimplentes**, registro de pagamento.
- **Recebimentos:** "A receber hoje", extrato por período e forma de pagamento, exportação CSV.
- **Relatórios:** ocupação das turmas, frequência, receita de mensalidades.
- **Equipe com papéis:** Dono, Admin, Professor (uma pessoa pode ter papéis diferentes em espaços diferentes).
- **Base de contatos** dos clientes (com consentimento de marketing, LGPD).
- **Página pública do espaço** com SEO e botão "abrir no app" (`/espacos/<slug>`).
- **Torneios** (em construção / não divulgar como pronto): categorias por gênero e nível, inscrição em dupla, chaveamento automático, placares.

### 5.3 O que NÃO prometer na landing
- Pagamento online / gateway, split de pagamento.
- Lembretes por WhatsApp (futuro).
- Integração Wellhub/Gympass/TotalPass (backlog).
- Avaliações de espaços, check-in por QR Code, placar ao vivo (backlog).
- Torneios no app (oculto por enquanto).
- Disponibilidade em outras cidades (por enquanto, BH).
- Números de uso, depoimentos, avaliações nas lojas: **não existem ainda; não inventar**.
- App nas lojas: **ainda não publicado**. Use "Em breve na App Store e no Google Play" + captura de interesse.

## 6. Espaços parceiros (piloto)

Três espaços em implantação em BH: **Astral Beach Sports**, **Arena Errejota** e **Duna Sports**. Logos em `docs/brand/parceiros/` no repositório do produto.

- ⚠️ **Regra do projeto:** nunca inventar endereço, preço, número de quadras ou outros dados dos parceiros.
- ⚠️ **Confirmar autorização** de cada espaço antes de exibir nome/logo na landing ("quem já está com a gente").
- As fotos do seed de demonstração são do Unsplash e **não são fotos dos espaços**.

## 7. Identidade visual

Fonte de verdade: kit de marca v1.1 (2026-10-29), pranchas 01–07 em `docs/brand/kit/*.html` (abrir no navegador), e os tokens em `packages/ui-tokens`.

### 7.1 Conceito da marca
"**A rede une todos os nossos esportes.**"
- **A bola:** inspirada na bola de futevôlei, com a estrela de gomos. Também é o **planeta** do "Space": luz, sombra e volume.
- **A rede:** passa à frente da bola em arco inclinado (18°), com postes nas pontas. É o elemento comum ao futevôlei, ao vôlei e ao beach tennis.
- **O movimento:** rastros em Mar e Sol mostram o efeito do lance; o nome em Space Grotesk inclinado 9°.

### 7.2 Cores da marca

| Nome | Hex | Papel |
|---|---|---|
| **Mar** | `#03547D` | Cor da marca: ações, logo, links (tema claro) |
| **Sol** | `#FBBD10` | Destaque, energia; ação principal no tema escuro |
| **Noite** | `#06202E` | Texto, fundos profundos, modo escuro |
| **Rede** | `#FFFFFF` | Superfícies |

**Escalas (50 → 900):**

| Passo | Mar | Sol | Neutra |
|---|---|---|---|
| 50 | `#E6F1F7` | `#FFF8E1` | `#F7F9FA` |
| 100 | `#C2DCEA` | `#FEECB3` | `#EEF2F4` |
| 200 | `#8FBFD8` | `#FDDD7A` | `#DCE3E6` |
| 300 | `#579DC0` | `#FCCD45` | `#BCC6CB` |
| 400 | `#2A7CA4` | **`#FBBD10`** (base) | `#94A1A8` |
| 500 | **`#03547D`** (base) | `#E2A40A` | `#66757D` |
| 600 | `#034868` | `#BC8507` | `#4A5A63` |
| 700 | `#033A54` | `#8F6407` | `#2A3B44` |
| 800 | `#052D41` | `#66470A` | `#15262F` |
| 900 | `#06202E` | `#42300B` | `#06202E` |

**Funcionais:** sucesso `#1F9D6B` · alerta `#E07B12` · erro `#D9483B` (use `#C84236` com texto branco) · info `#2A7CA4`.

### 7.3 Tokens semânticos (convenção shadcn/ui)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `background` / `foreground` | `#F7F9FA` / `#06202E` | `#071A24` / `#F2F6F8` | Fundo da página e texto |
| `card` / `card-foreground` | `#FFFFFF` / `#06202E` | `#0C2633` / `#F2F6F8` | Cards, seções elevadas |
| `primary` / `-foreground` | `#03547D` / `#FFFFFF` | `#FBBD10` / `#06202E` | CTA principal (Mar no claro, **Sol no escuro**) |
| `secondary` / `-foreground` | `#FBBD10` / `#06202E` | `#2A7CA4` / `#FFFFFF` | Botão "Destaque" (Sol no claro) |
| `muted` / `-foreground` | `#EEF2F4` / `#4A5A63` | `#12313F` / `#A9BCC6` | Faixas neutras, texto secundário |
| `border` | `#DCE3E6` | `#1E4152` | Divisórias |
| `input` | `#7F8C93` | `#607B89` | Borda de campos de formulário |
| `link` / hover | `#03547D` / `#033A54` | `#8FBFD8` / `#C2DCEA` | Links |
| `ring` / `ring-offset` | `#FBBD10` / `#03547D` | `#FBBD10` / `#071A24` | Foco: anel Sol com faixa de offset |
| `eyebrow` | `#03547D` | `#FCCD45` | Rótulo pequeno acima dos títulos |
| `inverse` / `-foreground` | `#06202E` / `#FFFFFF` | `#F2F6F8` / `#06202E` | Botão "Escuro" / faixas Noite |

O arquivo `assets/theme.css` traz **todos** os tokens (`:root` claro, `.dark` escuro, `@theme` com primitivas `mar-*`, `sol-*`, `neutral-*`, fontes, estilos de texto, raios e sombras). Em Tailwind v4:

```css
@import "tailwindcss";
@import "./theme.css";
```

### 7.4 Regras de cor (acessibilidade e marca)
- **Nunca use o Sol como texto ou ícone sobre fundo claro** (contraste 1.6:1, reprovado no kit). Sol é fundo (botão, faixa, chip) com texto **Noite**.
- Sobre Mar e Noite, texto branco. Sobre Sol, texto Noite.
- **No escuro, o Sol vira a ação principal** (o Mar tem só 2.2:1 sobre Noite).
- Foco visível: `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-ring-offset` (anel Sol + faixa Mar no claro).
- Contraste mínimo: texto 4.5:1, elementos não textuais 3:1.
- Combinações de seção que funcionam: fundo claro `#F7F9FA` com CTA Mar; **faixa Mar** com logo negativa e CTA Sol; **faixa Sol** com logo "sobre Sol" e CTA Noite; **faixa Noite** (rodapé/hero escuro) com CTA Sol.

### 7.5 Tipografia (Google Fonts)
- **Space Grotesk** (400–700): display, títulos, números de destaque e logo.
- **Inter** (400–600): texto, interface, botões.
- Use `tabular-nums` em preços e horários.

| Estilo | Família | Tamanho / linha | Peso | Espaçamento |
|---|---|---|---|---|
| display | Space Grotesk | 64 / 72 | 700 | −0,02em |
| h1 | Space Grotesk | 48 / 56 | 700 | −0,01em |
| h2 | Space Grotesk | 36 / 44 | 600 | 0 |
| h3 | Space Grotesk | 24 / 32 | 600 | 0 |
| body-lg | Inter | 18 / 28 | 400 | 0 |
| body | Inter | 16 / 24 | 400 | 0 |
| small | Inter | 14 / 20 | 500 | 0 |
| overline | Inter | 12 / 16 | 600 | 0,12em, MAIÚSCULAS |

No mobile, reduza display/h1 (ex.: display ~40px, h1 ~32px).

Next.js:
```tsx
import { Inter, Space_Grotesk } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--font-space-grotesk' });
```
```css
@theme inline {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
}
```

### 7.6 Raios, espaçamento e sombras
- **Raios:** badges 6px · botões e campos **12px** · cards 16px · card de quadra / cards grandes 24px · pill 9999px.
- **Altura de botões e campos:** 48px (alvo de toque mínimo 44px).
- **Espaçamento:** base 4px (escala Tailwind).
- **Sombras** (tom Noite):
  - sm `0 1px 2px 0 rgb(6 32 46 / 0.06)`
  - md `0 2px 8px -2px rgb(6 32 46 / 0.10), 0 1px 3px 0 rgb(6 32 46 / 0.06)`
  - lg `0 12px 24px -6px rgb(6 32 46 / 0.14), 0 4px 8px -4px rgb(6 32 46 / 0.08)`
- No escuro, elevação por cor de superfície (`background` → `card` → `muted`), quase sem sombra.

### 7.7 Componentes de referência (prancha 06)
- **Botão principal:** fundo Mar, texto branco, raio 12, altura 48, Inter 600.
- **Botão Destaque:** fundo Sol, texto Noite.
- **Botão Escuro:** fundo Noite, texto branco.
- **Botão de contorno:** borda 1.5px Noite, fundo branco.
- **Campo:** borda 1.5px `#7F8C93`, fundo branco; em foco, borda Mar e fundo Sol 50 (`#FFF8E1`).
- **Chip de esporte:** neutro (`#EEF2F4` + borda `#DCE3E6`); selecionado em Sol com texto e borda Noite.
- **Card de quadra:** foto grande no topo, raio 24, nome em Space Grotesk, bairro + distância, chips de esporte, preço/hora em destaque. Ótimo elemento visual para mockups da vitrine.
- Ícones: **lucide** (mesmo set do produto).

### 7.8 Logo
Arquivos em `assets/brand/` (SVG; o nome já em contorno, sem depender de fonte):

| Arquivo | Quando usar |
|---|---|
| `logo-vertical.svg` | Principal, fundo claro |
| `logo-vertical-negative.svg` | Sobre Mar / fundos escuros |
| `logo-vertical-on-sol.svg` | Sobre Sol |
| `logo-horizontal.svg` | Cabeçalho (uso secundário), fundo claro |
| `logo-horizontal-negative.svg` / `-on-sol.svg` | Cabeçalho sobre Mar/escuro ou Sol |
| `logo-mono-dark.svg` / `logo-mono-white.svg` | Monocromático (sobre fotos, impressão) |
| `symbol*.svg` | Só o símbolo (bola + rede) |
| `app-icon.svg`, `app-icon-sol.svg`, `favicon.svg` | Ícone de app e favicon |

PNGs em `assets/png/`: `og-image.png` (1200×630, Open Graph), `apple-touch-icon.png`, `favicon-32.png`, `favicon-48.png`, `icon.png`.

**Regras:**
- Largura mínima: vertical **96px**, horizontal **160px**, símbolo **40px**. Abaixo de 40px, use o favicon.
- Área de proteção = raio da bola; nada entra nessa margem.
- Não distorcer, não endireitar a inclinação, não mover a rede para trás da bola, não trocar as cores, não separar nome e símbolo na vertical.
- Sobre foto sem contraste: versão negativa ou mono.
- Se o mesmo SVG aparecer mais de uma vez inline na página, torne único o id `ss-clip-*` do `clipPath`.

## 8. Tom de voz e redação
- **Português do Brasil**, direto, próximo, sem jargão técnico. Tratamento por "você".
- Vocabulário do produto: **espaço** (não "arena" genérica nem "estabelecimento"), **quadra**, **reserva**, **mensalista**, **aula**, **turma**, **plano**, **lista de presença**, **galera**, **dividir a conta**.
- Esportes escritos assim: **futevôlei**, **beach tennis**, **vôlei de praia**.
- Energia da praia/areia, sol, movimento, mas sem exagero ("revolucionário", "o melhor do Brasil").
- Dinheiro em reais no formato `R$ 100,00`; horários em 24h (`19h`, `19h30`), fuso de Brasília.

## 9. Estrutura sugerida para a landing (conversão B2B + captura de jogadores)

1. **Header:** logo horizontal, âncoras (Para espaços · Para jogadores · Como funciona · FAQ), CTA "Falar com a equipe".
2. **Hero (espaços):** eyebrow "Gestão para quadras de areia"; título na linha de "Pare de gerir sua arena por planilha e WhatsApp"; subtítulo citando agenda, mensalistas, aulas e mensalidades; CTA primário "Agendar demonstração" + secundário "Sou jogador". Visual: mockup do painel (agenda por quadra) + celular com a vitrine.
3. **Problemas → soluções:** os 4 problemas da seção 3, cada um com a funcionalidade que resolve.
4. **Funcionalidades para o espaço:** Agenda e reservas · Mensalistas · Aulas e lista de presença · Mensalidades e inadimplência · Recebimentos e relatórios · Equipe e papéis · Vitrine e página pública (novos clientes).
5. **Como funciona (3 passos):** 1) Conversa e implantação assistida; 2) Espaço no ar no app e na página pública; 3) Jogadores reservam e você acompanha tudo no painel.
6. **Faixa "Pagamento direto no espaço":** o dinheiro vai direto para o espaço (Pix, cartão, dinheiro); a plataforma organiza quem pagou e quem deve. Reduz objeção de taxa por transação.
7. **Para jogadores:** "Encontre e reserve sua quadra de areia em BH em 30 segundos e divida com a galera." Benefícios (vitrine, reserva na hora, dividir a conta, aulas, mensalista). CTA: lista de espera / "em breve nas lojas".
8. **Parceiros piloto** (só com autorização).
9. **FAQ:** Quanto custa? (fale com a equipe) · Preciso de maquininha nova? (não) · A plataforma cobra taxa sobre as reservas? (não intermedeia o dinheiro) · Funciona para aulas e mensalistas? (sim) · Meus alunos precisam pagar pelo app? (não; o app é grátis) · Em quais cidades? (BH, expandindo).
10. **CTA final** em faixa Mar ou Noite, com formulário curto: nome, nome do espaço, WhatsApp, e-mail, nº de quadras, esportes. Consentimento de contato com caixa desmarcada (LGPD).
11. **Rodapé:** logo, contatos, links para Termos e Privacidade (ainda não publicados: pendência do produto), `app.spacesports.com.br` ("Entrar no painel").

### Métricas a instrumentar
Envio do formulário de demonstração (conversão principal), cliques no WhatsApp, inscrições na lista de espera de jogadores, cliques em "Entrar no painel". O produto planeja usar PostHog.

## 10. Pendências que dependem do time (não assumir)
- Preço do SaaS (setup + mensalidade): **não divulgado**.
- Canal de contato comercial (WhatsApp/e-mail oficiais): a definir.
- Links das lojas (App Store / Google Play): app ainda não publicado.
- Termos de uso e política de privacidade: pendentes.
- Autorização para usar nomes, logos e fotos dos parceiros.
- Fotos reais de quadras: as fotos de demonstração (Unsplash) não são dos espaços; use banco de imagens identificado como ilustrativo ou fotos autorizadas.
- Endereço final da landing (`spacesports.com.br` raiz vs. subdomínio).

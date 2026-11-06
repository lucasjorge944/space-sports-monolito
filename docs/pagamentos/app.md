# Pagamento online · mockups do app (PG.1)

Esboços em 360 dp. Medidas, tokens, estados e textos completos em [`05-design-system.md`, "Pagamento online"](../05-design-system.md#pagamento-online). Os dois temas usam os mesmos desenhos: só os tokens trocam (veja também [`pix-claro-escuro.svg`](pix-claro-escuro.svg)).

Legenda: `[Botão]` botão primário · `(Botão)` contorno · `‹link›` botão `ghost` · `{Badge}` badge de status · `◉/○` rádio · `▓` selo "Ambiente de teste".

## 1. Etapa "Pagamento" no fluxo de reserva

Substitui o passo "Como você vai pagar no espaço?" quando o modo de reservas não é `ON_SITE`. As etapas de cima (esporte, data, duração, horário, quadra, pessoas) não mudam.

### 1a. Modo "No local ou online" (`ONLINE_OPTIONAL`)

```
│ Quantas pessoas? (até 4)                    │
│   (−)  4  (+)                               │
│                    ↕ 24                     │
│ Como você quer pagar?      ▓ Ambiente de teste│  título 16/600 · selo à direita (só fake)
│                    ↕ 8                      │
│ ┌─────────────────────────────────────────┐ │
│ │ ◉  ⌗  Pix                            ✓ │ │  cartão de opção, mín. 64, raio 16
│ │       Aprovação na hora                 │ │  selecionado: borda chip-selected-border
│ └─────────────────────────────────────────┘ │  + bg-accent + ícone de marcado
│                    ↕ 8                      │
│ ┌─────────────────────────────────────────┐ │
│ │ ○  ▭  Cartão de crédito                 │ │
│ │       À vista                           │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ ○  ⌂  No local                          │ │
│ │       Pague no espaço no dia do jogo    │ │
│ └─────────────────────────────────────────┘ │
│                    ↕ 16                     │
│ ┌ Resumo ─────────────────────────────────┐ │
│ │ Sáb, 08/11 · 18:00–19:30                │ │
│ │ Quadra 1 · Beach Tennis · 4 pessoas     │ │
│ │ Total (1h30)                 R$ 120,00  │ │  valor 20/28 display, tabular
│ │ Sem taxa extra no app.                  │ │  só com Pix ou cartão escolhido
│ │ Cancelando até 2 h antes, o valor volta │ │
│ │ inteiro para você.                      │ │
│ └─────────────────────────────────────────┘ │
│ [            Pagar com Pix             ]    │  48 · "Pagar com cartão" · "Confirmar reserva"
```

Com "No local" marcado, o cartão abre os chips da forma pretendida, como hoje:

```
│ ┌─────────────────────────────────────────┐ │
│ │ ◉  ⌂  No local                       ✓ │ │
│ │       Pague no espaço no dia do jogo    │ │
│ │  (Pix) (Dinheiro) (Cartão)              │ │  chips existentes, opcionais
│ │  Só para o espaço se preparar.          │ │
│ └─────────────────────────────────────────┘ │
```

### 1b. Modo "Online obrigatório" (`ONLINE_REQUIRED`)

```
│ Como você quer pagar?      ▓ Ambiente de teste│
│ ┌ ⓘ ──────────────────────────────────────┐ │  info-subtle, raio 12
│ │ Este espaço pede o pagamento na reserva.│ │
│ │ O horário fica guardado por 15 min      │ │
│ │ enquanto você paga.                     │ │
│ └─────────────────────────────────────────┘ │
│ ┌ ◉ ⌗ Pix · Aprovação na hora          ✓ ┐ │
│ └─────────────────────────────────────────┘ │
│ ┌ ○ ▭ Cartão de crédito · À vista        ┐ │
│ └─────────────────────────────────────────┘ │  sem "No local"
│ … Resumo …                                  │
│ [          Reservar e pagar com Pix     ]   │
```

## 2. Tela do Pix

Rota sugerida: `pagamento/reserva/[id]` e `pagamento/mensalidade/[id]` (a mesma tela).

### 2a. Aguardando (reserva obrigatória)

```
┌─────────────────────────────────────────────┐
│ ←  Pagar com Pix          ▓ Ambiente de teste│  ScreenHeader
├─────────────────────────────────────────────┤
│ VALOR                                       │  overline muted
│ R$ 120,00                                   │  36/40 display bold, tabular
│ Reserva · Arena Beira-Mar                   │  14/20 muted
│ Sáb, 08/11 · 18:00–19:30                    │
│                    ↕ 16                     │
│ ┌─────────────────────────────────────────┐ │  card · raio 16
│ │ ⏰  Pague em 14:32                      │ │  mm:ss 24/32 display semibold
│ │     Horário guardado até 18:47          │ │  14/20 muted
│ └─────────────────────────────────────────┘ │
│                    ↕ 16                     │
│ PIX COPIA E COLA                            │
│ 00020126580014br.gov.bcb.pix…5204000053039  │  mono 14, 1 linha, corte no meio
│ [ ⧉        Copiar código Pix            ]   │  48 primário
│                    ↕ 8                      │
│ 1. Copie o código                           │  passos 14/20 muted
│ 2. No app do banco, escolha Pix copia e cola│
│ 3. Volte aqui: a confirmação aparece sozinha│
│                    ↕ 24                     │
│ Ou leia o QR code em outro celular          │  14/500, centralizado
│        ┌──────────────────────┐             │  placa qr-plate 248 × 248, raio 16,
│        │ ▓▓  ▓ ▓▓▓  ▓  ▓▓▓▓ │             │  borda border, folga 16
│        │ ▓ ▓▓  ▓   ▓▓ ▓  ▓ │             │  QR 216 × 216, módulos qr-module
│        │ ▓▓▓ ▓  ▓▓ ▓   ▓▓▓ │             │  (branco nos dois temas)
│        └──────────────────────┘             │
│                    ↕ 16                     │
│  ◌  Aguardando o pagamento…                 │  spinner 16 + 14 muted, live region
│                    ↕ 8                      │
│        ‹Pagar com cartão›                   │  ghost (consulta a cobrança antes: 2g)
└─────────────────────────────────────────────┘
```

Depois de copiar (2 s): `[ ✓  Copiado! ]`. A contagem usa `expiresAt` e o `serverTime` da resposta, não só o relógio do aparelho.

Reserva no modo opcional: no lugar do cartão da contagem, a linha "Pix válido até 18:47" (muted) e, acima do botão `ghost`, o texto "Prefere pagar no espaço? Pode sair: sua reserva já está confirmada."

Mensalidade (24 h): o cartão da contagem mostra "Válido até amanhã, 10:15" e "Faltam 23 h 41 min"; abaixo de 1 h vira mm:ss.

### 2b. Prazo acabando (≤ 3 min na reserva; ≤ 1 h na mensalidade)

```
│ ┌─────────────────────────────────────────┐ │  warning-subtle + borda warning-subtle-border
│ │ ⏰  Pague em 02:41                      │ │  texto warning-subtle-foreground
│ │     O horário é liberado às 18:47       │ │
│ └─────────────────────────────────────────┘ │
```

### 2c. Confirmado

```
┌─────────────────────────────────────────────┐
│ ←  Pagamento                                │
├─────────────────────────────────────────────┤
│                    ↕ 48                     │
│                 ╭──────╮                    │  círculo 96 success-subtle,
│                 │  ✓   │                    │  CircleCheck 48 success-subtle-foreground
│                 ╰──────╯                    │
│            Pagamento confirmado             │  h3 24/32, centralizado
│           R$ 120,00 · Pix · 18:42           │  16 muted, tabular
│        Sua reserva está confirmada.         │
│                    ↕ 32                     │
│ [              Ver reserva              ]   │
│ (            Ver comprovante            )   │
└─────────────────────────────────────────────┘
```

### 2d. Vencido

```
│                 ╭──────╮                    │  círculo 96 muted, TimerOff 48 muted-foreground
│                 │  ⏱   │                    │
│                 ╰──────╯                    │
│        O prazo para pagar acabou            │  obrigatório
│  A reserva foi cancelada e o horário        │
│  liberado. Se ainda estiver livre, você     │
│  pode reservar de novo.                     │
│ [           Reservar de novo            ]   │
│ (                Voltar                 )   │
```

Opcional / mensalidade: "Este Pix venceu" · "Sua reserva continua confirmada. Gere outro Pix ou pague no espaço." · `[Gerar novo Pix]` `(Voltar para a reserva)`.

### 2e. Pago e estornado sozinho (Pix e cartão, decisão 96)

```
│                 ╭──────╮                    │  info-subtle, Undo2
│        O pagamento chegou depois do prazo   │
│  A reserva já tinha sido cancelada. Os      │
│  R$ 120,00 voltam para o mesmo Pix.         │  (ou "cartão")
│ (            Ver comprovante            )   │
```

Cobrança trocada ou vencida: "Este pagamento chegou atrasado" · "Você já tinha trocado de forma de pagamento (ou o Pix tinha vencido). Os R$ 120,00 voltam para o mesmo Pix."

### 2f. Erro ao gerar

```
│                 ╭──────╮                    │  destructive-subtle, CircleAlert
│        Não conseguimos gerar o Pix          │
│  Confira a internet e tente de novo.        │
│ [            Tentar de novo             ]   │
```

### 2g. Antes de trocar de meio ou gerar novo Pix (decisão 96)

O app consulta a cobrança. Paga → 2c. Vencida, recusada ou cancelada → segue. Ainda aguardando:

```
┌─────────────────────────────────────────┐
│ Já pagou? Aguarde a confirmação         │  Alert nativo
│ Se você já pagou este Pix, a confirmação│
│ chega em alguns segundos. Trocar agora  │
│ cancela este código.                    │
│            Trocar mesmo assim   Aguardar│
└─────────────────────────────────────────┘
```

Cada toque que cria algo manda uma `Idempotency-Key` nova; as repetições automáticas da mesma tentativa usam a mesma.

## 3. Cartão de crédito

```
┌─────────────────────────────────────────────┐
│ ←  Pagar com cartão       ▓ Ambiente de teste│
├─────────────────────────────────────────────┤
│ R$ 120,00                                   │  36/40 display
│ Reserva · Arena Beira-Mar · Sáb, 08/11      │
│ ⏰ Horário guardado por mais 12:41          │  só na reserva obrigatória
│                    ↕ 16                     │
│ ┌ ▓ Cartões de teste ─────────────────────┐ │  só fake: card muted
│ │ (Aprova) (Recusa) (Aprova e contesta)   │ │  um chip por cartão que a API manda;
│ │                                         │ │  rótulos e dados vêm da API
│ └─────────────────────────────────────────┘ │
│ Número do cartão                            │
│ ┌─────────────────────────────────────────┐ │  48, number-pad, cc-number
│ │ 4111 1111 1111 1111                     │ │
│ └─────────────────────────────────────────┘ │
│ Nome impresso no cartão                     │
│ ┌─────────────────────────────────────────┐ │
│ │ MARIA S OLIVEIRA                        │ │
│ └─────────────────────────────────────────┘ │
│ Validade               Código de segurança  │  2 colunas, 12 entre elas
│ ┌──────────────────┐   ┌──────────────────┐ │
│ │ 08/29            │   │ 123              │ │
│ └──────────────────┘   └──────────────────┘ │
│ MM/AA                  3 dígitos no verso   │  dicas
│                    ↕ 16                     │
│ 🔒 O Space Sports não guarda seu cartão.    │  14 muted, Lock 16
│ [            Pagar R$ 120,00            ]   │
│              ‹Pagar com Pix›                │
└─────────────────────────────────────────────┘
```

Processando: campos desabilitados e `[ ◌ Processando… ]` desabilitado.

Recusado (alerta no topo do formulário, CVV limpo):

```
│ ┌ (!) ────────────────────────────────────┐ │  Alert destructive-subtle
│ │ Cartão recusado                         │ │
│ │ O banco não autorizou. Confira os dados │ │
│ │ ou use outro cartão.                    │ │
│ └─────────────────────────────────────────┘ │
```

No modo opcional, a segunda frase vira "Sua reserva está confirmada: tente outro cartão, pague com Pix ou no espaço."

Depois do primeiro envio (aprovado ou recusado) o app já está em `reserva/[id]` → cartão: a nova tentativa vai para a cobrança dessa reserva.

Aprovado: a mesma tela de sucesso do Pix, com o título "Pagamento aprovado" e "R$ 120,00 · Cartão final 1111 · 18:42".

## 4. Reserva aguardando pagamento

### 4a. Lista "Minhas reservas"

```
│ AGUARDANDO PAGAMENTO                        │  seção fixa no topo da lista
│ ┌─────────────────────────────────────────┐ │
│ │ Arena Beira-Mar   {Aguardando pagamento}│ │
│ │ Beach Tennis · Quadra 1                 │ │
│ │ Sáb, 08/11 · 18:00–19:30      R$ 120,00 │ │
│ │ ⏰ Pague até 18:47                      │ │  warning-subtle-foreground, 14/500
│ │ ─────────────────────────────────────── │ │
│ │ [             Pagar agora             ] │ │  44, primário
│ └─────────────────────────────────────────┘ │
```

Cancelada por falta de pagamento (no histórico):

```
│ │ Arena Beira-Mar               {Cancelada}│ │
│ │ Beach Tennis · Quadra 1                 │ │
│ │ Sáb, 08/11 · 18:00–19:30                │ │
│ │ Pagamento não feito no prazo            │ │  14 muted
```

### 4b. Detalhe

```
│ ┌─────────────────────────────────────────┐ │  warning-subtle + borda
│ │ Falta pagar para confirmar              │ │  18/28 600
│ │ O horário fica guardado até 18:47.      │ │
│ │ ⏰ Faltam 12:41                         │ │
│ │ [         Pagar R$ 120,00             ] │ │
│ └─────────────────────────────────────────┘ │
│ ┌ Arena Beira-Mar  {Aguardando pagamento} ┐ │  card atual
│ …                                           │
│ (convites e edição escondidos até pagar)    │
│ (        Desistir da reserva           )    │  contorno destructive (decisão 96)
```

"Desistir da reserva" confirma: "Desistir da reserva?" · "O horário é liberado e o código Pix deixa de valer. Se você já pagou, o valor volta sozinho." · Voltar / Desistir.

"Pagar" abre a folha "Como você quer pagar?" (os cartões de opção da etapa 1, sem "No local" quando é obrigatório) e depois a tela do meio escolhido. Com uma cobrança Pix aberta e válida, abre direto a tela do Pix com o mesmo código.

### 4c. Bloco "Pagamento" no detalhe

```
Pago online                                 Estorno parcial
┌───────────────────────────────────────┐   ┌───────────────────────────────────────┐
│ Pagamento                             │   │ Pagamento                             │
│ Total da reserva          R$ 120,00   │   │ Total da reserva          R$ 120,00   │
│ Situação                     {Pago}   │   │ Situação          {Estorno parcial}   │
│ Pago com Pix em 08/11 às 18:42        │   │ Pago com Pix          R$ 120,00       │
│ ‹Ver comprovante›                     │   │ Devolvido em 09/11    − R$ 40,00      │
└───────────────────────────────────────┘   │ "Quadra sem iluminação"               │
                                            │ (se o espaço cobrar de novo:)         │
                                            │ Falta pagar R$ 40,00 no espaço        │
                                            │ ‹Ver comprovante›                     │
Estornado                                   └───────────────────────────────────────┘
┌───────────────────────────────────────┐
│ Situação                {Estornado}   │   Opcional, sem pagar ainda
│ R$ 120,00 devolvidos em 09/11 para    │   ┌───────────────────────────────────────┐
│ o seu Pix.                            │   │ Situação     {Pagamento pendente}     │
│ ‹Ver comprovante›                     │   │ (           Pagar online           )  │
└───────────────────────────────────────┘   │ Ou pague no espaço no dia do jogo.    │
                                            └───────────────────────────────────────┘
```

## 5. Mensalidade: "Pagar agora"

```
│ PENDENTES                                   │
│ nov 2026                        R$ 180,00   │
│ Vence 10/11/2026                {A vencer}  │
│ (          Pagar R$ 180,00             )    │  contorno, 44, largura toda
│ ─────────────────────────────────────────── │
│ out 2026                        R$ 180,00   │
│ Vence 10/10/2026 · faltam R$ 80,00 {Vencida}│
│ (           Pagar R$ 80,00             )    │
│                                             │
│ Com Pix aberto:                             │
│ (        Continuar pagamento           )    │
│ Pix gerado · vale até amanhã, 10:15         │  14 muted
```

## 6. Meus pagamentos

Perfil → "Meus pagamentos" (ícone `Receipt`), entre "Meus planos de aula" e "Preferências de notificação".

```
┌─────────────────────────────────────────────┐
│ ←  Meus pagamentos                          │
├─────────────────────────────────────────────┤
│ ⓘ Pagamentos feitos pelo app. O dinheiro    │  14 muted, Info 16
│   vai direto para o espaço: não existe      │
│   saldo no Space Sports.                    │
│ (Todos) (Pagos) (Estornos) (Aguardando)     │  chips de filtro, escolha única
│                    ↕ 16                     │
│ NOVEMBRO DE 2026                            │  overline
│ ┌─────────────────────────────────────────┐ │
│ │ (⌗) Reserva · Arena Beira-Mar R$ 120,00 │ │  ícone do meio em círculo 40 muted
│ │     Sáb, 08/11 · Pix          {Pago}    │ │
│ ├─────────────────────────────────────────┤ │
│ │ (▭) Mensalidade nov · Escola  R$ 180,00 │ │
│ │     05/11 · Cartão     {Estorno parcial}│ │
│ ├─────────────────────────────────────────┤ │
│ │ (▭) Reserva · Arena Sol       R$ 90,00  │ │
│ │     03/11 · Cartão       {Recusado}     │ │
│ └─────────────────────────────────────────┘ │
│ OUTUBRO DE 2026                             │
│ …                                           │
│             ◌ Carregando mais…              │
└─────────────────────────────────────────────┘
```

Detalhe / comprovante:

```
┌─────────────────────────────────────────────┐
│ ←  Comprovante                              │
├─────────────────────────────────────────────┤
│ R$ 120,00                         {Pago}    │  36/40 display
│ Pago em 08/11/2026 às 18:42                 │
│ ─────────────────────────────────────────── │
│ Serviço      Reserva · Quadra 1 · Beach T.  │  linhas rótulo (muted) / valor
│ Quando       Sáb, 08/11/2026 · 18:00–19:30  │
│ Recebido por Arena Beira-Mar                │
│ Pago por     Maria Oliveira                 │
│ Forma        Pix                            │
│ Transação    a8f3…91c2   ⧉                  │  copiável
│ ─────────────────────────────────────────── │
│ ESTORNOS                                    │
│ 09/11/2026              − R$ 40,00          │
│ "Quadra sem iluminação"                     │
│ Volta para o mesmo Pix.                     │
│ ─────────────────────────────────────────── │
│ (         Compartilhar comprovante      )   │
│ ‹Ver reserva›                               │
└─────────────────────────────────────────────┘
```

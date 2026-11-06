# Pagamento online · mockups do painel do espaço (PG.1)

Esboços em 1280 px (sidebar de 256 e `p-6`). Medidas, tokens, estados e textos completos em [`05-design-system.md`, "Pagamento online"](../05-design-system.md#pagamento-online).

Legenda: `[Botão]` primário · `(Botão)` contorno · `‹link›` `ghost` · `{Badge}` status · `◉/○` `OptionCards` · `▓` faixa "Ambiente de teste".

## 7. Recebimentos online

Novo item na sidebar, grupo **Gestão**, logo abaixo de "Recebimentos": **Recebimentos online** (`CreditCard`), em `/painel/recebimentos-online`. Só Dono e Admin.

### 7a. Antes do cadastro aprovado (sem abas)

```
Recebimentos online
Pix e cartão pelo app, com o dinheiro direto na conta do espaço.

┌ Conta de recebimento ─────────────────────────────────── {Não iniciado} ┐
│ Para receber pelo app, o espaço precisa de uma conta no nosso parceiro │
│ de pagamentos. As vendas caem nela e são repassadas todo dia para a    │
│ conta bancária do espaço.                                              │
│                                                                        │
│ Você vai precisar de:                                                  │
│  • CPF ou CNPJ e os dados de quem responde pelo espaço                 │
│  • Endereço                                                            │
│  • Conta bancária ou chave Pix no mesmo CPF/CNPJ                       │
│                                                                        │
│ [ Começar cadastro ]           (Admin: "Só o dono do espaço pode       │
│                                  fazer o cadastro." e sem o botão;     │
│                                  modo suporte: "No modo suporte, o     │
│                                  cadastro e a conta bancária não podem │
│                                  ser alterados.")                      │
└────────────────────────────────────────────────────────────────────────┘

┌ Formas de pagamento no app ────────────────────────────────────────────┐
│ ⓘ Disponível depois que a conta de recebimento for aprovada.           │  Alert info
│ RESERVAS PELO APP                                                      │
│ ◉ Só no local        ○ No local ou online   ○ Online obrigatório      │  desabilitados
│ MENSALIDADES DE AULAS                                                  │
│ ◉ Só no local        ○ No local ou online                             │
└────────────────────────────────────────────────────────────────────────┘

┌ Taxa de serviço ───────────────────────────────────────────────────────┐
│ (ver 7e)                                                               │
└────────────────────────────────────────────────────────────────────────┘
```

### 7b. Cadastro em etapas (só Dono, fora do modo suporte), `/painel/recebimentos-online/cadastro`

```
← Recebimentos online
Cadastro da conta de recebimento

 ① Quem recebe ── ② Endereço ── ③ Onde receber ── ④ Revisão e envio       `ol`, etapa atual com aria-current
 ━━━━━━━━━━━━━━

▓▓ Ambiente de teste: o cadastro é aprovado sozinho em alguns segundos.  ▓▓   só fake
▓▓ <dica de recusa que a API manda, ex.: documento terminado em 0000>    ▓▓   texto da API

┌ Quem recebe ───────────────────────────────────────────┐   máx. 640
│ Tipo                                                   │
│ ┌──────────────────────┐ ┌──────────────────────┐      │   OptionCards
│ │ ◉ Empresa (CNPJ)     │ │ ○ Pessoa física (CPF)│      │
│ └──────────────────────┘ └──────────────────────┘      │
│ CNPJ                     [12.ABC.345/01DE-35      ]    │
│ Razão social             [                        ]    │
│ Responsável pela conta   [                        ]    │   só CNPJ
│ CPF do responsável       [                        ]    │   só CNPJ
│ Telefone                 [(31) 99999-8888         ]    │
│ E-mail                   [                        ]    │
│                                                        │
│                        (Cancelar)  [Continuar]         │
└────────────────────────────────────────────────────────┘

③ Onde receber
│ ◉ Conta bancária    ○ Chave Pix                        │
│ Banco        [ 260 · Nu Pagamentos          ⌄ ]        │   select com busca
│ Agência      [0001]      Conta com dígito [12345-6]    │
│ Tipo de conta  ◉ Corrente  ○ Poupança                  │
│ A conta precisa estar no CNPJ informado.               │   dica

④ Revisão e envio
│ QUEM RECEBE                                   ‹Editar› │
│ Empresa · 12.ABC.345/01DE-35 · Arena Beira-Mar Ltda    │
│ ENDEREÇO                                      ‹Editar› │
│ ONDE RECEBER                                  ‹Editar› │
│ ☐ Li e aceito os termos do parceiro de pagamentos e as │
│   condições de recebimento do Space Sports.            │
│                          (Voltar)  [Enviar cadastro]   │
```

### 7c. Status do cadastro

```
Em análise                                        Recusado
┌ Conta de recebimento ───── {Em análise} ┐       ┌ Conta de recebimento ────── {Recusado} ┐
│ Recebemos o cadastro em 04/11/2026.     │       │ ┌ (!) ─────────────────────────────┐   │
│ Avisamos assim que o parceiro           │       │ │ O parceiro recusou o cadastro.   │   │
│ responder.                              │       │ │ Motivo: documento não confere com│   │
│ CNPJ 12.***.***/0001-** · Conta ****-6  │       │ │ a razão social.                  │   │
└─────────────────────────────────────────┘       │ └──────────────────────────────────┘   │
                                                  │ [ Corrigir e reenviar ]  (só Dono)     │
Aprovado                                          └────────────────────────────────────────┘
┌ Conta de recebimento ────── {Aprovado} ┐
│ Aprovado em 05/11/2026.                │
│ CNPJ 12.***.***/0001-** · Banco 260 ·  │
│ Ag. 0001 · Conta ****-6                │
│ (Trocar conta bancária)  (só Dono,     │
│                    fora do modo suporte)│
└────────────────────────────────────────┘

Trocar conta bancária → cadastro na etapa ③ + revisão, com confirmação:
┌──────────────────────────────────────────────────────────┐
│ Trocar a conta de recebimento?                           │
│ O cadastro volta para análise e os repasses ficam        │
│ pausados até a aprovação da nova conta. Todos os donos   │
│ do espaço recebem um aviso.                              │
│                          (Cancelar)  [Trocar conta]      │
└──────────────────────────────────────────────────────────┘

Em análise depois da troca
┌ Conta de recebimento ───────────────────────── {Em análise} ┐
│ ┌ ⚠ Repasses pausados até a aprovação da nova conta. ─────┐ │  Alert warning
│ │   As vendas continuam entrando no saldo.                 │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 7f. Pagamento online desligado (`PAYMENTS_PROVIDER=none`)

```
┌ ⓘ O pagamento pelo app está desligado na plataforma. Reservas e ─────────┐  Alert info
│   mensalidades seguem pagas no local.                                    │
└──────────────────────────────────────────────────────────────────────────┘
Conta de recebimento só leitura · formas de pagamento travadas em "Só no local" ·
carteira, lançamentos e contestações visíveis · (Estornar) e (Responder) desabilitados
```

### 7d. Formas de pagamento (aprovado)

```
┌ Formas de pagamento no app ───────────────────────────────────────────────┐
│ RESERVAS PELO APP                                                         │
│ ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐│
│ │ ○ Só no local        │ │ ◉ No local ou online │ │ ○ Online obrigatório ││
│ │ Como hoje: o jogador │ │ O jogador escolhe    │ │ Pagamento na reserva.││
│ │ paga no espaço.      │ │ Pix, cartão ou no    │ │ O horário fica       ││
│ │                      │ │ local. A reserva é   │ │ guardado por 15 min; ││
│ │                      │ │ confirmada na hora.  │ │ sem pagamento, é     ││
│ │                      │ │                      │ │ cancelada sozinha.   ││
│ │                      │ │                      │ │ Ajuda contra faltas. ││
│ └──────────────────────┘ └──────────────────────┘ └──────────────────────┘│
│ MENSALIDADES DE AULAS                                                     │
│ ┌──────────────────────┐ ┌──────────────────────┐                         │
│ │ ◉ Só no local        │ │ ○ No local ou online │                         │
│ └──────────────────────┘ └──────────────────────┘                         │
│ Reservas de balcão e de mensalistas continuam pagas no local.             │
│                                                       [Salvar alterações] │
└───────────────────────────────────────────────────────────────────────────┘
```

### 7e. Taxa de serviço (somente leitura)

```
┌ Taxa de serviço ──────────────────────────────── {Condição especial} ┐  badge info só com valor próprio
│ Pix                     4%                                           │
│ Cartão de crédito       6%                                           │
│ Mínimo por pagamento    R$ 1,00                                      │
│ ──────────────────────────────────────────────────────────────────── │
│ Só nos pagamentos online. O jogador paga o preço normal, sem         │
│ acréscimo; a taxa sai do valor que o espaço recebe e já inclui o     │
│ custo do Pix e do cartão. Se houver estorno, a taxa volta na mesma   │
│ proporção. Pagamentos no local não têm taxa.                         │
│ Exemplo: R$ 100,00 no Pix → taxa R$ 4,00 → o espaço recebe R$ 96,00. │
│ Abaixo de R$ 25,00 no Pix, vale o mínimo de R$ 1,00.                 │  some com Pix em 0%
└──────────────────────────────────────────────────────────────────────┘
```

## 8. Carteira (aba padrão depois de aprovado)

```
Recebimentos online
[Carteira] [Contestações 1] [Configuração]                                  abas com trilho

┌ (!) 1 contestação aguardando resposta até 12/11. ‹Responder› ───────────┐  Alert destructive
└──────────────────────────────────────────────────────────────────────────┘
┌ ⚠ Repasses pausados até a aprovação da nova conta. ──────────────────────┐  Alert warning, só
└──────────────────────────────────────────────────────────────────────────┘  depois da troca

┌ DISPONÍVEL ────────────┐ ┌ A LIBERAR ─────────────┐ ┌ REPASSADO ─────────────┐
│ R$ 1.284,40            │ │ R$ 3.912,00            │ │ R$ 18.420,75           │  4xl display
│ Entra no próximo       │ │ Vendas ainda no prazo  │ │ Enviado para a conta   │  13 muted
│ repasse automático.    │ │ de liberação.          │ │ do espaço desde a      │
│                        │ │                        │ │ ativação.              │
└────────────────────────┘ └────────────────────────┘ └────────────────────────┘

┌ A liberar por data ──────────────────────────┐ ┌ Repasses ────────────────────────┐
│ Qua, 05/11  ████████████████   R$ 1.230,00   │ │ 05/11  R$ 1.102,10  {Agendado}   │
│ Qui, 06/11  ██████             R$ 460,00     │ │ 04/11  R$ 980,00    {Repassado}  │
│ Sex, 07/11  ███                R$ 240,00     │ │ 03/11  R$ 1.340,25  {Repassado}  │
│ Sáb, 08/11                     —             │ │ 02/11  R$ 410,00    {Falhou}     │
│ …                                            │ │ Conta ****-6                     │
│ Depois de 11/11 ████████████   R$ 1.982,00   │ │ ‹Ver todos›                      │
└──────────────────────────────────────────────┘ └──────────────────────────────────┘
 barras chart-1, 8 de altura, só apoio visual: o texto da linha tem a data e o valor

Lançamentos                                                       (⤓ Exportar CSV)
[01/10/2026 – 31/10/2026 📅]  [Tipo: Todos ⌄]  [Meio: Todos ⌄]          uma linha de filtros
┌──────────────────┬──────────────────┬──────────────────────────────┬───────┬──────────┬─────────────┐
│ Data             │ Tipo             │ Descrição                    │ Meio  │ Libera em│       Valor │
├──────────────────┼──────────────────┼──────────────────────────────┼───────┼──────────┼─────────────┤
│ 04/11/2026 18:42 │ Venda            │ Reserva · Maria O. · 08/11   │ Pix   │ 05/11    │ + R$ 120,00 │ amount-positive
│ 04/11/2026 18:42 │ Taxa de serviço  │ Reserva · Maria O. · 08/11   │ Pix   │ 05/11    │ − R$ 4,80   │ foreground
│ 03/11/2026 09:10 │ Estorno ao cliente│ Mensalidade · João · nov    │ Cartão│ —        │ − R$ 40,00  │
│ 03/11/2026 09:10 │ Taxa devolvida   │ Mensalidade · João · nov     │ Cartão│ —        │ + R$ 2,40   │
│ 03/11/2026 06:00 │ Repasse          │ Para a conta ****-6          │ —     │ —        │ − R$ 980,00 │
└──────────────────┴──────────────────┴──────────────────────────────┴───────┴──────────┴─────────────┘
                                                     ‹ Anterior   Página 1 de 4   Próxima ›
```

### Contestações (aba)

```
┌──────────┬───────────┬──────────────────────┬──────────┬───────────────────┬─────────────────────┬────────────┐
│ Aberta em│ Cliente   │ Item                 │ Valor    │ Responder até     │ Situação            │            │
├──────────┼───────────┼──────────────────────┼──────────┼───────────────────┼─────────────────────┼────────────┤
│ 04/11    │ Maria O.  │ Reserva · 08/11 18:00│ R$ 120,00│ 12/11 · faltam 3 d│ {Aguardando resposta}│(Responder) │
│ 20/10    │ Pedro A.  │ Mensalidade · out    │ R$ 180,00│ 28/10             │ {Resposta enviada}  │ ‹Ver›      │
└──────────┴───────────┴──────────────────────┴──────────┴───────────────────┴─────────────────────┴────────────┘

Diálogo "Responder contestação"
┌──────────────────────────────────────────────────────────┐
│ Responder contestação                                    │
│ Maria Oliveira contestou R$ 120,00 com o banco do cartão │
│ (reserva de 08/11, 18:00). Quem decide é o banco.        │
│ O valor já saiu do saldo, e a taxa de serviço dele foi   │
│ devolvida. Se o banco der razão ao espaço, o valor volta.│
│                                                          │
│ Sua resposta                                             │
│ ┌──────────────────────────────────────────────────────┐ │
│ │                                                      │ │
│ └──────────────────────────────────────────────────────┘ │
│ Conte o que comprova o serviço: reserva usada,  0/2000   │
│ conversa com o cliente, horário de chegada.              │
│ Anexos (opcional)                                        │
│ (⤒ Adicionar arquivo)  PDF, JPG ou PNG, até 5 MB, até 3  │
│                                                          │
│                         (Cancelar)  [Enviar resposta]    │
└──────────────────────────────────────────────────────────┘
```

## 9. Detalhe da reserva e da mensalidade

Seção "Valores" do `BookingDetailSheet` (e o diálogo de pagamentos da mensalidade). Pix de R$ 120,00, taxa de 4%, estorno de R$ 40,00 com abatimento (decisão 93):

```
VALORES
Total                                   R$ 120,00
Abatimento por estorno                − R$ 40,00
Recebido                                R$ 80,00
Em aberto                               R$ 0,00
┌──────────────────────────────────────────────────┐
│ R$ 120,00 · Pix              [Online]            │  registro ONLINE: etiqueta, sem "Estornar" manual
│ 08/11/2026 18:42                                 │
└──────────────────────────────────────────────────┘
(se o estorno fosse "cobrar de novo": sem a linha de abatimento,
 Recebido R$ 80,00 · Em aberto R$ 40,00 e o botão Receber de volta)

PAGAMENTO ONLINE
┌──────────────────────────────────────────────────┐
│ ⌗ Pix · pago em 08/11 18:42      {Estorno parcial}│
│ Valor pago                           R$ 120,00   │
│ Taxa de serviço (4%)               − R$ 4,80     │  % gravado na cobrança; "(mínimo)" se valeu o mínimo
│ Estornado ao cliente               − R$ 40,00    │
│ Taxa devolvida                     + R$ 1,60     │  amount-positive
│ ──────────────────────────────────────────────── │
│ O espaço recebe                      R$ 76,80    │  font-medium
│ Libera em 09/11 · Transação a8f3…91c2 ⧉          │  xs muted
│ Estorno em 09/11 por Ana (Admin):                │
│ "Quadra sem iluminação" · abatido do valor       │
│                                     (Estornar)   │  Dono/Admin, se ainda há valor
└──────────────────────────────────────────────────┘
```

Cobrança aberta (modo opcional; também na reserva aguardando pagamento):

```
PAGAMENTO ONLINE
┌──────────────────────────────────────────────────┐
│ ⌗ Pix aberto até 18:47     {Aguardando pagamento}│  sem valores nem ações
└──────────────────────────────────────────────────┘

Receber (PaymentDialog) com Pix aberto:
┌ ⚠ O cliente tem um Pix aberto pelo app até 18:47. ──────┐  Alert warning
│   Registrar o pagamento no local cancela essa cobrança. │
└──────────────────────────────────────────────────────────┘
Em PENDING_PAYMENT não existe "Receber".
Se a API recusar (já pago): "O cliente acabou de pagar pelo app. A reserva foi atualizada."
```

Diálogo de estorno (segundo estorno, depois dos R$ 40,00):

```
┌──────────────────────────────────────────────────────────┐
│ Estornar pagamento online                                │
│ Pix de R$ 120,00 · Maria Oliveira · pago em 08/11        │
│ Já estornado: R$ 40,00                                   │
│                                                          │
│ Quanto devolver                                          │
│ ┌────────────────────────────┐ ┌───────────────────────┐ │
│ │ ○ Tudo o que falta         │ │ ◉ Parte do valor      │ │  OptionCards
│ │   R$ 80,00                 │ │                       │ │
│ └────────────────────────────┘ └───────────────────────┘ │
│ Valor a devolver                                         │
│ [ R$ 30,00              ]                                │
│ Até R$ 80,00                                             │
│ O valor devolvido volta a ser cobrado?                   │
│ ┌────────────────────────────┐ ┌───────────────────────┐ │
│ │ ◉ Não, é um abatimento     │ │ ○ Sim, cobrar de novo │ │  padrão: não (decisão 93)
│ │   A reserva continua paga; │ │   O valor devolvido   │ │
│ │   o valor devolvido vira   │ │   volta a ficar em    │ │
│ │   desconto.                │ │   aberto para receber │ │
│ │                            │ │   no local.           │ │
│ └────────────────────────────┘ └───────────────────────┘ │
│ Motivo                                                   │
│ [ Chuva interrompeu o jogo                          ]    │
│ O cliente vê este motivo no app.                         │
│ ┌──────────────────────────────────────────────────────┐ │  bg-muted, raio 12
│ │ O cliente recebe          R$ 30,00 no Pix            │ │
│ │ Taxa devolvida ao espaço  + R$ 1,20                  │ │  regra acumulada (decisão 94):
│ │ O espaço deixa de receber − R$ 28,80                 │ │  round(480 × 7000 ÷ 12000) − 160
│ │ Fica em aberto na reserva R$ 0,00                    │ │  = 280 − 160 = 120
│ │ Estimativa; o valor final aparece nos lançamentos.   │ │
│ └──────────────────────────────────────────────────────┘ │
│ Para cancelar a reserva e devolver tudo, use Cancelar    │
│ reserva: o estorno é automático.                         │
│                       (Cancelar)  [Estornar R$ 30,00]    │  destructive
└──────────────────────────────────────────────────────────┘
```

Reserva aguardando pagamento, na agenda e na lista:

```
Agenda (bloco)                       Lista de reservas
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐           │ 18:00 Quadra 1 · Maria O. {Aguardando pagamento} │
╎ 18:00 Maria O.          ╎           │ Guardado até 18:47                               │
╎ Aguardando pagamento    ╎  borda tracejada 1.5 warning-subtle-border, fundo warning-subtle
╎ até 18:47               ╎
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

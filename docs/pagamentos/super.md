# Pagamento online · mockups do `/super` (PG.1)

Esboços em 1280 px. Especificação completa em [`05-design-system.md`, "Pagamento online"](../05-design-system.md#pagamento-online). No `/super` os termos técnicos (gateway, tarifa, chargeback) são aceitos: o público é a equipe da plataforma.

Novo item na navegação do Super, logo abaixo de "Financeiro": **Pagamento online** (`CreditCard`), em `/super/pagamentos`, com abas na URL (`?aba=receita|taxas|cadastros|simulador`). A aba "Simulador" só existe quando a API expõe as rotas (gateway fake).

Com o pagamento online desligado (`PAYMENTS_PROVIDER=none`), todas as abas ganham no topo:

```
┌ ⓘ Pagamento online desligado (PAYMENTS_PROVIDER=none). Nenhuma cobrança nova é ┐  Alert info
│   criada; o histórico continua aqui.                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```
As taxas seguem editáveis, a receita mostra o histórico e a aba Simulador some.

## 10a. Receita

```
Pagamento online
[Receita] [Taxas] [Cadastros 2] [Simulador]

[Período: 01/10/2026 – 31/10/2026 📅]  [Espaço: Todos ⌄]  [Meio: Todos ⌄]   (⤓ Exportar CSV) (⤓ Relatório NFS-e)

┌ VOLUME PAGO ─┐ ┌ TAXA BRUTA ──┐ ┌ TARIFA DO GATEWAY ┐ ┌ TAXA DEVOLVIDA ┐ ┌ RECEITA LÍQUIDA ┐
│ R$ 48.210,00 │ │ R$ 2.344,60  │ │ − R$ 611,20       │ │ − R$ 96,40     │ │ R$ 1.637,00     │
│ 402 pagtos.  │ │ 4,9% do vol. │ │                   │ │ 7 estornos     │ │ = bruta − tarifa│
└──────────────┘ └──────────────┘ └───────────────────┘ └────────────────┘ │   − devolvida   │
                                                                          └─────────────────┘
[Por espaço] [Por mês] [Por meio]                                             abas com trilho
┌──────────────────┬───────┬─────────────┬────────────┬───────────┬───────────┬────────────┐
│ Espaço           │ Pagtos│ Volume      │ Taxa bruta │ Tarifa    │ Devolvida │ Líquida  ↓ │
├──────────────────┼───────┼─────────────┼────────────┼───────────┼───────────┼────────────┤
│ Arena Beira-Mar  │ 210   │ R$ 25.200,00│ R$ 1.228,00│ R$ 318,40 │ R$ 48,00  │ R$ 861,60  │
│ Escola Areia     │ 120   │ R$ 15.010,00│ R$   720,60│ R$ 190,10 │ R$ 30,40  │ R$ 500,10  │
│ …                                                                                        │
├──────────────────┼───────┼─────────────┼────────────┼───────────┼───────────┼────────────┤
│ Total            │ 402   │ R$ 48.210,00│ R$ 2.344,60│ R$ 611,20 │ R$ 96,40  │ R$ 1.637,00│  font-medium
└──────────────────┴───────┴─────────────┴────────────┴───────────┴───────────┴────────────┘

Diálogo "Relatório para NFS-e": mês (select) → CSV `taxas-nfse-2026-10.csv`
(Espaço, Documento, Taxa bruta, Taxa devolvida, Base da nota)
```

## 10b. Taxas

```
┌ Taxa padrão ───────────────────────────────────────────────────────┐
│ Pix                [ 4,00 % ]                                      │
│ Cartão de crédito  [ 6,00 % ]                                      │
│ Mínimo             [ R$ 1,00 ]                                     │
│ Quem paga          Espaço  (pagamento pelo jogador: decisão futura)│  só leitura
│ R$ 100,00 no Pix → taxa R$ 4,00 · no cartão → R$ 6,00              │  exemplo ao vivo
│ Última alteração: 04/11/2026 por Lucas                             │
│                                              [Salvar taxa padrão]  │
└────────────────────────────────────────────────────────────────────┘
Confirmação: "A nova taxa vale para cobranças criadas a partir de agora.
As já criadas mantêm a taxa da época." (Cancelar) [Salvar]

┌ Condições especiais por espaço ─────────────── [+ Adicionar condição] ┐
│ Espaço           │ Pix    │ Cartão  │ Mínimo  │ Atualizado      │      │
│ Arena Beira-Mar  │ 3,00 % │ padrão  │ R$ 0,50 │ 01/11 · Lucas   │ ‹Editar› ‹Remover› │
└───────────────────────────────────────────────────────────────────────┘
Campo vazio = padrão. "Remover" pede confirmação: "O espaço volta à taxa padrão
nas próximas cobranças."
```

## 10c. Cadastros no gateway

```
(Todos) (Em análise 2) (Recusados 1) (Aprovados 14) (Não iniciados 31)       ChipButton
┌──────────────────┬───────────────┬──────────────────────┬──────────┬──────────┬───────────────────────────┐
│ Espaço           │ Situação      │ Documento            │ Enviado  │ Decidido │ Motivo                    │
├──────────────────┼───────────────┼──────────────────────┼──────────┼──────────┼───────────────────────────┤
│ Arena Sol        │ {Em análise}  │ CNPJ 12.***.***/0001 │ 04/11    │ —        │ —                         │
│ Quadra Norte     │ {Recusado}    │ CPF ***.456.***-**   │ 02/11    │ 02/11    │ Documento não confere…    │
└──────────────────┴───────────────┴──────────────────────┴──────────┴──────────┴───────────────────────────┘
O nome do espaço leva ao detalhe do espaço no Super.
```

## 10d. Simulador (só com o gateway fake)

```
┌▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓┐
▓ ⚗  SIMULADOR · AMBIENTE DE TESTE                                        ▓  bg-sandbox, borda sandbox-border,
▓ Estas ações fingem eventos do parceiro de pagamentos. Só existem com    ▓  texto sandbox-foreground
▓ o gateway simulado e nunca em produção. Nada aqui movimenta dinheiro.   ▓
└▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓┘

┌ Cobranças pendentes ───────────────────────────────────────────────────────┐   borda tracejada
│ Espaço        │ Item                   │ Valor     │ Meio │ Vence     │      │   sandbox-border
│ Arena Beira-M │ Reserva · 08/11 18:00  │ R$ 120,00 │ Pix  │ 18:47     │ (Pagar) (Vencer) │
└────────────────────────────────────────────────────────────────────────────┘
┌ Contestação ───────────────────────┐ ┌ Cadastros em análise ───────────────┐
│ Cobrança paga com cartão [⌄]       │ │ Arena Sol   (Aprovar) (Recusar)     │
│ (Gerar contestação)                │ │                                     │
└────────────────────────────────────┘ └─────────────────────────────────────┘
┌ Saldos ─────────────────────────────────────────────────────────────────────┐
│ Espaço [Todos ⌄]   (Liberar tudo agora)   (Rodar repasse)                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

Com o fake ligado, a barra superior do `/super` mostra também o selo "Ambiente de teste" ao lado do rótulo "Painel da plataforma".

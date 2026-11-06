# 13 · Pagamento online, carteira do espaço e taxa de serviço

Decisões 80 a 98 (`07-perguntas-em-aberto.md`). Requisitos RF-ONPAY e RN-ONPAY (`02-requisitos-funcionais.md`, seção 11). Tabelas em `04-modelo-de-dados.md`, seção "Pagamento online". Briefing em `tarefas/pagamentos-1.md`.

## 1. Resumo

- O jogador paga **reservas** e **mensalidades de aulas** pelo app, por **Pix** ou **cartão de crédito** (à vista). Pagar no local continua existindo.
- O dinheiro **não fica na plataforma**: o gateway divide cada pagamento na hora (*split*). A parte do espaço vai para a **subconta do espaço** no gateway e a **taxa da plataforma** vai para a conta do Space Sports. A plataforma não guarda saldo de ninguém.
- **Sem saldo pré-pago, crédito ou cashback** para o jogador (decisão 81). Estorno volta para o meio de pagamento original.
- **Quem paga a taxa é o espaço**, descontada do repasse e com tudo incluso (decisão 82). O campo "quem paga" já existe por espaço para, no futuro, permitir repassar a taxa ao jogador, sempre destacada antes do pagamento.
- **Gateway desacoplado** (decisão 80): uma interface `PaymentGateway` com um único adaptador **fake** (simulado) por enquanto. A escolha do provedor real (Asaas, Pagar.me, Mercado Pago etc.) fica para depois e não muda o restante do sistema.

## 2. Pesquisa de mercado (Brasil, nov/2026)

| Serviço | Quem paga | Modelo |
|---|---|---|
| Arena App | Arena (plano grátis) | 5% de comissão por reserva paga no plano grátis; 0% no plano pago (R$ 259,90/mês). Só Pix, com Pix Automático para mensalistas. A taxa aparece antes de pagar. |
| Atacante App | Arena | Plano a partir de R$ 199; taxa só sobre o que é vendido online. Reserva paga no local não tem taxa. Pagamento antecipado contra no-show. |
| Gripo | Arena | Pix a 0,89% com mínimo de R$ 0,89; R$ 4,80 por dupla em torneios. |
| Groopin | Organizador | 8% (Free) a 3% (Pro Plus) nas inscrições, mais o processamento do Pix ou do cartão à parte. |
| SpotMatch | Arena, com opção de repassar | Sem taxa para reservar; R$ 2 por inscrição de torneio, que a arena pode repassar ao atleta. |
| Arena Manager | Arena | Caso divulgado: o pré-pagamento obrigatório por Pix reduziu o no-show em 71%. |
| Tecnofit (academias) | Academia | Sem mensalidade pela recorrência; tarifa por transação aprovada mais a do adquirente. |
| Playtomic (global, marketplace) | Jogador | Taxa de serviço por transação online, com mínimo e máximo por país; não devolvida no cancelamento pelo jogador, devolvida quando o clube cancela. Assinatura premium isenta. |

**Leitura para o Space Sports:**
1. No Brasil, os sistemas de gestão de arenas cobram **do espaço**, com percentual entre ~3% e 8% ou valor fixo por transação, e muitas vezes trocam a comissão por um plano mensal maior. A taxa cobrada do jogador aparece em quem é **marketplace com demanda própria** (Playtomic) ou em **inscrição de torneio**, como opção de repasse.
2. O jogador brasileiro está acostumado com **Pix gratuito** direto para a arena. Taxa para o jogador, com a opção de pagar no local, empurra o pagamento para fora do app.
3. Quem mais ganha com o pagamento online é o espaço: menos no-show, menos inadimplência e conciliação automática.
4. **Jurídico (CDC/STJ):** a taxa de conveniência cobrada do consumidor é aceita quando informada antes, com o valor destacado (STJ, EDcl no REsp 1.737.428/RS, 2020; REsp 1.984.261/SP, 2024). No cancelamento, há entendimento de devolução integral, incluindo a taxa. Com a taxa no espaço, o problema não existe.
5. **Regulação (Banco Central):** marketplace que não é instituição de pagamento não deve centralizar o dinheiro de terceiros. O caminho é o *split* com subcontas no gateway (Circular 3.682/2013 e normas posteriores sobre arranjos de pagamento). Saldo pré-pago na plataforma configuraria emissão de moeda eletrônica.

Fontes: [Arena App](https://arenaapp.app.br/), [Atacante App](https://atacante.app/), [Gripo](https://www.gripo.com.br/en/), [Groopin](https://groopin.app/torneio-beach-tennis), [SpotMatch](https://www.spotmatch.com.br/sou-proprietario), [Arena Manager](https://arenamanager.com.br/), [Tecnofit: gateways e taxas](https://helpdesktecnofit.freshdesk.com/pt-BR/support/solutions/articles/67000697662-quais-s%C3%A3o-os-gateway-de-pagamento-e-suas-taxas-), [Playtomic: taxa de serviço](https://playerhelp.playtomic.com/hc/pt/articles/19831779272337-Taxa-de-servi%C3%A7o), [Dizer o Direito: taxa de conveniência](https://www.dizerodireito.com.br/2019/05/e-proibido-que-se-cobre-taxa-de.html), [Correio Braziliense: STJ 2024](https://blogs.correiobraziliense.com.br/jusbraziliense/2024/10/10/taxa-de-conveniencia-para-compra-on-line-de-ingressos-e-legal/amp/), [Asaas: split e normas](https://blog.asaas.com/split-de-pagamento/), [Transfeera: split em marketplace](https://transfeera.com/blog/split-de-pagamentos-marketplace/). As páginas comerciais mudam; confira antes de usar em proposta.

## 3. Taxa da plataforma

- **Quem paga:** o espaço (`fee_payer = SPACE`), descontada do repasse. `PLAYER` existe no modelo, mas só é liberado por decisão futura. Nesse caso, a taxa aparece destacada antes do pagamento e volta junto no estorno integral.
- **Valor:** percentual por meio de pagamento com mínimo fixo, **tudo incluso**: a tarifa do gateway sai da parte da plataforma, e o espaço vê um único número.
  - Padrão inicial (editável no `/super`, sem deploy): **Pix 4%**, **cartão 6%**, **mínimo R$ 1,00**. O cartão custa ao gateway várias vezes o Pix, e o Pix é o meio preferido no Brasil.
  - O Super pode sobrescrever por espaço (negociação comercial).
  - `taxa = min(valor, max(arredonda(valor × bps / 10000), mínimo))`, em centavos, com arredondamento meio para cima.
- **Snapshot:** cada cobrança guarda as regras usadas (bps, mínimo, quem paga), a taxa, a tarifa do gateway (simulada) e o líquido do espaço. Mudar a taxa não altera cobranças já criadas. O painel recebe o `feeBps` gravado e `minFeeApplied` (a taxa ficou no mínimo).
- **Taxa devolvida (decisão 94):** regra acumulada. Cada estorno devolve `arredondar(taxa × estornado_acumulado ÷ pago) − taxa_já_devolvida` e o que zera o pago devolve exatamente o resto. Ex.: Pix de R$ 20,00 com taxa mínima de R$ 1,00 e três estornos de R$ 3,30 + o resto devolvem R$ 0,17 + 0,16 + 0,17 + 0,50 = R$ 1,00. Contestação ganha pelo espaço cobra de novo a taxa devolvida.
- **Receita da plataforma** = taxa − tarifa do gateway − taxa devolvida em estornos + taxa recobrada na contestação ganha. O `/super` mostra isso por espaço e por mês, com CSV para a NFS-e mensal de cada espaço (emitida fora da plataforma, decisão 91; base = taxa − devolvida + recobrada). Os números saem do livro-razão (`PLATFORM_FEE`, `FEE_REFUND` e a recobrança) **pela data de cada lançamento**: o estorno feito em dezembro de uma venda de novembro entra em dezembro, e o mês fechado (a nota já emitida) não muda.

## 4. Modos de pagamento por espaço

O Dono ou Admin configura, separadamente para reservas e para aulas. Só fica disponível com o cadastro no gateway `APPROVED`.

| Modo | Reservas pelo app | Mensalidades de aula |
|---|---|---|
| `ON_SITE` (padrão) | Como hoje: forma pretendida, pagamento no local | Como hoje |
| `ONLINE_OPTIONAL` | O jogador escolhe: no local, Pix ou cartão | O aluno pode pagar online ou no local |
| `ONLINE_REQUIRED` | Pagamento antecipado obrigatório para reservar | Não se aplica a aulas |

Reservas de balcão e ocorrências de mensalista continuam pagas no local. A gestão pode gerar um link de pagamento para uma reserva de balcão (opcional, PG.2).

## 5. Reservas

- **`ONLINE_REQUIRED`:** a reserva nasce em `PENDING_PAYMENT` e **segura o horário por 15 minutos, no máximo até o início** (`payment_due_at = min(início, agora + 15 min)`). Começando em menos de 5 minutos, não dá tempo de pagar: a criação responde 422 `BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT` ("escolha outro horário"). Quando o pagamento é confirmado, ela vira `CONFIRMED`. Se o prazo vence (job a cada minuto e também na leitura), vira `CANCELLED` com motivo `PAYMENT_EXPIRED` e o horário é liberado; o espaço não é avisado e o jogador recebe só "Reserva cancelada" (sem "O Pix venceu"). Cartão recusado permite tentar de novo dentro do prazo, na cobrança da mesma reserva. O organizador pode **desistir** antes de pagar (`PAYMENT_ABANDONED`, decisão 96). Em `PENDING_PAYMENT` não há registro manual no local.
- **`ONLINE_OPTIONAL` com pagamento online:** a reserva nasce `CONFIRMED` como hoje, com a cobrança online aberta (Pix de 15 min, até o início). Se o Pix vencer, a reserva continua com pagamento `PENDING`, e o jogador pode pagar no local ou gerar nova cobrança até o início.
- **Cobranças concorrentes (decisão 96):** cobrança nova só depois de cancelar a anterior no gateway; se ela já foi paga, vale a paga. Pagamento confirmado em cobrança `CANCELLED`/`EXPIRED`, depois do prazo da reserva (Pix ou cartão) ou para reserva já cancelada é estornado sozinho (integral, taxa devolvida) e aparece em Meus pagamentos, com o motivo `PAID_AFTER_DEADLINE` ou `PAID_AFTER_METHOD_CHANGE`; a cobrança fechada não volta a `PAID`. Registrar pagamento no local cancela a cobrança aberta e é recusado (`ONLINE_CHARGE_ALREADY_PAID`) se ela já foi paga. O app manda `Idempotency-Key` na criação da reserva e da cobrança; a chave vale por pagador. A API guarda junto da chave um hash do pedido (reserva: espaço, quadra, esporte, horário, duração, pessoas, forma pretendida e `paymentOption`; cobrança: o item e o meio; o token do cartão fica de fora, porque cada tokenização gera outro): a mesma chave com outro pedido responde 422 `IDEMPOTENCY_KEY_REUSED`, sem criar nada. Criar, trocar e registrar no local é **um por item de cada vez** (trava por item enquanto o gateway responde): dois toques no "Pagar" geram uma cobrança só. Status, prazo de cancelamento e valor do registro manual são conferidos **antes** de cancelar qualquer coisa no gateway.
- Sempre a **reserva inteira** (decisão 50). Dividir a conta com cada um pagando a sua parte fica para depois.
- Com pagamento online confirmado, a edição de data, horário e duração segue a regra atual: com pagamento, "fale com o espaço". Com Pix aberto, a edição cancela a cobrança no gateway antes de mudar a reserva; se ela tinha acabado de ser paga, o pagamento entra e a edição é barrada.
- O pagamento confirmado cria um `payment_record` com `channel = ONLINE`, sem `recorded_by`. Por isso o "A receber", o extrato e o financeiro do Super já enxergam o pagamento.

## 6. Aulas

- Com o modo de aulas `ONLINE_OPTIONAL`, cada mensalidade em aberto ganha "Pagar agora" no app (Pix ou cartão à vista). A cobrança é criada na hora, e o Pix vale 24 h.
- O pagamento confirmado marca a mensalidade como `PAID` pelo fluxo atual: o `payment_record` online tira a assinatura de `PAST_DUE`.
- Ficam para depois: cartão recorrente automático e Pix Automático (dependem do gateway real).

## 7. Cancelamento, estorno e chargeback (decisões 86 e 87)

| Situação | Jogador recebe | Taxa da plataforma |
|---|---|---|
| Jogador cancela dentro do prazo | Estorno integral automático | Devolvida ao espaço |
| Espaço cancela (a qualquer momento) | Estorno integral automático | Devolvida ao espaço |
| Fora do prazo / no-show | Nada (o app já bloqueia o cancelamento) | Mantida |
| Estorno manual pela gestão (Dono/Admin, total ou parcial) | O valor escolhido | Devolvida pela regra acumulada |
| Chargeback (contestação no cartão) | Definido pelo emissor | Devolvida pela regra acumulada; o valor sai do saldo do espaço |
| Pagamento depois do prazo ou numa cobrança trocada | Estorno integral automático | Devolvida ao espaço |
| Exclusão da conta: reservas futuras e mensalidades de meses ainda não começados | Estorno integral automático, para o meio original | Devolvida ao espaço |

- A tarifa do gateway num estorno é custo da plataforma.
- **Saldo reembolsável** = pago − estornado − estornos ainda pendentes. Cobrança com **contestação ganha** volta a aceitar estorno: o cancelamento no prazo estorna o total e o estorno manual funciona.
- **Estorno sem o gateway:** o estorno vai pelo provedor gravado na cobrança. Se ele não está disponível (gateway `none`, outro provedor ou falha na hora), o estorno automático fica `PENDING` e a reconciliação o conclui; o cancelamento ou a exclusão que o pediu segue normalmente. O estorno manual responde erro e não grava nada.
- Estorno de uma venda que ainda não liberou sai do **a liberar** (mesma data da venda), sem deixar o disponível negativo.
- **Exclusão da conta (RF-AUTH-03):** ao confirmar o pedido, antes da anonimização, a API estorna inteiro (`ACCOUNT_DELETED`) o que foi pago online nas reservas futuras canceladas e nas mensalidades de meses ainda não começados, que ficam dispensadas, e fecha as cobranças abertas do titular. A mensalidade do mês em curso e as vencidas não são estornadas. O gateway guarda o pagador, então o dinheiro volta ao mesmo Pix ou cartão.
- **Valor do estorno manual:** sempre explícito, também no "tudo o que falta" (a tela manda o `refundableCents` que mostrou). Se passou do reembolsável atual (outro estorno ou uma contestação no meio), a API responde 422 `REFUND_EXCEEDS_BALANCE` com o reembolsável novo, e nada é estornado.
- **Estorno manual e o saldo do item (decisão 93):** o campo **volta a ser cobrado** (`chargeAgain`) decide. Padrão (não): o valor vira **abatimento** do item (`discount_cents` na reserva ou na mensalidade; saldo em aberto zero). Sim: o valor volta a ficar em aberto. O cancelamento da reserva continua sendo o caminho do estorno integral.
- O `payment_record` online acompanha o que ficou pago: o estorno parcial reduz o valor (o extrato e o financeiro contam só o líquido) e o total o estorna.
- O chargeback é responsabilidade do espaço (padrão de marketplace). O espaço é avisado com o prazo e pode responder (texto e links de anexos; simulado no fake): `AWAITING_RESPONSE → RESPONDED → WON | LOST`. Ganha, o valor volta, a taxa devolvida é cobrada de novo e o pagamento volta a valer no item; a cobrança continua `CHARGEBACK` e volta a aceitar estorno.

## 8. Carteira do espaço

Painel, Dono e Admin. É um espelho do que o gateway informa, mantido num **livro-razão** (`space_ledger_entries`):
- **Saldo disponível**, **a liberar** (por data) e **total repassado**.
- Lançamentos: venda, taxa da plataforma, estorno, taxa devolvida, chargeback, repasse e ajuste. Filtros por período, tipo e meio (Pix ou cartão: os lançamentos que têm cobrança desse meio, inclusive o ajuste da contestação ganha; repasses e o ajuste do repasse que falhou ficam de fora), paginação com o total de lançamentos dos filtros ("Página 1 de N") e CSV com os mesmos filtros.
- **Repasses** automáticos para a conta bancária do espaço (diários no fake). Sem saque manual nesta etapa.
- Prazo de liberação simulado no fake: Pix D+1 e cartão D+30 (configurável no adaptador).

O jogador **não tem carteira com saldo**. Ele tem **Meus pagamentos**: histórico das cobranças online, status, comprovante e estornos.

## 9. Cadastro do espaço no gateway (KYC)

Só o Dono preenche, **fora do modo suporte** (decisão 95): CPF ou CNPJ, nome ou razão social, responsável (com CNPJ, também o **CPF do responsável**, obrigatório; com CPF, o titular é o responsável e o campo não vai), telefone, e-mail, endereço, conta bancária ou chave Pix e aceite dos termos. A API repassa ao gateway. A **conta bancária fica só mascarada**. O **documento completo** fica guardado **cifrado** (AES-256-GCM na aplicação, decisão 97; chave `PAYMENTS_DATA_KEY`, obrigatória em produção e gerada a cada boot no dev e nos testes; o `space_id` entra como dado associado, então o texto cifrado de um espaço não abre em outro) e é decifrado só no relatório fiscal do Super (base da NFS-e, decisão 91), com cada leitura auditada (`super.payment_report.view`/`export_csv`); painel e app sempre recebem o documento mascarado. O CPF do responsável vai ao gateway e a API guarda **só o mascarado** (`responsibleCpfMasked`): ela nunca o usa depois do envio, então não guarda nem cifrado (minimização, LGPD). A chave nunca muda num ambiente com cadastros: sem ela, os documentos ficam ilegíveis (o relatório os mostra vazios). Status: `NOT_STARTED → PENDING → APPROVED | REJECTED` (com motivo, e o Dono pode reenviar). Depois da primeira aprovação, o cadastro não é reenviado (409 `MERCHANT_ACCOUNT_APPROVED`, decisão 98): o espaço nunca refaz o cadastro nem cria outra subconta, só troca a conta. No fake, a aprovação é automática após alguns segundos, e um documento terminado em `0000` força a recusa (a dica vem da API).

**Troca da conta de recebimento (decisões 95 e 98):** só o Dono, fora do modo suporte, com o cadastro já aprovado. O cadastro volta para `PENDING`, os repasses ficam pausados até a decisão (`payoutsPaused`; as cobranças continuam) e todos os Donos recebem notificação e e-mail; auditado. Aprovada, vale a nova conta. **Recusada, não derruba o espaço:** volta a valer a conta aprovada anterior (`APPROVED`, repasses retomados, pagamento online segue), a conta recusada, o motivo e a data ficam em `lastRejectedPayoutChange` para a tela (até o Dono pedir outra troca) e todos os Donos recebem `MERCHANT_PAYOUT_CHANGE_REJECTED` com e-mail (auditado `merchant_account.payout_change_rejected`). No gateway, a subconta informa a última troca (`payoutChange`, com a chave de idempotência do pedido) separada do status dela; no fake, a troca é aprovada sozinha e o simulador do Super pode recusá-la ("Recusar cadastro" com uma troca em análise decide a troca; num espaço aprovado sem troca em análise, não tem efeito).

Como a API garante a troca (revisão da PG.2b):
- **Intenção antes do gateway:** a API grava `PENDING`, a conta aprovada guardada e o **id da troca** (`payout_change_id`, mandado como chave de idempotência) e só então chama o gateway. O webhook da decisão que chegar antes do fim da chamada já encontra a troca. Se o gateway falha, a API consulta a subconta pela chave: registrada, a troca vale; não registrada (ou sem resposta), a intenção é desfeita e a resposta é 502 `PAYMENT_GATEWAY_UNAVAILABLE`.
- **A decisão vale para a troca com o mesmo id**, e só uma vez: a atualização parte do `PENDING` e do id lidos, então dois `account.updated` em paralelo voltam a conta, auditam e avisam uma vez. A decisão de uma troca anterior não fecha a nova. Duas trocas seguidas antes da decisão guardam a conta aprovada (não a da primeira troca).
- **Reconciliação:** a cada 10 min, os cadastros `PENDING` há mais de **N = 15 min** (`MERCHANT_RESYNC_AFTER_MIN`) são ressincronizados com o gateway (webhook perdido). A troca que o gateway não conhece depois desse prazo (queda entre a intenção e a chamada) é desfeita como não confirmada ("Não foi possível confirmar a troca com o parceiro de pagamentos. Tente de novo."), com o aviso da troca recusada.
- **Troca antiga** (feita antes do id e da conta guardada): a decisão do gateway vale sem conferir o id; recusada sem conta anterior conhecida, o cadastro fica `APPROVED` com a conta atual, a recusa vai para `lastRejectedPayoutChange` e os Donos são avisados (auditoria com `previousUnknown`).

## 10. Gateway desacoplado e simulador

- Interface `PaymentGateway`: criar subconta, consultar status, criar cobrança Pix (QR e copia e cola, validade), cobrar cartão (token), estornar (total ou parcial), consultar cobrança (pelo id ou **pela chave de idempotência da criação**), validar e traduzir webhook. Todo valor em centavos e cada chamada com chave de idempotência.
- **Criação com resultado desconhecido** (timeout, conexão caída): o gateway pode ter criado a cobrança, e no cartão pode até ter cobrado. A API consulta pela chave: existe, vale o que o gateway tem; não existe, `FAILED`; sem resposta, a cobrança fica **pendente de verificação** (`PENDING` sem id do gateway, 502 com `details.verification = PENDING`) e a reconciliação ou a próxima tentativa resolve pela chave. Nunca vira `FAILED` às cegas.
- `PAYMENTS_PROVIDER=fake|none` (outros provedores no futuro). Em `production`, `fake` é proibido: a API não sobe. O staging, que roda a build de produção, declara `DEPLOY_ENV=staging` para usar o fake. Com `none`, o pagamento online fica desligado e todos os espaços ficam em `ON_SITE`.
- **Webhooks:** `POST /v1/webhooks/payments/:provider`, assinatura verificada e evento gravado uma única vez (`gateway_events`, único por provedor + id do evento). O processamento é assíncrono (BullMQ), idempotente e tolerante a eventos fora de ordem: cada evento só pede uma sincronização, e a API consulta a cobrança no gateway e aplica o estado dela (o status só avança). Um job de reconciliação (10 min) consulta as cobranças pendentes (inclusive as pendentes de verificação), conclui os estornos pendentes e reprocessa os eventos parados. Webhook de uma cobrança sem linha local com aquele id casa pela chave de idempotência; sem dono nenhum, o pago é estornado e o aberto cancelado no gateway (auditado `payment.online.orphan`). A rota guarda o corpo bruto em qualquer content-type (a assinatura confere os bytes exatos). Assinatura válida com corpo ilegível (não é JSON, vazio): o adaptador lança `InvalidWebhookPayload` e a rota responde 400 `INVALID_WEBHOOK_PAYLOAD`; JSON válido sem o formato de evento responde 200 com `received: 0`.
- **Fake:** gera um Pix de mentira (QR em SVG com os módulos em `currentColor` e sem fundo, e o copia e cola no formato do BR Code), aprova cartões de teste (`4111 1111 1111 1111` aprova, `4000 0000 0000 0002` recusa, `4000 0000 0000 0259` aprova e depois gera chargeback), libera saldo pelas datas simuladas (Pix D+1, cartão D+30), cobra a tarifa simulada (Pix 0,99%; cartão 3,49% + R$ 0,39), repassa todo dia às 06:00 e emite webhooks assinados (HMAC) para a própria API pela fila. Guarda o próprio estado em `fake_gateway_objects`. Os cartões de teste e a dica do documento de recusa vão nas respostas (`paymentEnvironment.sandbox`): nada do fake fica fixo no web ou no app. O tokenizador de teste (`packages/shared/src/fake-card.ts`: `fakeCardToken`, formato `tok_fake_<cenário>_<bandeira>_<últimos 4>`) é o **contrato desse ambiente**: o app só o usa quando `paymentEnvironment.sandbox` vem preenchido, e o adaptador fake lê o mesmo formato. Com um gateway real, o SDK do provedor gera o token e nada dali é usado.
- **Simulador** (só com `fake`, nunca em produção): no `/super`, "Simulador de pagamentos" para pagar um Pix pendente, vencer cobrança, gerar chargeback, aprovar/recusar cadastro (com uma troca de conta em análise, aprova ou recusa a troca; recusar um espaço aprovado sem troca em análise não tem efeito, decisão 98) e liquidar saldos. No app, um selo "Ambiente de teste" na tela de pagamento.

## 11. Fora desta etapa

Gateway real, cartão salvo, parcelamento, cartão recorrente e Pix Automático, pagamento por parte da conta dividida, inscrições de torneio (Fase 3: reaproveitam o mesmo motor), saque manual, taxa paga pelo jogador, emissão de NFS-e e cobrança do SaaS pela plataforma.

## 12. Interface (PG.1)

Visual, fluxos, rótulos e textos em `05-design-system.md`, seção "Pagamento online", com mockups em `pagamentos/`. O que a interface espera da API (PG.2), já com as decisões 93 a 96:
- **Ambiente de pagamento** nas respostas que o app e o painel usam (meios do espaço, cobrança, carteira, Super): o provedor (`fake`, `none` ou real) e, só com o fake, os **cartões de teste** (rótulo, número, resultado esperado, nome, validade e código) e a **dica do documento que força a recusa** do cadastro. As telas não têm nada disso fixo e não deduzem pelo ambiente. Com `none`, o painel e o Super mostram o estado de pagamento online desligado.
- O **QR do Pix em SVG com os módulos em `currentColor`** (ou sem `fill`), para o app pintar com o token `qr-module` sobre a placa branca.
- Na cobrança: `expiresAt` e **`serverTime`** (a contagem usa a diferença entre o relógio do servidor e o do aparelho), o final do cartão, o motivo da recusa e, na taxa, o **`fee_bps` gravado** e se valeu o mínimo (o painel mostra "Taxa de serviço (4%)" ou "(mínimo)").
- **Cobrança aberta** no detalhe da reserva e da mensalidade para a gestão (meio e validade), para o painel mostrar "Pix aberto até 18:47"; o registro manual cancela essa cobrança e é recusado se ela já foi paga, com um código de erro próprio (decisão 96).
- **`Idempotency-Key`** aceita na criação da reserva e na criação da cobrança; criar ou consultar a cobrança **da reserva já criada** para as novas tentativas; desistência da reserva `PENDING_PAYMENT` pelo organizador (decisão 96).
- Estornos automáticos de pagamento atrasado ou em cobrança trocada com um motivo que o app consiga distinguir ("depois do prazo", "depois da troca da forma de pagamento").
- No estorno manual: o campo **volta a ser cobrado** (padrão não = abatimento, decisão 93), devolvido também no histórico do estorno, e o abatimento por estorno no detalhe da reserva e da mensalidade; taxa devolvida pela regra acumulada (decisão 94).
- Conta de recebimento: cadastro, reenvio e **troca de conta** só do Dono e recusados no modo suporte; status de repasses pausados depois da troca (decisão 95).
- Na contestação: prazo para responder, resposta enviada (texto e anexos) e resultado, para os estados "Aguardando resposta", "Resposta enviada", "Ganha" e "Perdida".
- Nos meios do espaço público, os meios online disponíveis **por serviço** e o modo (opcional ou obrigatório).
- Notificações da gestão (cadastro aprovado ou recusado, conta trocada, contestação com prazo, repasse que falhou) e do jogador, com os textos sugeridos no `05` (nome do espaço sem artigo).
- No Super, um documento utilizável na NFS-e (a API guarda o do cadastro só mascarado) ou a confirmação de que o relatório sai com o documento mascarado.

## 13. API (PG.2)

Contrato no OpenAPI (`packages/api-client/openapi.json`); tipos e schemas em `packages/shared` (`online-payments.ts`, `payments.ts`, `fake-card.ts`). Código em `apps/api/src/payments/` (o domínio só conhece a interface `PaymentGateway`; o fake fica em `gateways/fake/`).

**Ambiente de pagamento** (`paymentEnvironment`: provedor, ligado e, só com o fake, `sandbox` com os cartões de teste completos e a dica do documento de recusa) vem no espaço público, nas cobranças, nas configurações, no cadastro, na carteira e nas taxas do Super. As cobranças e as reservas do jogador (criação, lista e detalhe) trazem `serverTime`.

| Quem | Rota | O quê |
|---|---|---|
| Jogador | `POST /v1/bookings` | `paymentOption` (`ON_SITE`, `ONLINE_PIX`, `ONLINE_CARD` + `cardToken`) e `Idempotency-Key`; a cobrança volta em `onlinePayment` |
| Jogador | `POST`/`GET /v1/bookings/:id/payment` | Pagar (Pix ou cartão) e consultar a cobrança da reserva (só o organizador) |
| Jogador | `POST /v1/bookings/:id/cancel` | Também desiste da reserva `PENDING_PAYMENT` |
| Jogador | `POST`/`GET /v1/me/subscriptions/:sid/charges/:cid/payment` | Pagar e consultar a mensalidade (só o aluno; Pix de 24 h) |
| Jogador | `GET /v1/me/payments`, `GET /v1/me/payments/:id` | Meus pagamentos (filtro por status), com os estornos e o motivo (`reasonCode`) em cada cobrança, e o comprovante, com o nome do pagador |
| Público | `GET /v1/spaces/:slug` | `onlinePayments` (modo e formas por serviço) e `paymentEnvironment` |
| Dono | `PUT …/online-payments/merchant-account`, `PUT …/merchant-account/payout` | Cadastro e troca da conta (fora do modo suporte) |
| Dono/Admin | `GET …/merchant-account`, `GET`/`PUT …/settings` | Status do cadastro; modos e taxa vigente |
| Dono/Admin | `GET …/wallet`, `…/wallet/entries` (+ `.csv`), `…/wallet/payouts` | Carteira, lançamentos e repasses |
| Dono/Admin | `GET …/charges` (por item com `payableType`/`payableId`), `GET …/charges/:id`, `POST …/charges/:id/refunds` | Cobranças e estorno (`chargeAgain`) |
| Dono/Admin | `GET …/chargebacks`, `POST …/chargebacks/:id/dispute` | Contestações |
| Super | `/v1/super/online-payments/fees` (+ `/spaces/:id`), `/merchant-accounts`, `/revenue` (+ `.csv`), `/reports/monthly` (+ `.csv`) | Taxas, cadastros, receita e o relatório da NFS-e |
| Super (só fake) | `/v1/super/online-payments/simulator/…` | Cobranças, pagar, vencer, chargeback, resultado da contestação, aprovar/recusar cadastro, liquidar |
| Gateway | `POST /v1/webhooks/payments/:provider` | Webhooks |

(`…` = `/v1/manage/spaces/:spaceId/online-payments`.) A reserva ganha `paymentDueAt`, `discountCents` e `openOnlineCharge` (cobrança aberta); o detalhe da gestão, `onlineCharges`; a mensalidade, `discountCents` e `openOnlineCharge`; o registro de pagamento, `channel` e `onlineChargeId` (`recordedBy` nulo no online), também nos pagamentos da mensalidade em todas as respostas do aluno e da gestão; o extrato e o financeiro do Super, o canal (`byChannel`, filtro `channel` e a coluna `canal` no CSV).

**Ajustes da PG.2b** (pedidos pelo web e pelo app): o cadastro aceita `responsibleCpf` (obrigatório com CNPJ, recusado com CPF) e devolve `responsibleCpfMasked`; o cadastro traz `lastRejectedPayoutChange` (`payoutMasked`, `reason`, `rejectedAt`; decisão 98) e o reenvio depois da aprovação responde 409 `MERCHANT_ACCOUNT_APPROVED`; as configurações trazem `onlineReady` (gateway ligado, espaço ativo, cadastro já aprovado e que não esteja `REJECTED`); os lançamentos da carteira (e o CSV) aceitam `method` (`PIX`/`CARD`) e a página traz `total`; o estorno manual exige `amountCents`.

**Ajustes pedidos pelo app (PG.4):** cada cobrança de Meus pagamentos, na lista e no detalhe, traz os estornos (`refunds`: tipo, status, valor, texto e `reasonCode`, inclusive os automáticos `PAID_AFTER_DEADLINE`, `PAID_AFTER_METHOD_CHANGE`, `ACCOUNT_DELETED` e os de cancelamento); o comprovante (`GET /v1/me/payments/:id`) traz `payerName`; a reserva do jogador (`POST /v1/bookings`, `GET /v1/bookings` e `GET /v1/bookings/:id`) traz `serverTime`, para a contagem do `paymentDueAt` não depender do relógio do aparelho. A cobrança da reserva e da mensalidade (`PlayerOnlineCharge`) continua sem os estornos: o app os lê em Meus pagamentos pelo id da cobrança.

**Erros próprios:** 422 `BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT` (modo obrigatório e início em menos de 5 min; `details.minLeadMin`), 409 `PAYMENT_HOLD_EXPIRED`, 409 `ALREADY_PAID` (o outro toque já pagou), 409 `PAYMENT_IN_PROGRESS` (outra operação no mesmo item passou de 30 s), 409 `ONLINE_CHARGE_ALREADY_PAID`, 409 `MERCHANT_ACCOUNT_APPROVED` (reenvio do cadastro depois da aprovação, decisão 98), 422 `REFUND_EXCEEDS_BALANCE` (`details.refundableCents`, já sem os estornos pendentes) e 422 `IDEMPOTENCY_KEY_REUSED` (a mesma `Idempotency-Key` com outro pedido de reserva ou de cobrança) e 502 `PAYMENT_GATEWAY_UNAVAILABLE` (com `details = { chargeId, verification: 'PENDING' }` quando a criação ficou pendente de verificação: o app consulta a cobrança em vez de criar outra).

**Notificações:** jogador — `PAYMENT_CONFIRMED`, `PAYMENT_EXPIRED` (Pix vencido, "O Pix venceu", só na reserva opcional e na mensalidade; reserva cancelada pelo prazo, "Reserva cancelada", sem o aviso do Pix), `PAYMENT_REFUNDED`; gestão (Dono e Admin) — `MERCHANT_ACCOUNT_APPROVED`, `MERCHANT_ACCOUNT_REJECTED`, `PAYMENT_CHARGEBACK` (com o prazo), `PAYOUT_FAILED`; todos os Donos (com e-mail) — `MERCHANT_PAYOUT_ACCOUNT_CHANGED` e `MERCHANT_PAYOUT_CHANGE_REJECTED` (troca recusada, com o motivo; decisão 98). Os dados levam `onlineChargeId`, `bookingId` ou `subscriptionId`/`chargeId`, e na gestão `spaceId` e `section` (`SETTINGS`, `WALLET`, `CHARGEBACKS`).

**Auditoria:** `payment.online.*` (criação, pago, pagamento tardio, vencida, estorno manual e automático — com `deferred` quando ficou pendente para a reconciliação —, chargeback, resposta e resultado da contestação, ajuste do registro, `payment.online.orphan` para a cobrança do gateway sem dono), `booking.payment_confirmed`, `booking.payment_expired`, `merchant_account.*` (inclusive `merchant_account.payout_change_rejected`), `payment_settings.update`, `payout.*`, `super.payment_fee.*`, `super.payment_report.*`, `super.payment_revenue.export_csv` e `super.payment_simulator.*`.

**Jobs** (fila `payments`, com `JOBS_ENABLED`): processar webhook, vencer holds e Pix (a cada minuto), reconciliar (10 min: cobranças pendentes e pendentes de verificação, estornos pendentes, pagamentos sem item e os cadastros `PENDING` há mais de 15 min) e, no fake, entregar webhooks, aprovar cadastros, gerar o chargeback do cartão de teste e repassar (06:00).

## 14. Web (PG.3)

Painel: `/painel/recebimentos-online` (cadastro em etapas só do Dono e fora do modo suporte, modos, taxa vigente, carteira, contestações), bloco "Pagamento online" e estorno no detalhe da reserva e no diálogo de pagamentos da mensalidade, `PENDING_PAYMENT` na lista, na agenda e no "Hoje", canal no extrato e "Pix aberto" no "a receber". Super: `/super/pagamentos` (receita com a taxa recobrada, relatório da NFS-e com o documento completo, taxas, cadastros e simulador) e "No local × online" no Financeiro. Detalhes e diferenças em `05-design-system.md`, "Implementação no web (PG.3)".

**Ajustes da PG.3c** (contrato da PG.2b no web): o diálogo de pagamentos da mensalidade usa o `channel` (registro `ONLINE` com a etiqueta "Online" e sem o "Estornar" manual); a carteira ganhou o filtro "Meio" (Pix/Cartão), "Página X de N" pelo `total` e o CSV com os mesmos filtros; o cadastro com CNPJ pede o CPF do responsável (obrigatório, com máscara e validação; exibido só mascarado, `responsibleCpfMasked`); os modos de pagamento liberam pelo `onlineReady`; e a troca de conta recusada aparece como aviso no card aprovado, com a conta e o motivo de `lastRejectedPayoutChange`, sem refazer o cadastro (decisão 98). O web não tem central de notificações, então `MERCHANT_PAYOUT_CHANGE_REJECTED` só aparece no app (o texto sugerido está em `05-design-system.md`).

**Lacunas do contrato para o web:** a contestação aceita só links de anexos (sem upload).


## 15. App (PG.4)

Rotas `reserva/pagar/[id]` e `planos/pagar/[id]?plano=<assinatura>` (`?forma=pix|cartao`), Meus pagamentos em `(conta)/meus-pagamentos` e o comprovante em `(conta)/meus-pagamentos/[id]`; código em `apps/mobile/src/features/payments/`. As diferenças da especificação ficam em `05-design-system.md`, "Implementação no app (PG.4)". Em resumo: o cartão só aparece com o tokenizador do ambiente (`paymentEnvironment.sandbox`; com um gateway real, quando o SDK do provedor entrar no app) e some das opções sem ele; a `Idempotency-Key` da criação da reserva é ligada ao pedido, com "Tentar de novo" depois de um resultado desconhecido e o tratamento de 422 `IDEMPOTENCY_KEY_REUSED`; a tela de pagamento sempre termina num estado final ("Nada a pagar", confirmado, Pix cancelado, cartão não concluído).

**Relógio:** a contagem do prazo da reserva (detalhe, lista e tela do Pix na reserva obrigatória) usa o `serverTime` da própria reserva e a hora em que a resposta chegou; a do Pix opcional e da mensalidade, o `serverTime` da cobrança.

**Comprovante:** "Pago por" vem do `payerName` da API; os estornos, com o `reasonCode`, vêm em Meus pagamentos (lista e comprovante). O estado "pago e estornado sozinho" da tela de pagamento sai do motivo do estorno (`PAID_AFTER_DEADLINE`, `PAID_AFTER_METHOD_CHANGE`, `ITEM_ALREADY_PAID`), lido do comprovante da cobrança.

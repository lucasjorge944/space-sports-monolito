# E2E mobile (Maestro)

Fluxos do app do jogador contra a **API real** com o seed de teste (espaço fictício "Arena E2E";
não usa dados de espaços parceiros).

| Fluxo | Cobre |
|---|---|
| `flows/reserva-no-local.yaml` | login (RF-AUTH), busca de espaço, reserva com pagamento no local (RF-BOOK-01, RN-BOOK-01, RN-BOOK-07), Minhas reservas, edição de pessoas e duração (RF-BOOK-03, RN-BOOK-11, RN-BOOK-12) e cancelamento dentro do prazo (RF-BOOK-03, RN-BOOK-05) |
| `flows/cadastro.yaml` | cadastro em duas etapas (RF-AUTH-01, decisões 64 e 70): telefone incompleto recusado no campo, máscara `(31) 99999-8888`, "Sobre você" com data futura recusada, gênero e esporte com nível; Perfil e Editar perfil com os dados salvos, e-mail não verificado, troca do nome e Alterar senha (RF-AUTH-02, decisão 67) |
| `flows/cadastro-pular.yaml` | cadastro com "Pular" na etapa "Sobre você" (decisão 70): segue para o app |
| `flows/completar-perfil.yaml` | conta sem telefone (jogador `jogador.semfone.e2e@exemplo.com` do seed) é levada ao completar perfil: pede só o telefone, recusa incompleto, aplica a máscara e segue para "Sobre você" com "Pular" (RF-AUTH-02, decisões 64, 66 e 70) |
| `flows/explorar.yaml` | novo Explorar (AD.4): atalhos por esporte com filtro aplicado e desfeito (RF-SPACE-13), carrossel e card patrocinado, que o seed de teste deixa no ar nas duas vagas (2 peças por vaga, uma delas de anunciante `SPACE` sem imagem; RF-ADS-04 a 06), Espaços recentes depois de abrir a página do espaço (RF-SPACE-12) e as seções que somem com filtro e com busca por nome |
| `flows/pagamento-pix.yaml` | reserva na Arena E2E Norte (modo "No local ou online") com Pix: etapa "Como você quer pagar?" com Pix marcado e o selo de teste, tela do Pix (código, "Copiado!", validade), o Super paga pelo simulador (`scripts/simulator-pay-pix.js`) e a tela confirma sozinha, comprovante e cancelamento no prazo com o aviso do estorno (RF-ONPAY-03, RF-ONPAY-06, RN-ONPAY-02/05) |
| `flows/pagamento-obrigatorio-expira.yaml` | modo "Online obrigatório" ligado pelo Dono (`scripts/set-booking-mode.js`), reserva com Pix aguardando pagamento: contagem, seção "Aguardando pagamento" da Agenda, "Pagar" voltando ao mesmo Pix e o prazo que vence de verdade (até 15 min) com "O prazo para pagar acabou" e "Pagamento não feito no prazo"; volta o modo no fim (RF-ONPAY-03/04, RN-ONPAY-02). Fluxo longo (~16 min) |
| `flows/pagamento-mensalidade-cartao.yaml` | aluno sem o mês pago da Arena E2E Norte paga a mensalidade com o cartão de teste "Aprova" (dados vindos da API), validação antes de enviar, "Pagamento aprovado", comprovante e Meus pagamentos sem saldo (RF-ONPAY-05/06, RN-ONPAY-10). Paga a mensalidade do seed: para repetir, rode o seed de novo |
| `flows/pagamento-cartao-validacao.yaml` | formulário do cartão na etapa de reservar (nada é criado): os quatro erros ao enviar vazio, Luhn, cartão vencido e código curto, máscaras do número, validade e nome, cartões de teste vindos de `paymentEnvironment.sandbox` preenchendo tudo e "Pagar com Pix" voltando à etapa (RN-ONPAY-10) |
| `flows/pagamento-cartao-recusado.yaml` | reserva com o cartão de teste "Recusa" (da API): "Cartão recusado" com o motivo da API, já na tela de pagamento da reserva criada, e a nova tentativa com "Aprova" na mesma reserva, até "Pagamento aprovado" e o pago online no detalhe (RF-ONPAY-03, RN-ONPAY-02; decisão 96) |
| `flows/pagamento-desistir.yaml` | modo "Online obrigatório" (Dono, por script), reserva com Pix aguardando pagamento, "Falta pagar para confirmar" sem edição, e "Desistir da reserva" pelo alerta nativo até "Você desistiu antes de pagar."; volta o modo no fim (RF-ONPAY-04, RN-ONPAY-02; decisão 96) |
| `flows/pagamento-pix-vencido.yaml` | Pix no modo opcional vencido pelo simulador (`scripts/simulator-charge.js`, `ACTION=expire`): "Este Pix venceu" com a reserva ainda confirmada, "Gerar novo Pix" com outro código e "Continuar pagamento" / "Pix gerado · vale até" no detalhe (RF-ONPAY-03, RN-ONPAY-02) |
| `flows/pagamento-estorno.yaml` | Pix pago pelo simulador e estornado inteiro pelo Dono na API da gestão (`scripts/manage-refund.js`): Meus pagamentos com o filtro "Estornos", comprovante "Estornado" com o motivo entre aspas e "Volta para o mesmo Pix.", e o detalhe com "devolvidos … para o seu Pix" (RF-ONPAY-06, RN-ONPAY-05) |
| `flows/pagamento-estorno-parcial.yaml` | estorno parcial de R$ 40,00 que volta a ser cobrado (`chargeAgain`, decisão 93): comprovante "Estorno parcial" e, no detalhe, o devolvido com o motivo e "Falta pagar R$ 40,00 no espaço" (RN-ONPAY-05) |
| `flows/pagamento-contestacao.yaml` | reserva paga com o cartão "Aprova" e contestada pelo simulador (`ACTION=chargeback`): comprovante "Contestado no cartão" e o aviso `reserva-contestado` no detalhe (RN-ONPAY-06) |
| `flows/avaliacao-reserva-passada.yaml` | avaliar a partir da reserva passada (RF-REVIEW-01/02): card "Avalie sua experiência" no detalhe, nota gravada com um toque (`createOnly`), tela de avaliar em edição com "Nota salva", chip positivo (o negativo some), comentário com contador, sucesso, "Ver no espaço" com "Editar minha avaliação", o card como "Sua avaliação" e a exclusão pelo alerta nativo. Usa a reserva passada que o seed de teste cria para o `jogador.e2e` na Arena E2E (confirmada, na Quadra B, terminou há 2 dias; `scripts/past-booking.js` a acha, e vale por 6 meses); apaga a avaliação no começo e no fim (`scripts/delete-my-review.js`) |
| `flows/avaliacoes-lista.yaml` | selo "★ média (n)" na Arena E2E e "Novo" na Arena E2E Norte (RF-REVIEW-03), bloco "Avaliações" da página com o resumo, "Ver todas", filtro por nota e o diálogo de denúncia com motivo obrigatório, sem enviar (RF-REVIEW-04, RN-REVIEW-04). Só lê |
| `flows/explorar-filtro-nota.yaml` | filtro "4+ estrelas" e ordem "Melhor avaliados" do Explorar (decisão 109; só lê): sem filtro os 4 espaços do seed (Arena E2E 4,2, Norte "Novo", Oeste 3,4 e Sul 4,8); "4+ estrelas" deixa só Arena E2E e Sul (Oeste e o "Novo" saem), com "Filtros, 1 ativo" e a lista "Resultados"; "Melhor avaliados" põe o Sul antes da Arena E2E ("Filtros, 2 ativos"); sem o 4+, o "Novo" Norte vai depois do Oeste; "Limpar" volta aos 4 espaços por nome e ao Explorar completo. Ordem conferida por posição relativa entre cards vizinhos (RF-REVIEW-03, RF-SPACE-05) |
| `flows/convite.yaml` | convite com contato (RF-BOOK-04, RF-CONTACT-01): WhatsApp inválido recusado, convite por nome pelo compartilhamento do sistema, vaga aberta por link, status na lista, e deep link com token inválido |

## Como rodar

1. Suba a infra e prepare o banco de e2e (mesmos passos do web em `apps/web/playwright.real.config.ts`):
   ```bash
   docker compose up -d postgres redis
   export DATABASE_URL=postgres://space_sports:space_sports@localhost:5432/space_sports_e2e
   pnpm --filter @space-sports/api db:migrate
   pnpm --filter @space-sports/api exec tsx test/e2e-seed/seed.ts   # apaga e recria os dados de teste
   ```
2. Suba a API (`pnpm --filter @space-sports/api build && node apps/api/dist/main.js`, com `PORT`,
   `BETTER_AUTH_SECRET`, `TRUSTED_ORIGINS` e `SMTP_*` como em `playwright.real.config.ts`).
3. Gere o app apontando para a API (no emulador Android, `http://10.0.2.2:<porta>`), por exemplo
   `EXPO_PUBLIC_API_URL=http://10.0.2.2:3335 npx expo run:android`. O id do app é
   `br.com.spacesports.app` (`android.package`/`ios.bundleIdentifier` em `app.config.ts`); use-o
   como `APP_ID` (no Expo Go, `host.exp.exponent`, abrindo antes o projeto).
4. Rode: `maestro test -e APP_ID=<id> .maestro/flows`.

Os fluxos de pagamento precisam da API com `PAYMENTS_PROVIDER=fake` e `JOBS_ENABLED=true` (a fila entrega os webhooks do fake e vence os holds). Atenção: o `playwright.real.config.ts` sobe a API com `JOBS_ENABLED=false`, e o fake entrega os webhooks em `PAYMENTS_FAKE_WEBHOOK_URL`, que por padrão aponta para a porta 3333. Numa API em outra porta (a 3335 dos exemplos), sem os jobs ligados e sem `PAYMENTS_FAKE_WEBHOOK_URL=http://127.0.0.1:<porta da API>/v1/webhooks/payments/fake`, o Pix pago pelo simulador nunca confirma e os fluxos esperam até estourar o prazo. O ambiente certo está em `apps/web/playwright.real-payments.config.ts` (também `PAYMENTS_FAKE_APPROVAL_DELAY_MS`, que encurta a aprovação do cadastro). Eles chamam a API por scripts no endereço `API_URL` do `env` do fluxo (padrão `http://10.0.2.2:3335`, o da API vista do emulador): passe outro com `-e API_URL=...`.

Scripts e subfluxos do pagamento online (reaproveite nos fluxos novos):

| Arquivo | O que faz | Env |
|---|---|---|
| `scripts/payments-login.js` | login na API; o token sai em `output.API_TOKEN` | `LOGIN_EMAIL`, `LOGIN_PASSWORD` |
| `scripts/simulator-pay-pix.js` | o Super paga o Pix pendente mais recente do jogador | `API_TOKEN` (Super), `PAYER_NAME` |
| `scripts/simulator-charge.js` | ação do simulador (`pay`, `expire` ou `chargeback`) na cobrança mais recente do jogador com o status e o meio pedidos; com `WAIT_STATUS`, espera a fila aplicar o resultado (até ~30 s); id em `output.SIMULATED_CHARGE_ID` | `API_TOKEN` (Super), `PAYER_NAME`, `STATUS`, `METHOD`, `ACTION`, `WAIT_STATUS` |
| `scripts/manage-refund.js` | estorno manual pelo Dono da cobrança paga mais recente do jogador (`AMOUNT_CENTS` ou `ALL`, com motivo e `CHARGE_AGAIN`); espera o estorno concluir; id em `output.REFUNDED_CHARGE_ID` | `API_TOKEN` (Dono), `SPACE_SLUG`, `PAYER_NAME`, `AMOUNT_CENTS`, `REASON`, `CHARGE_AGAIN` |
| `scripts/set-booking-mode.js` | troca o modo das reservas do espaço, mantendo o das aulas | `API_TOKEN` (Dono), `SPACE_SLUG`, `BOOKING_MODE` |
| `scripts/cancel-player-bookings.js` | cancela as reservas futuras ativas do jogador no espaço | `API_TOKEN` (jogador), `SPACE_SLUG` |
| `subflows/reservar-norte.yaml` | reserva amanhã na Quadra Norte até tocar no botão da etapa de pagamento com a forma escolhida | `HOUR`, `FORMA` (`pix`, `cartao`, `local`) |
| `scripts/past-booking.js` | acha a reserva passada do jogador no espaço (card de avaliar); id em `output.PAST_BOOKING_ID` | `API_TOKEN` (jogador), `SPACE_SLUG` |
| `scripts/delete-my-review.js` | apaga a avaliação do jogador no espaço (404 sem avaliação conta como feito) | `API_TOKEN` (jogador), `SPACE_SLUG` |
| `subflows/limpar-avaliacao.yaml` | login do jogador + `delete-my-review.js` (usado em `onFlowStart`/`onFlowComplete`) | `PLAYER_EMAIL`, `PLAYER_PASSWORD`, `SPACE_SLUG` |
| `subflows/limpar-reservas-norte.yaml` | login do jogador + `cancel-player-bookings.js` (usado em `onFlowStart`/`onFlowComplete`) | `PLAYER_EMAIL`, `PLAYER_PASSWORD`, `SPACE_SLUG` |

Cada fluxo de pagamento reserva amanhã num horário próprio da Quadra Norte, para não disputar a
grade: validação 06:00 (não cria reserva), cartão recusado 07:00, desistir 08:00, Pix vencido 09:00,
estorno 11:00, estorno parcial 12:00, contestação 13:00, Pix 14:00 e obrigatório 16:00. Os fluxos que
deixam a reserva ativa a cancelam em `onFlowStart` e `onFlowComplete`, então podem ser repetidos sem
re-semear (só a mensalidade paga pede o seed de novo).

Os fluxos de cadastro criam uma conta nova a cada execução (e-mail `cadastro.<timestamp>@exemplo.com`,
de `scripts/signup-email.js`) e usam o esporte `futevolei` do seed. O telefone se repete entre as contas
de propósito: o do cadastro não é verificado e pode repetir (decisão 64).

Os fluxos reservam **amanhã na Quadra A** (`reserva-no-local` às 10:00, `convite` às 12:00) e cancelam
no fim, então podem ser repetidos sem re-semear. Para começar do zero, rode o seed de novo.

## Como o fluxo localiza os elementos

O fluxo usa `id:` (o `testID` do app; vira `resource-id` no Android e `accessibilityIdentifier` no iOS)
em vez de texto ou `accessibilityLabel`, para não quebrar quando um texto mudar. Convenções dos ids:

- Prefixo da tela, em português, kebab-case: `cadastro-`, `alterar-senha-`, `sobre-voce-`, `completar-perfil-`, `editar-perfil-`, `perfil-`, `login-`, `localizacao-`, `explorar-`, `busca-`, `filtros-` (folha de filtros),
  `espaco-`, `reservar-`, `agenda-`, `reserva-` (detalhe) e `tab-` (abas). Avaliações:
  `avaliar-` (tela de avaliar), `avaliacoes-` e `avaliacao-item-<id>`/`avaliacao-menu-<id>` (lista),
  `denuncia-`, `minhas-avaliacoes`, `selo-avaliacao`/`selo-novo` (card e callout) — a lista completa
  está em `docs/05-design-system.md`, "Avaliações", "Resumo de testIDs".
- Ids com sufixo dinâmico seguem o dado, não a posição:

  Ressalvas: `reserva-card-<slug>` não é único (repete para toda reserva do mesmo espaço, inclusive as antigas em "Passadas"); `scripts/tomorrow-date.js` fixa UTC-3, então um espaço de teste em outro fuso quebraria `reservar-data-*`.

  | Id | Sufixo |
  |---|---|
  | `espaco-card-<slug>` | slug do espaço (`arena-e2e`) |
  | `explorar-atalhos` · `explorar-atalho-<slug>` | faixa de atalhos por esporte e cada chip (slug do catálogo; o selecionado tem `selected`) |
  | `explorar-carrossel` · `explorar-carrossel-indicador` · `explorar-anuncio-banner-<creativeId>` | carrossel patrocinado, indicador em segmentos (2+ peças) e cada banner; o selo é `explorar-anuncio-banner-<creativeId>-selo` (fora da árvore de acessibilidade) |
  | `explorar-anuncio-card-<creativeId>` | card patrocinado da lista (também o do espaço sem imagem); selo em `explorar-anuncio-card-<creativeId>-selo`. Use regex (`explorar-anuncio-card-.*`): o id da peça vem do sorteio |
  | `explorar-recentes` · `explorar-recente-<slug>` · `explorar-recentes-carregando` | faixa de Espaços recentes, cada card compacto e o esqueleto (só logado, sem histórico local) |
  | `explorar-titulo-lista` · `explorar-lista` | título da lista ("Espaços perto de você", "Espaços" ou "Resultados") e a lista |
  | `filtros-ordem-distancia` · `filtros-ordem-nota` · `filtros-nota-4` · `filtros-limpar` · `filtros-ver-espacos` | folha de filtros (botão `busca-filtros`): "Mais perto" ("Por nome" sem localização) e "Melhor avaliados" (rádio, o marcado tem `checked`; não aparecem no mapa), "4+ estrelas" (caixa de seleção) e os botões do rodapé |
  | `explorar-vazio-nota` · `explorar-vazio` · `explorar-vazio-tirar-nota` · `explorar-vazio-limpar` · `mapa-vazio` | lista vazia só com o "4+ estrelas"; lista vazia genérica (com o "4+ estrelas" e mais busca ou filtro, ou sem ele); o botão que tira só o "4+ estrelas"; "Limpar filtros" ("Limpar busca e filtros" com busca), que limpa também a busca; aviso do mapa sem pins |
  | `auth-logo` · `explorar-logo` | logo da marca (vertical nas telas de entrada, cadastro e recuperação de senha; horizontal no cabeçalho da Vitrine) |
  | `reservar-data-<YYYY-MM-DD>` | dia no fuso America/Sao_Paulo (o script `scripts/tomorrow-date.js` calcula o de amanhã) |
  | `reservar-duracao-<min>` | duração em minutos |
  | `reservar-horario-<HH:MM>` | horário de início (ex.: `reservar-horario-10:00`) |
  | `reservar-quadra-<nome>` | nome da quadra sem acento, em minúsculas (`quadra-a`) |
  | `reservar-pagamento-<método>` | `PIX`, `CARD`, `CASH` ou `OTHER` |
  | `reserva-card-<slug>` | slug do espaço da reserva (na lista "Minhas reservas") |
  | `agenda-aba-<quando>` | `upcoming` ou `past` (seção Reservas da Agenda, a padrão) |
  | `agenda-secao-<seção>` | `bookings` ou `classes` (Reservas | Aulas na Agenda) |
  | `aulas-contratar-<planId>` | botão Contratar de um plano na aba Aulas do espaço |
  | `contratar-turma-<classGroupId>` · `contratar-pagamento-<método>` · `contratar-enviar` | escolha de turmas, forma de pagamento e envio do pedido |
  | `planos-item-<subscriptionId>` | linha da lista Meus planos |
  | `plano-cancelar` · `plano-desistir-cancelamento` · `plano-trocar-<classGroupId>` | ações do Meu plano (`plano-desistir-cancelamento` fica no aviso `plano-cancelamento-agendado` e abre um `Alert` nativo) |
  | `reservar-forma-<pix\|cartao\|local>` · `reservar-pagamento-obrigatorio` · `pagamento-selo-teste` | etapa "Como você quer pagar?" (cartões de opção, aviso do modo obrigatório e selo "Ambiente de teste") |
  | `pagamento-titulo` · `pagamento-valor` · `pix-copia-e-cola` · `pix-copiar` · `pix-qr` · `pix-contagem` · `pix-validade` · `pix-conferindo` · `pix-aguardando` · `pix-pagar-cartao` | tela do Pix (`/reserva/pagar/<id>` e `/planos/pagar/<mensalidade>`) |
  | `pagamento-confirmado` · `pagamento-ver-item` · `pagamento-ver-comprovante` · `pagamento-prazo-acabou` · `pagamento-reservar-de-novo` · `pagamento-pix-vencido` · `pagamento-gerar-pix` · `pagamento-estornado-sozinho` · `pagamento-erro` · `pagamento-tentar-de-novo` | estados finais da tela de pagamento |
  | `cartao-testes` · `cartao-teste-<rótulo>` · `cartao-numero` · `cartao-nome` · `cartao-validade` · `cartao-cvv` · `cartao-pagar` · `cartao-pagar-pix` · `cartao-recusado` · `cartao-prazo` · `cartao-processando` | formulário do cartão; `<rótulo>` é o rótulo do cartão de teste da API sem acento, em minúsculas (`aprova`, `recusa`, `aprova-e-contesta`) |
  | `reservar-cartao-valor` · `reservar-tentar-de-novo` · `cartao-indisponivel` · `pagamento-nada-a-pagar` · `pagamento-pix-cancelado` · `pagamento-estornado` · `reserva-pagar-online-botao` · `comprovante-estornos` · `meus-pagamentos-item-<chargeId>-motivo` · `tab-perfil` | etapa do cartão no formulário de reservar (valor e "Tentar de novo" depois de ficar sem resposta), cartão indisponível sem o tokenizador, estados finais "Nada a pagar", "Este Pix não vale mais" e "Pagamento estornado", botão de pagar online do detalhe, estornos do comprovante, motivo do estorno automático na lista e a aba Perfil |
  | `pagar-opcao-<pix\|cartao>` · `pagar-continuar` | folha "Como você quer pagar?" do "Pagar" (detalhe, lista e mensalidade) |
  | `reserva-aguardando-pagamento` · `reserva-prazo-contagem` · `reserva-pagar` · `reserva-desistir` · `reserva-pagar-online` · `reserva-pago-online` · `reserva-estorno-parcial` · `reserva-estornado` · `reserva-contestado` · `reserva-ver-comprovante` · `reserva-motivo-cancelamento` · `reserva-reservar-de-novo` | detalhe da reserva com o pagamento online |
  | `agenda-aguardando-pagamento` · `reserva-card-<bookingId>-pagar` · `reserva-card-<bookingId>-sem-pagamento` | seção "Aguardando pagamento" da Agenda, "Pagar agora" e a cancelada pelo prazo |
  | `plano-mensalidade-<chargeId>-pagar` · `plano-mensalidade-<chargeId>-comprovante` · `perfil-meus-planos` | "Pagar agora" e o comprovante da mensalidade; atalho do Perfil |
  | `perfil-meus-pagamentos` · `meus-pagamentos-filtro-<all\|paid\|refunds\|pending>` · `meus-pagamentos-item-<chargeId>` · `comprovante-valor` · `comprovante-status` · `comprovante-teste` · `comprovante-transacao` · `comprovante-compartilhar` · `comprovante-ver-item` · `comprovante-continuar` | Meus pagamentos e o comprovante |
  | `reserva-editar` · `reserva-sem-edicao` · `reserva-whatsapp` | detalhe da reserva: abre o sheet, motivo de não poder editar e "fale com o espaço" |
  | `editar-pessoas-menos` · `editar-pessoas-mais` · `editar-data-<YYYY-MM-DD>` · `editar-duracao-<min>` · `editar-horario-<HH:MM>` · `editar-total` · `editar-diferenca` · `editar-parte` · `editar-confirmar` | sheet "Editar reserva": mesmos sufixos do fluxo de reservar |
  | `convite-nome` · `convite-whatsapp` · `convite-email` · `convite-enviar` · `convite-por-link` | formulário "Dividir a conta" no detalhe da reserva |
  | `convite-status-<nome>` · `convite-sugestao-<nome>` · `convite-vincular-<nome>` | linha do convidado: nome sem acento, em minúsculas (`ana-convidada`), ou `vaga-aberta` (repete se houver mais de uma) |
  | `convite-entrar` · `convite-aceitar` · `convite-recusar` · `convite-trazer-para-conta` · `convite-ver-reserva` · `convite-inicio` · `convite-invalido` | tela do deep link `spacesports://convite/<token>` |
  | `explorar-logo` · `agenda-titulo` · `perfil-titulo` · `meu-espaco-titulo` · `mapa-titulo` | esquerda do cabeçalho fixo das abas (logo no Explorar, título nas outras) |
  | `notificacoes-sino` · `notificacoes-contador` | sino do cabeçalho das abas (abre `/notificacoes`) e contador de não lidas (só aparece com não lidas) |
  | `espaco-horarios` · `espaco-horarios-lista` | bloco recolhível de horários da página do espaço e a lista aberta |
  | `espaco-whatsapp` · `espaco-mapa` | contato por WhatsApp e prévia do mapa (só com dado preenchido) |
  | `login-criar-conta` · `cadastro-titulo` · `cadastro-nome` · `cadastro-email` · `cadastro-telefone` · `cadastro-senha` · `cadastro-criar` | etapa "Conta" do cadastro |
  | `sobre-voce-titulo` · `sobre-voce-salvar` · `sobre-voce-pular` | etapa "Sobre você" (depois do cadastro e do completar perfil) |
  | `perfil-nascimento` · `perfil-genero-<gênero>` · `perfil-esporte-<slug>` · `perfil-nivel-<slug>-<nível>` | campos do "Sobre você", também no Editar perfil: gênero `FEMALE`, `MALE`, `OTHER` ou `UNDISCLOSED`; slug do esporte do catálogo; nível `BEGINNER`, `INTERMEDIATE`, `ADVANCED` ou `PRO` |
  | `completar-perfil-titulo` · `completar-perfil-nome` · `completar-perfil-telefone` · `completar-perfil-continuar` · `completar-perfil-sair` | completar cadastro (conta sem telefone ou nova pelo Google, decisão 66); nome e telefone só aparecem se faltarem |
  | `verificar-email-agora-nao` | sair da tela "Confirme seu e-mail" sem confirmar |
  | `perfil-nome` · `perfil-editar` · `perfil-foto-image` · `perfil-foto-initials` | aba Perfil (a foto/iniciais ficam fora da árvore de acessibilidade, decorativas) |
  | `editar-perfil-nome` · `editar-perfil-telefone` · `editar-perfil-email` · `editar-perfil-email-status` · `editar-perfil-reenviar` · `editar-perfil-salvar` | Editar perfil (o reenviar só aparece com e-mail não verificado) |
  | `perfil-alterar-senha` · `editar-perfil-alterar-senha` · `alterar-senha-titulo` · `alterar-senha-atual` · `alterar-senha-nova` · `alterar-senha-confirmar` · `alterar-senha-salvar` · `alterar-senha-sucesso` · `alterar-senha-social` | Alterar senha (pela aba Perfil ou pelo Editar perfil); `alterar-senha-social` é o aviso da conta só Google, sem formulário |
  | `editar-perfil-foto-image` · `editar-perfil-foto-initials` | foto (ou iniciais) no topo do Editar perfil; decorativas, fora da árvore de acessibilidade, como as da aba (`perfil-foto-*`) |
  | `editar-perfil-foto-trocar` · `editar-perfil-foto-remover` · `editar-perfil-foto-camera` · `editar-perfil-foto-galeria` | foto do perfil: o trocar abre o sheet de origem; câmera e galeria abrem telas nativas (fora do Maestro); o remover abre um `Alert` nativo |
  | `excluir-conta-senha` · `excluir-conta-motivo` · `excluir-conta-confirmar` | tela Excluir conta (Perfil → "Excluir minha conta"); o confirmar abre um `Alert` nativo ("Excluir minha conta", destrutivo) |
  | `aula-item-<sessionId>` · `aula-confirmar` · `aula-desistir` | lista de aulas da semana e ações do detalhe da aula |
  | `equipe-aula-<sessionId>` · `equipe-reserva-<bookingId>` | cartões da visão de equipe; o toque abre o sheet de detalhes |
  | `equipe-aula-professores` · `equipe-aula-confirmados` · `equipe-aula-espera` · `equipe-reserva-participantes` · `equipe-reserva-pagamento` | seções dos sheets da equipe (`equipe-reserva-pagamento` só para Dono e Admin) |

- Para conferir o **conteúdo** de um elemento, combine `id:` com `text:` (ex.: `espaco-preco-hora` com
  `R$ 100,00`).
- Ao criar ou mudar uma tela do fluxo, mantenha os ids acima; um id novo entra no componente e aqui.
- Exceção: o alerta de confirmação do cancelamento é nativo (`Alert.alert`) e não aceita `testID`;
  seus botões ("Cancelar reserva", índice 1) e o título continuam por texto.

## Lacunas

- O seed de teste não cria anúncios: no `explorar.yaml`, o carrossel e o card patrocinado só são conferidos quando há peça no ar (rodando o `pnpm db:seed:demo` no mesmo banco, por exemplo). A troca automática a cada 5 s, a pausa ao toque, as impressões e cliques e a abertura do destino (sai do app) ficam nos testes de componente (`features/explore/*.test.ts*`).
- O selo "Patrocinado · <anunciante>" fica fora da árvore de acessibilidade (o rótulo do card e do banner já começa com "Patrocinado, <anunciante>", para o leitor de tela não ler duas vezes), então o Maestro não o enxerga por texto nem por id. O selo é coberto pelo Jest (`features/explore/explore-screen.test.tsx`, com `includeHiddenElements`); no fluxo, o card é conferido pelo id `explorar-anuncio-card-<creativeId>`.

- A foto do perfil não entra nos fluxos: câmera, galeria e recorte são telas do sistema. O envio (URL pré-assinada, PUT e registro) fica nos testes de componente (`features/profile/avatar.test.ts`).
- O login com Google também fica de fora (sai do app para o navegador); o completar cadastro por `profile.missing` está em `features/profile/signup-flow.test.tsx`.

- O envio pelo WhatsApp (`wa.me`) e a sugestão de vínculo ficam nos testes de componente: o primeiro sai do app, e a sugestão precisaria de uma conta com o telefone do convidado no seed, que hoje não cria convites.
- O fluxo não aceita um convite pelo deep link com token válido: o token só existe na resposta da API e não aparece na tela, e o seed não cria um token fixo.
- O compartilhamento do sistema é nativo e não aceita `testID`; o fluxo o fecha com `back`, que funciona no Android. No iOS, a folha precisa de outro gesto.
- Nenhum fluxo cobre ainda o cancelamento do plano de aulas nem a exclusão de conta: o seed de teste não cria assinatura ativa, e a exclusão inativa a conta de teste (precisaria de uma conta descartável por execução).
- O conflito concorrente da edição (`SLOT_UNAVAILABLE`) e a edição bloqueada por pagamento ficam nos testes de componente: no fluxo, precisariam de uma segunda sessão disputando o horário ou de um pagamento registrado pela gestão.
- O fluxo não cobre o cancelamento **fora do prazo** (botão desabilitado + "Fale com o espaço"):
  precisa de uma reserva a menos de 60 min do início, que o seed de teste não cria.

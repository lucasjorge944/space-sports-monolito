# Ajustes pós-piloto 1 — Briefings para o Orca

Cada seção `###` é uma tarefa para uma sessão do Orca (um worktree por tarefa). Formato e planos em `docs/tarefas/README.md`. Checklist dos pedidos em `docs/06-roadmap.md`, seção "Ajustes pós-piloto". Decisões de produto: 45 a 52 de `docs/07-perguntas-em-aberto.md`.

**Plano padrão:** `forte`

**Ordem:** Onda 1 (A.1 e A.2) → Onda 2 (A.3, A.4, A.7, A.8; no máximo 5 sessões por vez) → Onda 3 (A.5 e A.6 em paralelo) → Onda 4 (A.9, A.10) → Onda 5 (A.11, A.12) → Onda 6 (A.13) → revisão e validação manual.

**Regras para todas as tarefas (inclua-as no seu trabalho):**
- Leia o `CLAUDE.md` da raiz e as decisões citadas em `docs/07-perguntas-em-aberto.md` antes de começar. Documentação em português (BR); código em inglês.
- Máquina com pouca RAM. Máximo de 2 workers nos testes, SEMPRE explícito na linha de comando (API e web: `--maxWorkers=2`; mobile: `npx jest --maxWorkers=2`; sem isso o Jest sobe mais de 10 workers de 700 MB e trava a máquina), `NODE_OPTIONS=--max-old-space-size=2048` em processos Node pesados, Playwright com 1 worker e só das specs afetadas. Não rode `next build` sem necessidade. Não suba emulador nem Metro. Nunca derrube nem reutilize processos nas portas 3000, 3333 e 8081; use outras portas. Não deixe servidores nem contêineres rodando ao terminar.
- Contrato OpenAPI muda só em tarefa de API, com o cliente regenerado (`pnpm generate:api-client`, `generate:check`) no mesmo branch. Depois de trazer o `main`, rode `pnpm install`, `pnpm --filter @space-sports/shared build`.
- Migrações: use o número indicado. Ao terminar, traga o `main`; se outra migração entrou antes, regenere a sua com o próximo número livre, para o `_journal` e os snapshots ficarem em cadeia.
- Dinheiro em centavos, datas em UTC e exibição em `America/Sao_Paulo`. Sem cor fixa nas telas: tudo por `packages/ui-tokens`, nos temas claro e escuro.
- Web: sem testes de CSS ou classe (`toHaveClass`, `toHaveCSS`, `toHaveStyle`, `getComputedStyle`, `cn()`); teste só comportamento.
- Atualize `docs/02-requisitos-funcionais.md` (e `docs/04-modelo-de-dados.md`, `docs/05-design-system.md` quando couber) com o que mudou. Não marque o roadmap: a sessão principal faz isso.
- Termine com um commit no branch (Conventional Commits em português) e com typecheck, `pnpm lint` na raiz e os testes da sua área passando. Relate o que ficou de fora.

## Onda 1 — Fundação (A.1 e A.2; A.7 e A.8 entram com a Onda 2, depois do merge delas)

### A.1 · API: Recepção, capacidade, CEP, convite de equipe e recebimento total
- **Agente:** `api-engineer`
- **Branch:** `feat/adjust-api-base`

**Prompt**
```
Em apps/api e packages/shared, faça cinco mudanças. Migração 0019.

(1) Decisão 46, remover o papel RECEPTION: tire o valor do enum space_member_role (recriando o tipo em Postgres), migrando space_members e staff_invites para ADMIN sem duplicar vínculo; remova de todas as listas de papéis, permissões, e-mails, rótulos e testes. Ao terminar, `git grep -i 'reception\|recepção'` em apps e packages (fora de migrações antigas) tem de dar vazio. Atualize a matriz do doc 02 (RN-AUTH-01, RN-PAY-01 e demais).

(2) Decisão 51, capacidade da quadra: o cadastro e a edição de quadra deixam de receber maxPlayers por esporte; recebem só os esportes. A API grava court_sports.max_players com sports.default_max_players. O limite de pessoas da reserva (RN-BOOK-04) continua lendo a coluna. Ajuste DTOs, Zod, seed, onboarding e testes.

(3) Decisão 52, CEP: crie `GET /v1/address/cep/:cep`, autenticado, com limite de taxa, que normaliza o CEP (8 dígitos) e devolve logradouro, bairro, cidade e UF. Consulte ViaCEP com timeout curto e BrasilAPI como reserva, com cache de 30 dias em Redis (inclusive do "não encontrado", por 1 dia). Erros CEP_INVALID (422), CEP_NOT_FOUND (404) e CEP_LOOKUP_UNAVAILABLE (503). Teste com HTTP simulado, sem rede.

(4) Convite de equipe: o preview público do convite (`useGetStaffInvite` no web; tokens em staff_invites) deve devolver o e-mail convidado, além do que já devolve, e o aceite deve recusar qualquer conta ou cadastro com e-mail diferente do convidado (erro claro, testado). Essa exigência vale para cadastro novo e para quem já tem conta; compare sem diferenciar maiúsculas.

(5) Decisão 50, recebimento por participante: POST de pagamento de reserva passa a aceitar só a reserva inteira; payable BOOKING_PARTICIPANT é recusado com erro específico. Remova o que só servia a isso (cálculo de paidByPayable por parte etc.), mantendo os registros antigos válidos no extrato, no estorno e no status de pagamento da reserva. shareCents e a divisão continuam como informação ao jogador; o campo de pagamento por participante sai dos DTOs do jogador e da gestão. Reescreva test/bookings/split-payments.int.test.ts para o novo comportamento.

Testes de integração para todas as regras. Não altere apps/web nem apps/mobile além do cliente gerado; se o typecheck deles quebrar por causa do contrato, liste os pontos no relatório, porque as tarefas seguintes os tratam.
```

### A.2 · Design: chips/badges e estados de campo
- **Agente:** `ui-designer`
- **Branch:** `feat/adjust-design-chips-fields`

**Prompt**
```
Reclamação do usuário: "Melhore a UI dos chips/badges, essa cor do amarelo não ficou boa." e "Inputs com erro e dicas estão com UI/UX ruim".

(1) Chips e badges: veja as telas reais (web e app), em especial os chips de esporte (tokens chip*, Sol 100) e os badges de status (warningSubtle e os outros -subtle), nos dois temas. Redefina a receita para ficar limpa e legível: amarelo menos pálido e sem aparência suja, com hierarquia clara entre chip de filtro/esporte (neutro, com o Sol reservado para o selecionado ou o destaque) e badge de status (semântica por cor e sempre com rótulo). A marca segue o kit (docs/brand/kit/, pranchas 06 e 07); se precisar divergir de um valor do kit, justifique no doc 05. Ajuste packages/ui-tokens, rode `pnpm generate`, mantenha todos os testes de contraste passando (acrescente os pares novos) e registre em docs/05-design-system.md.

(2) Campos: especifique em docs/05-design-system.md, seção própria, a anatomia de campo para web e mobile: rótulo, dica, erro, ícone de estado, espaçamentos, cor da borda em erro, foco, quando a dica some (não some: o erro entra abaixo e a dica continua quando for útil), mensagens curtas e campo inválido com aria-invalid. Crie os tokens que faltarem.

(3) Aplique a receita nos componentes base de chip e badge de apps/web/src/components/ui e apps/mobile/src/components/ui, sem alterar as telas. O componente de campo (Field) será feito pela A.7 e pela A.8, a partir da sua especificação. Termine com capturas antes e depois em docs/brand/auditoria-web/ajustes-1/ (PNG comprimidos), rodando o web em outra porta.
```

### A.7 · Web: máscaras, datas, seletor de data, CEP e campos
- **Agente:** `web-engineer`
- **Branch:** `feat/adjust-web-forms`

**Prompt**
```
Em apps/web, com A.1 e A.2 já no main. Campos seguem a seção de anatomia do doc 05, incluindo a troca em fieldClasses (borda de erro em foco).

(1) Campo: refaça components/painel/field.tsx pela especificação de docs/05-design-system.md (A.2) e use a mesma anatomia em todos os formulários, inclusive páginas públicas e /super. Corrija aria-invalid e aria-describedby.

(2) Máscaras: crie em packages/shared funções puras e testadas para CEP, telefone BR (fixo e celular), CPF, CNPJ, valor em reais e hora, com formatação e normalização; o que vai para a API segue normalizado (telefone em E.164, dinheiro em centavos). Crie um componente de input mascarado e aplique em TODOS os inputs que precisam, varrendo o web inteiro (painel, Super, cadastro, convite, públicas). Use inputMode adequado. Campos de número e dinheiro sem setas e com prefixo R$ onde couber.

(3) Seletor de data: instale o Calendar do shadcn (react-day-picker, date-fns com locale ptBR) e crie DatePicker e DateRangePicker em popover, com semana iniciando no domingo, exibição dd/mm/aaaa e digitação opcional. Substitua TODOS os `type="date"` (cerca de 20 ocorrências, `git grep 'type="date"'`). Mantenha filtros e valores no formato atual (yyyy-MM-dd) para a API. Os `type="time"` podem virar input mascarado ou Select de 30 em 30 minutos, conforme o caso.

(4) Datas: toda data exibida no web fica em dd/mm/aaaa, inclusive tabelas, extratos, CSV, mensagens de erro e e-mails de texto do front. Centralize em lib/format.ts e remova formatadores soltos.

(0) Primeiro corrija o que o contrato da A.1 quebrou no web (rode o typecheck): quadras-view.tsx passa a enviar sportIds e deixa de pedir capacidade (critério da A.9 item 5 fica feito aqui, com chips selecionáveis); saem as referências ao papel removido em equipe-view, labels.ts, team.ts e testes; sai o pagamento por participante em booking-detail-sheet.tsx e lib/painel/payments.ts. Faça o mínimo correto: a reorganização do sheet é da A.9.

(5) CEP: nos formulários de endereço (painel/espaco/dados-view.tsx, criação e edição de espaço no /super e qualquer outro), ao completar 8 dígitos chame a busca da API e preencha logradouro, bairro, cidade e UF, com estado de carregando e foco no número. Falha ou CEP não encontrado mostra aviso discreto e deixa preencher à mão.

Testes de comportamento para máscaras e seletor. Atualize os e2e com API simulada afetados. Não altere apps/api nem apps/mobile. Fora do item 0, não mexa na lógica de agenda, aulas ou papéis: as tarefas A.9 e A.11 fazem isso.
```

### A.8 · Mobile: máscaras, datas, cabeçalho, torneios e tela do espaço
- **Agente:** `mobile-engineer`
- **Branch:** `feat/adjust-mobile-foundation`

**Prompt**
```
Em apps/mobile, depois do merge de A.1 e A.2 (estarão no main). Se a A.7 ainda não tiver mergeado, crie em packages/shared as funções puras de máscara que precisar sem duplicar o que já exista; a A.7 pode criar as mesmas, então olhe o main antes de começar.

(0) Primeiro corrija o que o contrato da A.1 quebrou no app (rode o typecheck): tire o papel removido de features/staff/role-labels.ts e testes, e o paymentStatus por participante em app/reserva/[id].tsx, features/booking/invite-section.tsx e invites.test.ts.

(1) Campos e máscaras: aplique a anatomia de campo de docs/05-design-system.md (A.2) em todos os formulários, e máscara em todos os inputs que precisam (telefone, CPF, CEP, valores, datas), com keyboardType correto e valor normalizado para a API. Onde houver endereço, use a busca de CEP da API.

(2) Torneios: oculte tudo de torneio no app: aba, filtro, marcações em cards, rótulos e seções da tela do espaço. Use uma constante de feature (FEATURES.tournaments = false) em um só lugar para voltar fácil, sem apagar a tela. Atualize docs/05, que lista as abas.

(3) Datas: tudo que for exibido como data fica em dd/mm/aaaa (lib/datetime.ts), incluindo convites, e mantenha o dia da semana quando ajudar. Em listas muito compactas o ano pode sair só se a linha for ambígua sem ele; prefira mantê-lo.

(4) Tela do espaço: remova a palavra "grátis" de "Cancelamento grátis" (features/space/rent-tab.tsx). Refaça a tela de visualização do espaço (app/espaco/[slug]): hoje tem texto demais. Use ícones (lucide), divida em seções claras (informações rápidas em grade de ícone + rótulo curto, horários em bloco recolhível, regras de cancelamento e reserva como lista compacta, comodidades com ícones, contato por WhatsApp, localização com mapa), com hierarquia visual pelo design system. Nunca invente dados: mostre só o que estiver preenchido (docs/08). Mantenha os estados de vazio e carregamento.

(5) Notificações: crie um cabeçalho fixo compartilhado nas abas do app, com logo ou título à esquerda e sino à direita com contador de não lidas, abrindo /notificacoes e atualizando o contador ao voltar. Reaproveite a tela e os hooks que já existem e tire entradas duplicadas do perfil se ficarem sem sentido (preferências de notificação continuam lá). Respeite a safe area e os dois temas.

Atualize os testes e os fluxos Maestro afetados (não precisa rodar o Maestro). Não altere apps/api nem apps/web.
```

## Onda 2 — Regras de negócio

### A.3 · API: fim da pausa e cancelamento com acesso até o mês pago
- **Agente:** `api-engineer`
- **Branch:** `feat/adjust-api-cancel-subscription`

**Prompt**
```
Em apps/api e packages/shared, aplique a decisão 45 de docs/07-perguntas-em-aberto.md. Migração 0020.

Remova por completo a pausa das assinaturas de aula: endpoints do aluno e da gestão, status PAUSED da assinatura, colunas pausedFrom/pausedUntil, meses de pausa, `max_pause_months_per_year` nas configurações e o limite no plano, jobs, notificações, erros, auditoria nova e testes. Atenção: a pausa do MENSALISTA de aluguel (recurring, cancelledByPause) NÃO muda; confira cada ocorrência de "paus" em apps/api/src/recurring para não mexer nela. A migração volta PAUSED para ACTIVE e descarta pausas agendadas, sem gerar mensalidades retroativas.

Novo cancelamento (subscriptions.service.ts, método cancel, hoje ends_on = fim do período corrente), para aluno e gestão:
- ends_on = último dia do último mês com mensalidade PAID ou WAIVED, se esse mês for o corrente ou futuro; a assinatura segue ativa e com cancelAtPeriodEnd até lá, e nada novo é gerado depois de ends_on.
- Se o mês corrente não está pago: o acesso termina no ato (ends_on = hoje, assinatura e matrículas encerradas). A mensalidade corrente não vencida vira WAIVED com motivo de cancelamento; mensalidade vencida segue devida e aparece para a gestão.
- O aluno não confirma presença em sessão depois de ends_on, e confirmações ou posições de espera depois dessa data são canceladas, com promoção da espera. Vaga da turma segue ocupada até ends_on.
- O job que encerra assinaturas continua fechando as vencidas; idempotente.
- A resposta de cancelamento e os DTOs da assinatura expõem ends_on e um campo derivado (accessUntil), para o app mostrar "Seu plano fica ativo até dd/mm/aaaa".
- Avisar o aluno pelas notificações existentes com a data em que o acesso acaba.
- Com cancelamento pedido, o aluno não troca de turma, mas pode desistir enquanto ends_on não passou: crie `POST .../subscriptions/:id/resume-cancel` para aluno e gestão, que volta ao ciclo normal.
- Pedido ainda em PENDING_APPROVAL continua sendo cancelado de imediato.

Reescreva RN-CLASS-07 e RN-CLASS-08 e RF-CLASS-03/06 no doc 02, e o doc 04. Testes de integração para cada caso, inclusive virada de mês, dia de vencimento, mês pago adiantado, dispensa, ocorrências de espera e fuso de São Paulo.
```

### A.4 · API: edição da reserva pelo jogador
- **Agente:** `api-engineer`
- **Branch:** `feat/adjust-api-booking-edit`

**Prompt**
```
Em apps/api e packages/shared, aplique a decisão 49 de docs/07-perguntas-em-aberto.md. Migração 0021, só se precisar (por exemplo, um novo tipo de notificação).

Crie `PATCH /v1/me/bookings/:bookingId` (siga o padrão real dos controllers) para o organizador editar peopleCount, startsAt e durationMin. Regras:
- Só reserva CONFIRMED, não terminada, de origem APP e sem recurringBookingId; quadra não muda.
- peopleCount: até o início; entre 1 e o máximo da quadra para o esporte, e nunca menor que 1 + convidados não recusados (erro específico com o número).
- Data, horário e duração: até cancellation_deadline_min antes do início atual, e o novo início respeita RN-BOOK-02 (múltiplos de 30 min), RN-BOOK-06 (antecedência e janela), duração mínima/máxima e horário de funcionamento. Com pagamento registrado, recusa com erro próprio que no app vira "fale com o espaço".
- A ocupação é atualizada na mesma transação em court_occupations; a constraint de exclusão do banco continua sendo a garantia (RN-BOOK-03), com erro de conflito tratado.
- priceCents recalcula por RN-BOOK-01 com o pricePerHourCents guardado; shareCents recalcula com splitBookingPrice para todos os participantes (RN-BOOK-09).
- reminderSentAt volta a nulo quando o horário muda.
- Auditoria da alteração; notificação a participantes e gestão do espaço pelo sistema de eventos existente, nas preferências corretas.
- Gestão não muda nesta tarefa.

Crie suporte na disponibilidade (availability.service) para ignorar a própria reserva em edição (`excludeBookingId`, só do próprio organizador), para o app oferecer os horários corretos. O detalhe da reserva expõe flags canEditPeople e canEditSchedule, e o motivo quando falso. Atualize RF-BOOK-03 e adicione RN no doc 02. Testes de integração para cada regra, incluindo concorrência com outra reserva e encurtar a própria reserva sem conflito consigo.
```

## Onda 3 — Professores e contatos

### A.5 · API: mais de um professor por aula
- **Agente:** `api-engineer`
- **Branch:** `feat/adjust-api-multi-teacher`

**Prompt**
```
Em apps/api e packages/shared, aplique a decisão 47 de docs/07-perguntas-em-aberto.md. Migração 0021.

Hoje class_groups e class_sessions têm teacher_member_id. Troque por tabelas de relação class_group_teachers e class_session_teachers (mínimo de 1 professor, com FK composta garantindo o mesmo espaço). A migração leva os dados atuais e remove as colunas. A turma define os professores padrão; a aula pode ter os próprios, e a API de trocar professor passa a editar a lista da aula. Generalizar a geração de sessões para copiar a lista.

Regra de conflito, por usuário (o vínculo TEACHER é por espaço, então compare users.id): recusar sobreposição do mesmo professor em aulas de ESPAÇOS DIFERENTES; no MESMO espaço é permitido. Sessões canceladas não contam. Garanta no banco, como a ocupação de quadra: uma tabela desnormalizada (ex.: teacher_occupations com user_id, space_id, período e status) com constraint de exclusão gist `user_id WITH =, período WITH &&, space_id WITH <>` (btree_gist), mantida na mesma transação; o erro vira TEACHER_SCHEDULE_CONFLICT, mostrando a data e o horário e NUNCA o nome do outro espaço. Valide na criação e edição da turma (recorrência semanal), na geração de sessões, na edição de aula, ao reativar aula e ao mudar horário. O job de geração não pode abortar o lote: se encontrar conflito, gera a aula sem o professor em conflito quando restar outro, e, sem nenhum, registra em log estruturado e num aviso à gestão; explique a escolha no relatório.

Escopo do Professor: ele vê e opera as turmas e sessões em que está entre os professores (filtros de classes-scope.ts, relatórios, presenças, notificações, app do jogador com a lista de professores). Remover um professor do espaço precisa tirar ele das listas e continuar recusando se for o único de aula futura, como hoje; deixe o erro claro. Exclusão de conta e anonimização seguem funcionando. DTOs passam de teacher para teachers (array). Atualize docs 02 e 04 e o seed de demonstração (Astral com uma aula de dois professores). Testes de integração: mesma hora no mesmo espaço (permite), espaços diferentes (recusa), corrida concorrente, sessão cancelada liberando, troca de professor por aula, escopo do Professor em cada listagem.
```

### A.6 · API: base de contatos e link público de convite
- **Agente:** `api-engineer`
- **Branch:** `feat/adjust-api-contacts`

**Prompt**
```
Em apps/api e packages/shared, aplique a decisão 48 de docs/07-perguntas-em-aberto.md. Migração 0022 (a A.5 roda em paralelo com a 0021; a regra de renumerar vale para quem terminar depois). Hoje o convite da reserva gera `spacesports://convite/<token>`, que não abre para quem não tem o app; os convites por nome ficam só em booking_participants (apps/api/src/bookings/invites.service.ts).

Modelo:
- `contacts`: nome, email normalizado, phone E.164 (ao menos um; únicos entre si com índices parciais), user_id (conta vinculada), marketing_consent_at, unsubscribed_at.
- `contact_touchpoints`: contact_id, origem (BOOKING_INVITE_ORGANIZER, BOOKING_INVITE_SELF, DESK_BOOKING, RECURRING_DESK), space_id, booking_id, captured_by, created_at.
- booking_participants ganha contact_id.

Convite:
- inviteUrl passa a ser https: `${WEB_URL}/r/<token>`. O esquema spacesports://convite segue aceito pelo app.
- O POST de convites passa a aceitar itens { name?, phone?, email? }, mantendo compatibilidade com names e userIds; item sem nome vira vaga aberta preenchida na página pública.
- Endpoints públicos, por token e com limite de taxa: preview mínimo (espaço, quadra, esporte, data e hora, primeiro nome do organizador, parte do valor, status; nunca telefone ou dados de outros convidados) e POST de confirmação ou recusa sem conta (nome, phone ou email, consentimento de marketing opcional). Confirmar deixa o participante ACCEPTED sem user_id, associa ao contato e avisa o organizador.
- Quem está logado e aceita pelo token (accept) continua funcionando e vincula contato e participante à conta.
- Reservas de balcão e mensalista de balcão com telefone geram contato com o touchpoint do espaço.

Vínculo ao cadastro:
- Quando uma conta verifica o e-mail (use o hook/evento do fluxo de verificação), contatos com aquele e-mail e os participantes de reservas abertas ligados a eles passam para essa conta; o usuário recebe notificação, e a reserva aparece em Minhas reservas.
- Telefone NÃO vincula sozinho, pois não é verificado. Se existir conta com o telefone, o detalhe da reserva do organizador expõe `suggestedUser` (id e primeiro nome) no participante, e um endpoint de confirmação faz o vínculo. Na gestão, o mesmo para reserva de balcão, na visualização da reserva. Tenha limite de taxa para evitar enumeração.
- Nada de vínculo em reserva terminada ou cancelada, salvo o contact.user_id.

Gestão:
- `GET /v1/super/contacts`: lista paginada, filtros (consentimento, com ou sem conta, origem, espaço, busca) e exportação CSV só dos com consentimento e não descadastrados.
- `GET /v1/manage/spaces/:spaceId/contacts`: só os com touchpoint nesse espaço, para Dono e Admin; mesma exportação.
- Endpoint público de descadastro por token assinado, e ação no Super de apagar contato. anonymizeUser e o fluxo de exclusão de conta apagam ou desvinculam o contato e os touchpoints.

Ajuste também as datas dos textos de notificação da API (apps/api/src/notifications, formatWhen e dayMonth) e dos CSVs gerados pela API (extrato e financeiro do Super) para dd/mm/aaaa.

Auditoria das exportações e dos vínculos. Atualize docs 02 (novos RF-CONTACT) e 04. Testes de integração: privacidade do preview, limite de taxa, vínculo por e-mail verificado e não por e-mail sem verificação, telefone sem vínculo automático, multi-tenancy da lista do espaço, exportação só com consentimento, exclusão de conta.
```

## Onda 4 — Telas das regras de negócio

### A.9 · Web: agenda, reserva, aulas, equipe e Super
- **Agente:** `web-engineer`
- **Branch:** `feat/adjust-web-screens`

**Prompt**
```
Em apps/web, com A.1, A.3, A.4, A.5 e A.7 no main. Veja as decisões 45 a 51 em docs/07.

(1) Agenda: o scroll lateral da grade passa por cima do menu lateral (components/painel/agenda/agenda-grid.tsx usa sticky z-20/z-30). Corrija a causa (contexto de empilhamento e overflow contidos na área de conteúdo) e confira também com o sidebar recolhido e no mobile web.

(2) Sheet da reserva (components/painel/booking-detail-sheet.tsx): hoje os badges não dizem do que são. Reorganize com ícones e rótulos: "Reserva: Confirmada", "Pagamento: Pendente", "Origem: App"; seções Quando e onde, Cliente, Valores, Participantes (sem pagamento por pessoa) e Ações. Remova o registro de pagamento por participante aqui, no payment-dialog, em lib/painel/payments.ts e no extrato (registros antigos continuam legíveis). Mostre o `suggestedUser` quando a A.6 estiver no main; se não estiver, deixe de fora (a A.11 trata).

(3) Lista de presença das aulas (components/painel/espaco/configuracoes-view.tsx): melhore pela seleção. Automática x Manual em cartões de opção com ícone e descrição; os campos que dependem da seleção só aparecem para o modo escolhido, com transição; o tempo se define com um controle humano (número + unidade minutos/horas/dias, ou atalhos como 1h, 3h, 12h, 1 dia, 2 dias), convertendo para os minutos da API, com uma frase-resumo em linguagem natural: "A lista abre 2 dias antes da aula e fecha 1 hora antes". Aplique o mesmo controle de tempo às outras configurações de prazo da tela.

(4) Super, caixa Implantação (components/super/spaces/space-detail.tsx e onboarding-checklist.tsx): troque rótulos técnicos por texto humano em português, com um mapa de rótulos. Mostre etapa, situação e o que falta. Corrija o mesmo na lista de implantações.

(6) Pausa de plano (o web ainda envia pauseAllowed e maxPauseMonthsPerYear, e a API recusa: planos e Configurações estão quebrados até aqui; leia waiveReason em StaffSubscriptionDetail e use accessUntilIfCancelled, em que nulo significa "o acesso termina agora"): remova todas as telas, configurações, filtros, relatórios e rótulos; `/painel/aulas/alunos` passa a mostrar "Cancelado, com acesso até dd/mm/aaaa" e a ação de desfazer o cancelamento, e a mensalidade dispensada no cancelamento com o motivo. A pausa de mensalista (mensalistas-view) fica.

(7) Professores: inclua o rótulo de conflictsWith TEACHER em CONFLICT_LABEL (turmas-view.tsx) e atualize a mensagem de TEACHER_HAS_CLASS_GROUPS (lib/painel/errors.ts). Turmas e aulas têm seleção múltipla de professores (ao menos um), com erro TEACHER_SCHEDULE_CONFLICT explicado com o horário. Listas, calendário e presença mostram todos os professores. Edição por aula: "Professores desta aula".

(8) Convite de equipe (components/convite/accept-invite.tsx, fluxo de cadastro): mostre o e-mail do convite travado, no cadastro e no login. Se o usuário estiver logado com outro e-mail, explique e ofereça trocar de conta.

Atualize os e2e com API simulada e os e2e reais afetados. Não altere apps/api nem apps/mobile.
```

### A.10 · Mobile: edição de reserva, cancelamento, equipe e professores
- **Agente:** `mobile-engineer`
- **Branch:** `feat/adjust-mobile-screens`

**Prompt**
```
Em apps/mobile, com A.1, A.3, A.4, A.5 e A.8 no main. Veja as decisões 45 a 50 em docs/07.

(1) Editar reserva (app/reserva/[id].tsx): quando canEditPeople ou canEditSchedule, mostre "Editar reserva" abrindo um sheet com o número de pessoas e, se permitido, data, horário e duração, pela disponibilidade com excludeBookingId, mesma UX do fluxo de reservar. Mostre a diferença de preço e a nova parte por pessoa antes de confirmar. Sem permissão, mostre o motivo vindo da API ("fale com o espaço" com botão de WhatsApp quando houver). Trate conflito concorrente recarregando os horários.

(2) Plano de aulas: use accessUntilIfCancelled (nulo = o acesso termina agora) e waiveNotice; adicione os rótulos de SUBSCRIPTION_CANCELLED e SUBSCRIPTION_CANCEL_RESUMED em features/notifications/labels.ts. Remova tudo de pausa (telas, sheets, textos, helpers e testes). Cancelamento explica antes de confirmar: "Seu plano fica ativo até dd/mm/aaaa" ou, sem o mês pago, "O acesso termina agora". Depois do cancelamento, mostre aviso com a data e a ação de desistir. Respeite accessUntil na confirmação de presença.

(3) Em features/notifications/labels.ts inclua todos os tipos novos da API, e em preferences-screen.tsx ignore tipo desconhecido, se ainda não estiver. Confirme que não sobrou sinal de pagamento por pessoa no app (a A.8 tirou o principal); a parte de cada um continua informativa.

(5) Professores: mostre todos os professores de uma aula (em listas, um e "+N").

(6) Visão da equipe (features/staff/staff-view-screen.tsx): melhore a UI/UX de "Aulas de hoje" e "Reservas": cartões mais legíveis, com horário em destaque, quadra, status com rótulo, ocupação. Ao tocar em uma aula ou reserva, abra um bottom sheet com as informações completas (aula: professores, quadra, lista com confirmados e espera; reserva: cliente, pessoas, participantes, pagamento). É somente leitura (decisão 21). Use os endpoints existentes; se faltar dado na API, registre no relatório, sem alterar apps/api.

Atualize testes e fluxos Maestro afetados. Não altere apps/api nem apps/web.
```

## Onda 5 — Contatos nas telas

### A.11 · Web: página pública do convite e contatos
- **Agente:** `web-engineer`
- **Branch:** `feat/adjust-web-contacts`

**Prompt**
```
Em apps/web, com A.6 e A.9 no main. Veja a decisão 48 em docs/07.

(1) Página pública `/r/[token]` (mobile-first, noindex): resumo da reserva, botões "Confirmar presença" e "Não vou". Confirmar pede nome e WhatsApp ou e-mail, com máscara, e caixa de consentimento desmarcada: "Quero receber novidades e convites do Space Sports". Mostre aviso curto de privacidade. Depois, oferece "Abrir no app" (`spacesports://convite/<token>`) e "Criar conta" levando o token, para aceitar logo após o cadastro. Estados: expirado, cancelado, já respondido, vaga ocupada.

(2) Descadastro público em `/descadastro/[token]`, uma página simples (é o caminho que a API coloca no CSV).

(3) `/super/contatos` e `/painel/contatos` (Dono e Admin): lista, filtros, busca, indicador de consentimento, link de WhatsApp e exportação CSV; conta vinculada e apagar aparecem só no Super (no painel, a API não expõe conta, e a data é firstTouchAt). Adicione ao menu.

(4) Agenda: na reserva de balcão e no mensalista de balcão, pedir telefone com a dica de que serve para reconhecer o cliente depois; no sheet da reserva, mostre `suggestedUser` e a ação "Vincular a esta conta".

Testes de comportamento e e2e com API simulada. Não altere apps/api nem apps/mobile.
```

### A.12 · Mobile: convite com contato
- **Agente:** `mobile-engineer`
- **Branch:** `feat/adjust-mobile-contacts`

**Prompt**
```
Em apps/mobile, com A.6 e A.10 no main. Veja a decisão 48 em docs/07.

Em features/booking/invite-section.tsx: o convite aceita nome e, opcionalmente, WhatsApp ou e-mail, com máscara e explicação curta do motivo. Com WhatsApp informado, "Enviar" abre `https://wa.me/<numero>?text=<mensagem com o link>` direto na conversa; sem ele, usa o compartilhamento do sistema. Ofereça "Convidar por link" para vaga aberta (a pessoa preenche na página pública). Não use expo-contacts: exigiria nova build nativa. Mostre o status do convidado (confirmado sem conta, no app), e `suggestedUser` com a ação "É essa pessoa? Vincular". O deep link do convite continua funcionando, inclusive vindo do cadastro. Quando uma reserva é vinculada à conta nova, ela aparece em Minhas reservas e na notificação, com navegação correta. Atualize testes e o fluxo Maestro de convite. Não altere apps/api nem apps/web.
```

## Onda 6 — Fechamento

### A.14 · API: vaga aberta já confirmada por outra pessoa
- **Agente:** `api-engineer`
- **Branch:** `fix/adjust-api-open-invite`

**Prompt**
```
Em apps/api (rotas públicas de convite, módulo de contatos e invites): num link de vaga aberta já confirmada por outra pessoa, POST .../confirm responde 200 e a página mostra "Presença confirmada" sem que a pessoa tenha ficado com a vaga. Passe a recusar com erro específico (409 INVITE_SLOT_TAKEN) quando a confirmação for de outro contato, mantendo idempotente a repetição pela mesma pessoa (mesmo telefone ou e-mail); o preview indica que a vaga está ocupada. Trate o erro em apps/web/src na página /r/[token] (exceção de escopo autorizada), mostrando o estado "vaga ocupada". Regenere o cliente. Testes de integração, inclusive confirmação concorrente. Sem migração.
```


### A.15 · Revisão em bloco das telas
- **Agente:** `code-reviewer`
- **Branch:** `review/adjust-screens`

**Prompt**
```
Você é somente leitura: não edite nem commite. Revise em bloco as telas dos ajustes pós-piloto: git diff 05f4b16..HEAD -- apps/web apps/mobile, à luz de docs/tarefas/ajustes-1.md (A.7 a A.12) e das decisões 45 a 52 de docs/07-perguntas-em-aberto.md. Procure bugs de comportamento, regras de permissão só visuais, estados vazios ou de erro faltando, restos de pausa de plano, Recepção, pagamento por participante e torneios no mobile, datas fora de dd/mm/aaaa, cor fixa fora de tokens. Não rode testes nem build (a A.13 roda em paralelo e a RAM é curta); só typecheck do web e do mobile. Liste "bloqueia" e "sugestão", com arquivo e linha.
```

### A.16 · Correções da revisão das telas (convite e valores)
- **Agente:** `api-engineer`
- **Branch:** `fix/adjust-invite-review`

**Prompt**
```
Corrija os achados da revisão em bloco. Exceção de escopo autorizada: pode alterar apps/web e apps/mobile, além de apps/api e packages. Veja a decisão 48 de docs/07.

(1) Bloqueio. acceptedByMe (apps/api/src/bookings/invites.service.ts ~219) só é verdadeiro com status ACCEPTED, ou o web passa a exigir mine.data.status === 'ACCEPTED' como o app (apps/web/src/components/convite/public-invite.tsx ~101, ~109, ~167). Convite direto pendente com ?aceitar=1 tem de aceitar de fato. Teste e2e com API simulada da conta certa.

(2) Bloqueio, decisão do usuário: a vaga confirmada sem conta não pode ser tomada por outra conta. No accept (invites.service.ts ~247, ~264), se o participante já está ACCEPTED sem user_id, recuse com 409 INVITE_SLOT_TAKEN, salvo se o e-mail verificado ou o telefone da conta coincidir com o contato do participante. Web e app escondem "Trazer para minha conta" e "Colocar na minha conta" quando slotTaken for verdadeiro e tratam o erro. Reescreva RF-CONTACT-03 no doc 02. Testes de integração dos dois caminhos.

(3) Decisão do usuário: o Professor não recebe valores nem token de convite. No GET de reserva e nas listagens da gestão (space-bookings.controller.ts, booking-views.ts ~148), sem payment.record: oculte preço, partes, pagamentos e inviteUrl. O web esconde a seção Valores (booking-detail-sheet.tsx ~206) para ele. Adicione a linha na matriz do doc 02 e teste de integração.

(4) apps/web/src/lib/painel/subscriptions.ts ~108: não diga que a mensalidade é dispensada quando há pagamento parcial, igual a apps/mobile/src/features/classes/cancellation.ts ~21.

(5) DTO de participante do organizador ganha hasAccount; em apps/mobile/src/features/booking/invites.ts ~69 mostre "Confirmado sem conta" e "No app" corretamente.

(6) public-invite.tsx ~263: convite direto aberto por outra conta oferece trocar de conta antes do clique.

Regenere o cliente. Testes com no máximo 2 workers; lint e typecheck; commit no branch.
```

### A.13 · QA: e2e real dos ajustes
- **Agente:** `qa-engineer`
- **Branch:** `test/adjust-e2e`

**Prompt**
```
Com todas as tarefas A.1 a A.12 e A.14 no main, escreva e rode e2e reais (Playwright contra a API, em portas próprias, 1 worker), cobrindo: papel Recepção ausente; convite de equipe com e-mail travado e recusa de outro e-mail; cancelamento de plano com mês pago e sem mês pago; aula com dois professores e conflito entre espaços; reserva editada; recebimento só total; link público `/r/<token>` até a confirmação sem conta, e depois cadastro com e-mail verificado vinculando a reserva; CEP com fallback; exportação de contatos só com consentimento. Rode a suíte completa de integração da API (--maxWorkers=2), os unitários do web e do mobile, e os e2e existentes. Atualize apps/web/e2e/mock-contacts.mjs para INVITE_SLOT_TAKEN e slotTaken. Sempre com no máximo 2 workers (1 no Playwright). Corrija só testes; bug de produto vira item do relatório com reprodução. Não altere código de produção.
```

## Prompt de revisão (para todas as tarefas)
- **Agente:** `code-reviewer`, no mesmo worktree da tarefa

```
Revise o branch atual contra o main (git diff main...HEAD). A tarefa está descrita em docs/tarefas/ajustes-1.md, seção <número>, com as decisões 45 a 52 de docs/07-perguntas-em-aberto.md. Verifique se o escopo foi cumprido, se o código ficou dentro das pastas do agente, se lint, typecheck e testes passam (rode-os, com no máximo 2 workers), e aplique o seu checklist. Liste os achados separando "bloqueia o merge" de "sugestão".
```

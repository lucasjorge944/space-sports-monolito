# 11 · IA e Agentes (AG-UI, A2UI, A2A)

Proposta de 2026-11-03. Status: **proposta, não aprovada**. As decisões que faltam estão em `07-perguntas-em-aberto.md` (57 a 63). Nada aqui entra no roadmap de execução antes delas.

## 1. Resumo

- **A tendência é real**, e o Space Sports tem uma vantagem rara para aproveitá-la: as regras de negócio já estão na API (NestJS) e validadas em `packages/shared` (Zod). Um agente pode chamar as mesmas operações que as telas chamam, com as mesmas permissões, o mesmo `space_id` e a mesma auditoria.
- **Os três protocolos não concorrem, são camadas:**
  - **AG-UI**: o "cabo" entre o agente e a tela (streaming de texto, chamadas de ferramenta, estado compartilhado, pausa para confirmação).
  - **A2UI**: o "formato" da interface que o agente gera (JSON declarativo, desenhado com os nossos componentes).
  - **A2A**: a conversa entre agentes de sistemas diferentes (o nosso e o de um parceiro ou assistente externo).
- **Recomendação:** começar pelo **painel do espaço, em modo só leitura** (relatórios conversacionais e o resumo do dia), porque quem paga o SaaS é o espaço e o risco é baixo. Depois, o **assistente de reserva no app**, com confirmação humana antes de gravar. A2A e MCP ficam para a fase de abertura a canais externos (WhatsApp, assistentes de IA, parceiros).
- **Um ajuste na visão:** a meta não deve ser "chat no lugar dos formulários", e sim **"intenção primeiro, tela certa em seguida"**. O jogador que reserva toda terça no mesmo horário resolve mais rápido com um botão "repetir" do que com uma conversa. O agente brilha quando o pedido é vago ("quero jogar amanhã à noite perto de casa"), quando cruza muitas telas ("quem está devendo e não veio nas últimas aulas?") ou quando a resposta é uma combinação que nenhuma tela fixa prevê. Os formulários continuam como caminho garantido.

## 2. As tecnologias (pesquisa de 2026-11-03)

### 2.1 AG-UI (Agent–User Interaction Protocol)
- **O que é:** protocolo aberto, orientado a eventos, entre um backend de agente e a aplicação do usuário. Nasceu da CopilotKit com LangChain e CrewAI. Site: https://docs.ag-ui.com
- **Eventos:** ciclo de vida (`RunStarted`, `RunFinished`, `RunError`, `StepStarted/Finished`), texto (`TextMessageStart/Content/End`), ferramentas (`ToolCallStart/Args/End/Result`), estado (`StateSnapshot`, `StateDelta` com JSON Patch RFC 6902, `MessagesSnapshot`), atividade, raciocínio (`Reasoning*`), subagentes (`Subagent*`), `Custom` e `Raw`.
- **O que importa para nós:**
  - **Human-in-the-loop:** `RunFinished` com `outcome: interrupt` pausa a execução; o cliente retoma com `resume`. É o mecanismo de "confirmar reserva" ou "confirmar pagamento".
  - **Ferramentas no frontend:** o agente pede para a tela abrir um seletor de data, o mapa, a câmera.
  - **Estado compartilhado:** o rascunho da reserva fica sincronizado entre agente e tela.
  - **Generative UI:** suporta A2UI, Open-JSON-UI (OpenAI) e MCP-UI.
- **Ecossistema:** integrações com LangGraph, CrewAI, Mastra, Google ADK, AWS Strands, Microsoft Agent Framework, Pydantic AI e, pela comunidade, Claude Agent SDK. Cliente principal: CopilotKit (React), com **exemplo de React Native**.
- **Maturidade:** ainda antes da 1.0 (eventos `THINKING_*` sendo removidos na 1.0). Isolar atrás de um adaptador nosso.

### 2.2 A2UI (Agent to User Interface)
- **O que é:** especificação de UI generativa criada pelo Google (Apache 2.0, com a CopilotKit). O agente envia **dados**, não código: uma lista plana de componentes, em streaming, que o cliente desenha com **componentes nativos de um catálogo aprovado**. Site: https://a2ui.org
- **Versões:** v0.9.1 atual, **v1.0 candidata** (traz RPC do cliente para o servidor, `actionResponse`, e IDs de ação).
- **Conceitos:** `createSurface` (superfície ligada a um catálogo), `updateComponents`, modelo de dados com *data binding*, ações do usuário que voltam ao agente.
- **Catálogo:** JSON Schema com os componentes, funções e tema que o agente pode usar. O cliente anuncia `supportedCatalogIds`; o agente só usa o que estiver no catálogo. É a defesa contra injeção de UI e o que garante a identidade visual.
- **Renderizadores:** React, Lit e Angular **estáveis**; Flutter e SwiftUI alfa; Jetpack Compose planejado. **React Native só pela comunidade** (`a2ui-react-native`, na v0.8). O `json-render` da Vercel desenha catálogos A2UI a partir de schemas Zod.
- **Para nós:** no web, o renderizador React com um catálogo próprio sobre shadcn/ui e `packages/ui-tokens`. No app, um renderizador próprio e pequeno (ver 4.3), até a opção da comunidade amadurecer.

### 2.3 A2A (Agent2Agent)
- **O que é:** protocolo aberto para agentes de sistemas diferentes conversarem sem expor memória, ferramentas ou lógica interna. Criado pelo Google, doado à **Linux Foundation** (comitê com AWS, Cisco, Google, IBM, Microsoft, Salesforce, SAP e ServiceNow), agora na Agentic AI Foundation. **v1.0** publicada. Site: https://a2a-protocol.org
- **Conceitos:** **Agent Card** (JSON com identidade, endpoint, habilidades e autenticação), **Task** (unidade de trabalho com ciclo de vida), **Message**, **Part** (texto, bytes, URL ou JSON), **Artifact** (resultado), streaming por SSE e push por webhook. Credenciais no cabeçalho HTTP (OAuth, chave).
- **SDKs oficiais:** Python, JavaScript, Java, .NET, Go e Rust.
- **O que ele não é:** o próprio site avisa que A2A **não** é protocolo de ferramenta nem de subagente interno. Dentro do nosso monólito ele não ajuda. Ele serve para **fora**: o nosso agente de reservas atendendo o assistente de IA do usuário, um parceiro (Wellhub, TotalPass) ou um provedor de WhatsApp.
- **MCP** (agente ↔ ferramentas) é o vizinho natural: expor as mesmas habilidades num servidor MCP coloca o Space Sports dentro do Claude, do ChatGPT e de outros assistentes.

### 2.4 Como as camadas se encaixam

```
 Jogador (app)      Gestão (painel web)      Super (web)      Assistentes/parceiros externos
      │                     │                    │                      │
      └──── AG-UI (SSE) ────┴────────────────────┘          A2A (Agent Card) · MCP
                     │   eventos + UI em A2UI                           │
                     ▼                                                  ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │  API NestJS · módulo `agent`                                          │
        │  laço do agente (LLM) · catálogo A2UI · confirmação (interrupt)       │
        │  ┌─────────────────────────────────────────────────────────────────┐  │
        │  │ Registro de ferramentas = serviços de domínio já existentes      │  │
        │  │ (Bookings, Classes, Subscriptions, Payments, Spaces, Insights)   │  │
        │  │ mesmo guard de papel, mesmo `space_id`, mesma auditoria          │  │
        │  └─────────────────────────────────────────────────────────────────┘  │
        └───────────────────────────────────────────────────────────────────────┘
                     │                                    │
               PostgreSQL (dados)                 Provedor de LLM (pergunta 57)
```

## 3. Princípios (valem para todas as fases)

1. **O agente não tem superpoderes.** Cada ferramenta é um método de serviço que já existe, chamado com a sessão do usuário. O guard de papel (`02 · Matriz de permissões`) e o filtro por `space_id` valem igual. O agente de um Professor não vê valores (decisão 53) porque a ferramenta não devolve.
2. **Toda escrita pede confirmação.** Criar, editar, cancelar, registrar pagamento: o agente monta um **cartão de confirmação** (A2UI) com o que vai acontecer, e a execução pausa (`interrupt` do AG-UI) até o toque em "Confirmar". A API recalcula tudo na gravação (preço RN-BOOK-01, prazos RN-BOOK-05/12). A auditoria registra que a ação veio do agente.
3. **Número vem da ferramenta, nunca do modelo.** O LLM escolhe o layout e as consultas; os valores entram na tela pelo *data binding* do A2UI, direto do resultado da ferramenta. Assim o modelo não "arredonda" um faturamento nem inventa um horário livre.
4. **Nada inventado sobre os espaços.** Igual a `08-espacos-parceiros.md`: o agente só afirma o que está preenchido. Sem dado, responde "o espaço não informou" e mostra o contato.
5. **Catálogo fechado e com a marca.** A UI gerada só usa componentes do nosso catálogo, construídos com `packages/ui-tokens` (claro e escuro). Nada de HTML livre nem cor fixa.
6. **Formulário sempre disponível.** Cada experiência com agente tem um "fazer pelo formulário" que leva à tela tradicional, já preenchida com o que foi entendido.
7. **Dados pessoais no mínimo.** Telefones e e-mails de contatos (decisão 48) não vão para o modelo, a não ser que a tarefa precise; nos logs, mascarados. O tratamento entra na política de privacidade (LGPD).
8. **Custo e abuso sob controle.** Cota por usuário e por espaço, limite de taxa como no login, modelo menor para tarefas simples, feature flag no PostHog por espaço.

## 4. Onde aplicar

Cada caso tem quem usa, o que muda, as camadas e o risco. **R** = só leitura; **W** = escreve, com confirmação.

### 4.1 Painel do espaço (Dono, Admin, Professor)

| ID | Caso | Exemplo de pedido | Resultado na tela | Tipo |
|---|---|---|---|---|
| **AI-PAINEL-01** | **Relatórios conversacionais** | "Quanto recebi em outubro, por forma de pagamento?" · "Ocupação das quadras às terças à noite no último mês" · "Alunos com mensalidade atrasada que faltaram às últimas 2 aulas" | Indicadores, gráfico (Recharts) e tabela, gerados em A2UI, com exportar CSV | R |
| **AI-PAINEL-02** | **Fixar no painel** | "Fixa esse gráfico na minha tela inicial" | A visão vira um widget salvo. Ela guarda o layout A2UI e a consulta, e roda de novo com dados atuais **sem chamar o modelo** | R |
| **AI-PAINEL-03** | **Resumo do dia** ("Hoje no espaço") | Abre sozinho em `/painel` | A receber hoje, listas abertas, pedidos de mensalista pendentes, conflitos de aula (`class_session_conflicts`), aniversários de alunos e uma sugestão de ação | R |
| **AI-PAINEL-04** | **Balcão por comando** | "Reserva a quadra 2 hoje às 19h, 1h30, para o João, 31 9…" | Rascunho da reserva de balcão com preço e conflitos; confirmar grava (RF-BOOK-06) | W |
| **AI-PAINEL-05** | **Registrar pagamentos** | "O João pagou a reserva de ontem no Pix" | Cartão com a reserva encontrada, valor e forma; confirmar registra (RF-BOOK-08, RN-PAY-01) | W |
| **AI-PAINEL-06** | **Ações em lote** | "Cancela as aulas de amanhã à tarde por chuva e avisa os alunos" | Lista do que será afetado (aulas, alunos, notificações) e um único "Confirmar" | W |
| **AI-PAINEL-07** | **Assistente do professor** | "Quem confirmou na turma das 18h?" · "Abre a lista de quinta" | Lista de presença; abrir/fechar com confirmação (RN-CLASS-04) | R/W |

Por que começar aqui: as telas de relatório (`/painel/aulas/relatorios`, `/painel/recebimentos`) respondem perguntas fixas. Cada pergunta nova vira uma tarefa de desenvolvimento. Com o agente, o espaço pergunta o que quiser dentro dos dados dele, e isso vira argumento de venda do SaaS.

**Como o agente consulta os dados, sem SQL livre:** uma **camada semântica** de métricas parametrizadas na API (ex.: `revenue(period, groupBy)`, `occupancy(courts, weekday, hourRange)`, `overdueStudents(minDays)`, `attendanceRate(classGroup, period)`). O modelo combina as métricas e escolhe a visualização. SQL gerado pelo modelo fica de fora: o isolamento entre espaços é crítico (`10-seguranca.md`) e uma métrica nova é barata de adicionar. A camada aproveita o que já existe em `attendance-reports.service.ts`, `statement.service.ts` e `super/insights.service.ts`.

### 4.2 App do jogador

| ID | Caso | Exemplo de pedido | Resultado na tela | Tipo |
|---|---|---|---|---|
| **AI-APP-01** | **Assistente de reserva** | "Quero jogar futevôlei amanhã depois das 19h perto do Buritis, somos 4" | Carrossel de opções (espaço, quadra, horário, preço, distância); toque leva a um cartão de confirmação com preço, prazo de cancelamento e forma de pagamento; confirmar cria a reserva (RF-BOOK-01, RN-BOOK-07) e oferece o convite para dividir (RF-BOOK-04) | W |
| **AI-APP-02** | **Mudar a reserva** | "Passa minha reserva de quinta para as 20h" | Usa `canEditSchedule` e os motivos (RN-BOOK-10 a 13); mostra o novo preço; confirmar edita | W |
| **AI-APP-03** | **Achar aula** | "Aula de beach tennis para iniciante, 2x por semana, à noite" | Planos e turmas com vaga; confirmar envia o pedido de matrícula (RF-CLASS-04) | W |
| **AI-APP-04** | **Perguntas sobre o espaço** | "Tem estacionamento e chuveiro?" · "Até quando posso cancelar?" | Resposta curta com base só no que o espaço preencheu, e o bloco da página do espaço | R |
| **AI-APP-05** | **Minha semana** | "O que eu tenho essa semana?" | Reservas, aulas, listas abertas para confirmar e mensalidade a vencer, com botões de ação | R/W |

Entrada no app: uma barra "O que você quer jogar?" no topo da vitrine (`(tabs)/index.tsx`), e não uma aba de chat separada. O resultado aparece como cartões, não como parágrafos. Entrada por voz (ditado do teclado) já funciona sem trabalho extra.

### 4.3 Painel Super

| ID | Caso | Exemplo | Tipo |
|---|---|---|---|
| **AI-SUPER-01** | Insights consolidados | "Quais espaços caíram em reservas nas últimas 4 semanas?" (RF-SUPER-09) | R |
| **AI-SUPER-02** | Busca na auditoria | "O que o modo suporte mexeu na Arena Errejota ontem?" (RF-SUPER-10) | R |
| **AI-SUPER-03** | Implantação assistida | O Super cola o texto que o espaço mandou (horários, preços, quadras); o agente propõe o preenchimento, campo a campo, para revisão. **Nunca grava sozinho** e só usa o que veio no texto (RF-SUPER-02) | W |

### 4.4 Canais externos (fase de abertura)

| ID | Caso | Camada |
|---|---|---|
| **AI-EXT-01** | **Reserva pelo WhatsApp.** O primeiro problema de `01-visao-produto.md` é "reserva por WhatsApp com idas e vindas". O mesmo agente, com as mesmas ferramentas, atende no WhatsApp com mensagens interativas (listas e botões), confirmação e link para o app. Junta-se ao item 5 do backlog da Fase 4 | Adaptador de canal sobre o mesmo núcleo |
| **AI-EXT-02** | **Servidor MCP público** com busca de espaços, disponibilidade e reserva (com login OAuth do usuário), para assistentes como Claude e ChatGPT | MCP (+ A2UI em MCP Apps) |
| **AI-EXT-03** | **Agente A2A** com Agent Card em `spacesports.com.br`, para parceiros e agentes de terceiros (Wellhub/TotalPass, organizadores de eventos, agentes de concierge) | A2A |

## 5. Arquitetura proposta

### 5.1 Backend (`apps/api`, módulo `agent`)
- **Endpoint AG-UI:** `POST /v1/agent/runs` com resposta em SSE, autenticado pela sessão do Better Auth, com `surface` (`APP`, `PAINEL`, `SUPER`) e `spaceId` no contexto.
- **Laço do agente:** fino e dentro do monólito (princípio 2 de `03-arquitetura.md`): SDK do provedor escolhido com *tool use* e o codificador de eventos AG-UI (pacotes TypeScript do AG-UI, versão conferida no spike). Mastra fica como alternativa se o laço próprio crescer demais.
- **Registro de ferramentas:** cada ferramenta declara nome, descrição, schema Zod de entrada (reaproveitado de `packages/shared`), papel mínimo, se escreve (então exige confirmação) e o serviço que chama. O schema do LLM sai do Zod; não há segunda fonte de verdade.
- **Roteamento por superfície:** o app só enxerga ferramentas de jogador; o painel, as do papel no espaço selecionado; o Super, as de plataforma.
- **Catálogo A2UI:** schema em `packages/shared/agent-ui` (JSON Schema gerado do Zod), versionado (`catalogId` com versão). Componentes iniciais: `KpiRow`, `Chart` (barras, linhas, pizza), `DataTable`, `SlotOptions`, `SpaceCard`, `BookingSummary`, `ConfirmCard`, `PersonList`, `EmptyState`, `Callout`.
- **Modelos:** um modelo rápido (ex.: Claude Haiku 5.5) para entender o pedido e respostas simples; um modelo mais forte (ex.: Claude Sonnet 5.5) para relatórios e planos com várias ferramentas. Provedor e região na pergunta 57; com a infraestrutura na AWS, o Amazon Bedrock é candidato natural, sujeito a conferir a disponibilidade em `sa-east-1`.
- **Novas tabelas:**
  - `agent_threads` (usuário, `space_id` opcional, superfície, criada em)
  - `agent_messages` (thread, papel, conteúdo resumido, eventos A2UI)
  - `agent_tool_calls` (ferramenta, argumentos, status, `confirmed_by`, ligação com `audit_logs`)
  - `agent_saved_views` (espaço, título, layout A2UI, consulta, ordem; AI-PAINEL-02)
  - `agent_usage` (tokens e custo em centavos por usuário/espaço/dia)
- **Jobs (BullMQ):** pré-computar o "Resumo do dia" de manhã; consolidar `agent_usage`.
- **Observabilidade:** traços por execução (pino + OpenTelemetry) e um conjunto de **avaliações** (perguntas reais dos pilotos com a resposta esperada), rodado na CI quando o prompt, o modelo ou uma ferramenta mudam.

### 5.2 Web (`apps/web`)
- Cliente AG-UI com o renderizador **A2UI para React** e o catálogo implementado em shadcn/ui + Recharts + `ui-tokens`.
- **Superfícies:** um painel lateral "Pergunte ao Space Sports" no `/painel` (atalho ⌘K) e um bloco de resposta no topo de `/painel/recebimentos` e `/painel/aulas/relatorios`.
- O spike compara **CopilotKit** (pronto, com HITL e generative UI) e um cliente próprio sobre os pacotes do AG-UI. O critério é não trazer um segundo servidor (o CopilotRuntime) para a infraestrutura.

### 5.3 Mobile (`apps/mobile`)
- Cliente AG-UI em TypeScript sobre o `fetch` com streaming do Expo (`expo/fetch`), a conferir no spike, ou o cliente React Native da CopilotKit.
- **Renderizador A2UI próprio** para o nosso catálogo (NativeWind + React Native Reusables). O catálogo é pequeno e fechado, então o renderizador é um mapa `componente → tela` validado com Zod. Trocamos pelo renderizador da comunidade se ele chegar à v1.0 com qualidade.
- As ações nativas (localização, calendário, compartilhar convite) viram **ferramentas de frontend** do AG-UI.

## 6. Plano em fases: dos 20% à maior parte da plataforma

A medida de "20%" proposta: **jornadas principais com entrada pelo agente**, não telas. São 15 jornadas: reservar, editar reserva, mensalista, achar aula, confirmar presença, minhas coisas, dúvidas do espaço, relatórios, recebimentos, balcão, inadimplência, lista de presença, cancelar aula, implantação e insights do Super. Três delas são os 20%.

| Fase | Entrega | Jornadas | Camadas | Critério de saída |
|---|---|---|---|---|
| **IA-0 Fundação** | Módulo `agent`, endpoint AG-UI, registro de ferramentas com permissões, catálogo A2UI v1, renderizadores web e mobile, tabelas, cotas, flags, avaliações | — | AG-UI, A2UI | Uma pergunta de teste responde no web e no app, com permissões e custo registrados |
| **IA-1 Painel que responde** (~20%) | AI-PAINEL-01, 02 e 03 | Relatórios, recebimentos, inadimplência | AG-UI, A2UI | 1 espaço piloto usando por 2 semanas; ≥ 80% das perguntas da avaliação certas; nenhum dado de outro espaço |
| **IA-2 App que entende** (~40%) | AI-APP-01, 04 e 05 | + reservar, dúvidas, minhas coisas | + interrupt (confirmação) | % das reservas do piloto feitas pelo assistente; tempo até reservar ≤ o do formulário |
| **IA-3 Gestão por comando** (~65%) | AI-APP-02/03, AI-PAINEL-04 a 07, AI-SUPER-01 a 03 | + editar, aula, balcão, lista, cancelar aula, Super | + ações em lote | Taxa de confirmação alta e de "desfazer" baixa; sem incidente de permissão |
| **IA-4 Abertura** (~80%+) | AI-EXT-01 (WhatsApp), AI-EXT-02 (MCP) e AI-EXT-03 (A2A) | Mesmas jornadas fora do app | + A2A, MCP | Primeiras reservas vindas de canal externo |

**Ordem com o roadmap atual:** IA-0 pode começar em paralelo com a Fase 3 (Torneios), que é outra área do código. IA-1 depende de dados reais dos pilotos. Depois da Fase 3, as ferramentas de torneio (inscrição de dupla, chave, placar) entram direto no agente.

**Plano de consumo:** os briefings destas fases usam `**Plano padrão:** forte`, como pedido em 2026-11-03.

## 7. Riscos e cuidados

| Risco | Mitigação |
|---|---|
| Agente vaza dado de outro espaço ou acima do papel | Ferramentas só chamam serviços com guard; testes de isolamento na avaliação; revisão de segurança antes do IA-1 |
| Injeção de prompt por texto digitado por terceiros (descrição do espaço, nome de convidado) | Conteúdo de terceiros marcado como dado; nenhuma ferramenta passa do papel do usuário; escrita sempre com confirmação |
| Número errado num relatório | Princípio 3 (valor vem da ferramenta por *data binding*); avaliações com respostas conhecidas |
| Especificações ainda mudando (AG-UI antes da 1.0, A2UI v1.0 candidata) | Adaptador próprio; catálogo versionado; renderizador mobile nosso |
| Chat mais lento que o formulário | Medir o tempo até concluir; manter atalhos ("repetir reserva"); o agente abre a tela pronta quando for mais rápido |
| Custo por espaço | Cotas, modelo menor por padrão, cache do resumo do dia, visões fixadas sem LLM |
| LGPD e transferência internacional de dados | Pergunta 58; dados pessoais mínimos; acordo de tratamento com o provedor; atualizar a política de privacidade |

## 8. Métricas
- **Adoção:** % de usuários ativos que usam o agente por semana; perguntas por espaço por semana.
- **Eficácia:** % de execuções concluídas sem cair no formulário; taxa de confirmação dos cartões; % de respostas certas na avaliação.
- **Negócio:** reservas pelo assistente (soma na North Star); tempo médio até reservar; uso semanal do painel por espaço.
- **Custo:** custo de IA por espaço por mês e por reserva gerada.

## 9. Próximos passos
1. Responder as perguntas 57 a 63 de `07-perguntas-em-aberto.md`.
2. Escrever `docs/tarefas/fase-ia-0.md` (**Plano padrão:** `forte`), quebrando a IA-0 em tarefas para `api-engineer` (módulo, contrato, ferramentas), `ui-designer` (catálogo A2UI com a marca), `web-engineer` e `mobile-engineer` (renderizadores e clientes), `qa-engineer` (avaliações e isolamento) e `code-reviewer`.
3. Spike de 1 a 2 dias antes da IA-0: um relatório (AI-PAINEL-01) de ponta a ponta no staging com dados de teste, para medir latência, custo e qualidade.

## Fontes
- AG-UI: https://docs.ag-ui.com/introduction · eventos: https://docs.ag-ui.com/concepts/events · especificações de UI generativa: https://docs.ag-ui.com/concepts/generative-ui-specs
- A2UI: https://a2ui.org · renderizadores: https://a2ui.org/reference/renderers/ · catálogos: https://a2ui.org/concepts/catalogs/
- A2A: https://a2a-protocol.org/latest/ · conceitos: https://a2a-protocol.org/latest/topics/key-concepts/
- Google Developers Blog, A2UI + CopilotKit: https://developers.googleblog.com/build-generative-ui-apps-with-a2ui-copilotkit-agents/

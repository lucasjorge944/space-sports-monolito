# Space Sports

O plano completo do produto está em `docs/` (comece por `docs/README.md`). Briefing original em `Prompt.md`.

- Idioma da documentação e da comunicação: português (BR). Código, nomes de tabelas e identificadores em inglês.
- Antes de implementar, consulte `docs/02-requisitos-funcionais.md` (IDs RF/RN) e `docs/06-roadmap.md` (fase atual e checklists). Marque os itens concluídos no roadmap.
- Decisões de produto pendentes ficam em `docs/07-perguntas-em-aberto.md`; não assuma respostas para itens 🔴 sem confirmar com o usuário.
- Modelo: SaaS cobrado dos espaços **fora da plataforma** (sem planos/contratos/faturas por enquanto; espaço cadastrado = ativo); jogadores pagam direto no espaço ou, se o espaço ativar, online pelo app com split no gateway (taxa de serviço paga pelo espaço; plataforma não guarda saldo; sem saldo pré-pago; gateway desacoplado, fake por enquanto — `docs/13-pagamentos-online.md`).
- Dados dos espaços parceiros (`docs/08-espacos-parceiros.md`): nunca inventar endereço, preço ou quadras — usar só o que estiver preenchido.
- Dinheiro em centavos (inteiro); datas em UTC (`timestamptz`), exibidas em `America/Sao_Paulo`.
- Identidade visual: o kit de marca em `docs/brand/kit/` (pranchas 01–07, incluindo o dark mode) é a fonte de verdade visual do web e do app, nos temas claro e escuro. Cores, fontes, raios e logos vêm de `packages/ui-tokens`; nada de cor fixa no código das telas.

## Time de agentes (`.claude/agents/`)
| Agente | Escopo | Modelo | Effort |
|---|---|---|---|
| `api-engineer` | `apps/api`, `packages/shared`, DB, workers; dono do contrato OpenAPI | opus | medium |
| `web-engineer` | `apps/web` (`/painel`, `/super`, públicas) | sonnet | high |
| `mobile-engineer` | `apps/mobile` (jogador + visão de equipe somente leitura) | sonnet | high |
| `ui-designer` | `packages/ui-tokens`, design system, revisão de UX | opus | medium |
| `qa-engineer` | Testes (integração, Playwright, Maestro); não altera código de produção | sonnet | medium |
| `code-reviewer` | Revisão somente leitura | opus | medium |
| `git-operator` | Commits, merges, push e PRs simples; não mexe em código | haiku | low |

- A sessão principal orquestra: quebra as tarefas por ID RF/RN, atualiza o roadmap e leva as decisões 🔴 ao usuário.
- Fluxo por feature: `api-engineer` (contrato) → `web-engineer` e `mobile-engineer` em paralelo → `qa-engineer` → `code-reviewer`.
- Os agentes rodam no **Orca IDE**, uma sessão por worktree (Claude Code). A sessão principal escreve o briefing em `docs/tarefas/fase-N.md` e lança as tarefas com `scripts/orchestration/dispatch.py run|review <briefing> <tarefa> --watch`, que escolhe agente, modelo e effort pelo **plano de consumo** e chama o `orca-ide`.
- O `git-operator` roda no Haiku e é lançado sem briefing: `scripts/orchestration/dispatch.py git "<instrução>" [--worktree <seletor>] --watch` (padrão: worktree do repositório principal). Nunca faz force push, reset --hard nem push direto no `main` sem pedido explícito; PRs exigem remoto no GitHub.
- Planos de consumo (`economico`, `sonnet`, `equilibrado`, `forte`) ficam em `.claude/orchestration/plans.yaml`. A tabela acima é o plano `equilibrado`. O plano vem do `**Plano padrão:**` do briefing da fase, e uma tarefa pode sobrescrevê-lo com `- **Plano:**`. O dispatch pula provedores acima de 95% do limite de 5h ou do semanal e, com `--watch`, faz fallback para o próximo modelo da cadeia se o agente bater no limite. Detalhes em `docs/tarefas/README.md`.
- O Orca não lê o frontmatter dos agentes, e as restrições de `tools:` (ex.: `code-reviewer` só leitura) valem só como instrução. O dispatch já inclui essa instrução no prompt do `code-reviewer`.
- Lições de revisão: o `code-reviewer` registra padrões de erro recorrentes; os repetidos em 2 tarefas viram regra em `.claude/lessons/<papel>.md`, que o dispatch injeta no prompt do agente (`dispatch.py lessons`). Commite `.claude/lessons/` junto com os merges.
- Bibliotecas: os agentes consultam o MCP `context7` (`.mcp.json`) quando não têm certeza de uma API na versão instalada.
- Skills do projeto (`.claude/skills/`): `contrato-api` (mudança de contrato Zod → OpenAPI → api-client) e `verificar-visual` (capturas claro/escuro comparadas ao kit).
- Worktrees paralelos costumam conflitar no `pnpm-lock.yaml`; resolva no merge regenerando o lockfile.

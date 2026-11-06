# Briefings e planos de consumo

Cada fase do roadmap (`docs/06-roadmap.md`) tem um briefing em `docs/tarefas/fase-N.md`. Cada seção `###` do briefing é uma tarefa, e cada tarefa vira um worktree no Orca com um agente.

## Planos de consumo

Os planos ficam em `.claude/orchestration/plans.yaml`. Cada um define, para cada papel, uma cadeia de modelos (agente, modelo, effort) em ordem de preferência:

| Plano | Quando usar |
|---|---|
| `economico` | Tarefas mecânicas ou quando o limite do Claude está apertado. Manda `web`, `mobile` e `qa` para o Haiku. |
| `sonnet` | Sem Opus. Sonnet nos papéis de código, revisão e design; Haiku em `qa` e `git`. |
| `equilibrado` | Padrão. Equivale à tabela de agentes do `CLAUDE.md`, com fallback. |
| `forte` | Contratos, regras de negócio delicadas, refatorações grandes. |

O `api-engineer` e o `code-reviewer` nunca descem para os modelos mais baratos.

### Escolha do plano (dois níveis)

1. **Fase:** o cabeçalho do briefing define o padrão:
   ```markdown
   **Plano padrão:** `equilibrado`
   ```
2. **Tarefa:** uma tarefa pode sobrescrever:
   ```markdown
   ### 1.3 · Contrato de reservas
   - **Agente:** `api-engineer`
   - **Branch:** `feat/booking-contract`
   - **Plano:** `forte`
   ```

Sem nenhum dos dois, vale o `default_plan` do `plans.yaml`. A opção `--plan` na linha de comando ganha de todos.

## Fallback

- **Antes de lançar:** o dispatch lê o consumo de cada provedor e pula os que passaram de 95% no limite de 5h ou no semanal (`thresholds` no `plans.yaml`).
  - Claude: gravado pela statusline do projeto (`scripts/orchestration/statusline.sh`) a cada sessão.
  - Sem dado, o provedor é considerado disponível.
- **Durante a execução** (`--watch`): quando o agente fica ocioso, o dispatch lê o terminal. Se encontrar uma mensagem de limite (`limit_patterns`), marca o provedor como bloqueado até o reset, fecha o terminal e lança o próximo da cadeia no mesmo worktree, pedindo para retomar a partir do `git status`.

O estado fica em `~/.local/state/orca-plans/` (`claude.json`, `exhausted.json`, `dispatch-log.jsonl`).

## Rodar o `--watch` pela sessão principal

Cada `--watch` é um processo longo que precisa sobreviver ao comando que o lançou. Lance **um comando por tarefa** com `run_in_background` da ferramenta Bash, sem `&`, sem `sleep` e sem encadear com outros comandos:

```bash
scripts/orchestration/dispatch.py run docs/tarefas/fase-1.md 1.3 --watch
```

Com `cmd1 & sleep; cmd2 & tail ...` dentro de um único comando em segundo plano, o shell termina no fim da cadeia, mata os `--watch` e nenhum fim de tarefa é notificado. O processo termina quando o agente fica ocioso sem sinal de limite, e isso dispara a notificação de conclusão da sessão principal.

## Comandos

```bash
D=scripts/orchestration/dispatch.py
$D usage                                    # consumo e bloqueios por provedor
$D plan   docs/tarefas/fase-1.md 1.3        # qual modelo seria escolhido e por quê
$D run    docs/tarefas/fase-1.md 1.3 --watch  # cria o worktree e lança o agente
$D review docs/tarefas/fase-1.md 1.3 --watch  # code-reviewer no worktree da tarefa
$D run    docs/tarefas/fase-1.md 1.3 --plan economico --dry-run
$D git    "commite as mudanças de docs/ e faça merge de feat/x no main" --watch  # git-operator, sem briefing
```

O `review` usa o bloco da seção `## Prompt de revisão` do briefing, trocando `<número>` pelo id da tarefa.

## Formato do briefing

- Cabeçalho com `**Plano padrão:**`.
- Por tarefa: `### N.M · Título`, campos `- **Agente:**`, `- **Branch:**`, opcional `- **Plano:**`, e o bloco `**Prompt**` seguido de um bloco de código.
- Prompt autossuficiente: ele pode ser executado por um modelo que não conhece o contexto da conversa.

## Lições de revisão

As revisões alimentam os prompts dos agentes, sem passo manual:

1. No `review`, o dispatch pede ao `code-reviewer` que registre de 0 a 3 lições: padrões de erro que tendem a se repetir e que uma regra curta teria evitado. O registro (`dispatch.py lesson add --task … --role … --key … --text …`) vai para `~/.local/state/orca-plans/lessons-inbox.jsonl`, fora do repositório; é a única escrita permitida ao revisor.
2. Quando a mesma `key` aparece em **2 tarefas distintas**, o `review --watch` a promove ao terminar para `.claude/lessons/<papel>.md`.
3. A cada `run`, o dispatch inclui as lições do papel no prompt do agente. Como o arquivo é lido do repositório principal, a lição vale já no próximo lançamento, mesmo antes do commit.

```bash
D=scripts/orchestration/dispatch.py
$D lessons                      # caixa de lições: contagem por key e o que já foi promovido
$D lessons --role web-engineer
$D lessons --apply              # promove as que atingiram 2 tarefas (o review --watch já faz isso)
$D lessons --promote <key>      # promove já na primeira ocorrência (erro grave que não pode se repetir)
```

Os arquivos de `.claude/lessons/` são versionados: commite-os junto com o merge e consolide quando passarem de ~20 itens (o dispatch avisa).

## Documentação das bibliotecas (context7)

O MCP `context7` está em `.mcp.json` e pré-aprovado em `.claude/settings.json` (`enabledMcpjsonServers` e permissão `mcp__context7`), para as sessões do Orca não travarem pedindo aprovação. Os agentes de implementação o consultam quando não têm certeza de uma API na versão instalada. Sem chave, o context7 tem limite de requisições; se começar a recusar, crie uma chave em context7.com e adicione o header `CONTEXT7_API_KEY` no `.mcp.json` por variável de ambiente (nunca a chave no arquivo).

#!/usr/bin/env python3
"""Despacha tarefas dos briefings (docs/tarefas/fase-N.md) para o Orca conforme o plano de consumo.

Uso:
  dispatch.py usage                              consumo atual por provedor
  dispatch.py plan  <fase.md> <tarefa>           mostra o plano e o candidato escolhido
  dispatch.py run   <fase.md> <tarefa> [--watch] cria o worktree e lança o agente
  dispatch.py review <fase.md> <tarefa> [--watch] lança o code-reviewer no worktree da tarefa
  dispatch.py watch <fase.md> <tarefa> --terminal <handle> --role <papel>
  dispatch.py git "<instrução>" [--worktree <seletor>] [--watch]  lança o git-operator
  dispatch.py lesson add --role <papel> --key <slug> --task <id> --text "<regra>"  (usado pelo code-reviewer)
  dispatch.py lessons [--role <papel>] [--apply] [--promote <slug>]  caixa de lições de revisão

Opções comuns: --plan <nome> (sobrescreve o plano da tarefa/fase), --dry-run.
Planos e limiares: .claude/orchestration/plans.yaml. Documentação: docs/tarefas/README.md.
"""

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
PLANS_FILE = ROOT / ".claude/orchestration/plans.yaml"
STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "orca-plans"
ORCA = "orca-ide"
# Sem rate_limits novos por mais que isso, o dado do provedor é tratado como desconhecido.
STALE_SECONDS = 6 * 3600
# Quando o limite é detectado no terminal sem horário de reset conhecido.
DEFAULT_COOLDOWN = 3600
WATCH_IDLE_TIMEOUT_MS = 30 * 60 * 1000

READ_ONLY_NOTE = (
    "Você é somente leitura: não edite, crie ou apague arquivos, não faça commit nem push. "
    "Apenas leia, rode lint/typecheck/testes e reporte."
)

# Lições de revisão: o code-reviewer registra candidatas na caixa (fora do repo); as que se repetem
# em tarefas diferentes viram regra em .claude/lessons/<papel>.md e entram no prompt do papel.
LESSONS_DIR = ROOT / ".claude/lessons"
LESSONS_INBOX = STATE_DIR / "lessons-inbox.jsonl"
LESSON_ROLES = ("api-engineer", "web-engineer", "mobile-engineer", "qa-engineer", "ui-designer")
LESSON_MIN_TASKS = 2  # tarefas distintas com a mesma lição antes de promover
LESSONS_SOFT_CAP = 20

LESSONS_REVIEW_NOTE = """## Lições para o time
Depois do relatório, registre de 0 a 3 lições: padrões de erro deste diff que tendem a se repetir em \
tarefas futuras e que uma regra curta no prompt do agente teria evitado. Não registre bug pontual, \
nada que o linter pegue, nem o que já está em `.claude/agents/<papel>.md` ou em \
`scripts/orchestration/dispatch.py lessons --role <papel>` (se for o mesmo padrão, reutilize a mesma \
key). O registro é a única escrita permitida a você e fica fora do repositório:

```
scripts/orchestration/dispatch.py lesson add --task {task} --role <api-engineer|web-engineer|mobile-engineer|qa-engineer|ui-designer> \\
  --key <slug-em-kebab-case> --text "<regra imperativa de uma linha, com o motivo>"
```

Termine o relatório com a lista das lições registradas (ou "Nenhuma lição nova")."""


# ---------- config e briefings ----------

def load_config():
    with open(PLANS_FILE) as f:
        return yaml.safe_load(f)


def parse_briefing(path, task_id):
    text = Path(path).read_text()
    phase_plan = None
    m = re.search(r"^\*\*Plano padrão:\*\*\s*`?([\w-]+)`?", text, re.M)
    if m:
        phase_plan = m.group(1)

    sections = re.split(r"^### ", text, flags=re.M)
    section = next((s for s in sections[1:] if s.split()[0] == task_id), None)
    if section is None:
        sys.exit(f"Tarefa {task_id} não encontrada em {path}")

    def field(name):
        fm = re.search(rf"^- \*\*{name}:\*\*\s*`?([^`\n]+?)`?\s*$", section, re.M)
        return fm.group(1).strip() if fm else None

    prompt = re.search(r"\*\*Prompt\*\*\s*```[^\n]*\n(.*?)```", section, re.S)
    review = re.search(r"^## Prompt de revisão.*?```[^\n]*\n(.*?)```", text, re.S | re.M)
    return {
        "id": task_id,
        "title": section.splitlines()[0].split("·", 1)[-1].strip(),
        "agent": field("Agente"),
        "branch": field("Branch"),
        "plan": field("Plano") or phase_plan,
        "prompt": prompt.group(1).strip() if prompt else None,
        "review_prompt": review.group(1).strip().replace("<número>", task_id) if review else None,
    }


# ---------- consumo ----------

def _pct(window):
    if not isinstance(window, dict):
        return None, None
    used = window.get("used_percentage", window.get("used_percent"))
    resets = window.get("resets_at")
    if isinstance(resets, str):
        try:
            from datetime import datetime
            resets = datetime.fromisoformat(resets.replace("Z", "+00:00")).timestamp()
        except ValueError:
            resets = None
    if resets is None and window.get("resets_in_seconds") is not None:
        resets = time.time() + float(window["resets_in_seconds"])
    # Janela já reiniciada desde a leitura: o uso voltou a zero.
    if resets is not None and resets < time.time():
        used = 0
    return used, resets


def claude_usage():
    path = STATE_DIR / "claude.json"
    if not path.exists():
        return {"source": "sem dados (nenhuma statusline gravada ainda)"}
    data = json.loads(path.read_text())
    rl = data.get("rate_limits") or {}
    five, five_reset = _pct(rl.get("five_hour"))
    week, week_reset = _pct(rl.get("seven_day"))
    return {
        "captured_at": data.get("captured_at"),
        "five_hour": five, "five_hour_resets": five_reset,
        "weekly": week, "weekly_resets": week_reset,
        "source": str(path),
    }


def exhausted():
    path = STATE_DIR / "exhausted.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {k: v for k, v in data.items() if v > time.time()}


def mark_exhausted(provider, until=None):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    data = exhausted()
    data[provider] = until or time.time() + DEFAULT_COOLDOWN
    (STATE_DIR / "exhausted.json").write_text(json.dumps(data))


def usage_all():
    return {"claude": claude_usage()}


def provider_ok(provider, usage, cfg):
    """Retorna (disponível, motivo)."""
    until = exhausted().get(provider)
    if until:
        return False, f"limite detectado no terminal, bloqueado até {_fmt_ts(until)}"
    u = usage.get(provider, {})
    if u.get("captured_at") and time.time() - u["captured_at"] > STALE_SECONDS:
        return True, "dado de consumo antigo, assumindo disponível"
    th = cfg["thresholds"]
    for slot in ("five_hour", "weekly"):
        val = u.get(slot)
        if val is not None and val >= th[slot]:
            return False, f"{slot} em {val:.0f}% (limiar {th[slot]}%)"
    if u.get("five_hour") is None and u.get("weekly") is None:
        return True, "sem dados de consumo, assumindo disponível"
    return True, f"5h {u.get('five_hour', '?')}% · semanal {u.get('weekly', '?')}%"


def _fmt_ts(ts):
    return time.strftime("%d/%m %H:%M", time.localtime(ts)) if ts else "?"


def _find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = _find_key(v, key)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_key(v, key)
            if r is not None:
                return r
    return None


# ---------- escolha do candidato ----------

def resolve_plan(task, args, cfg):
    name = args.plan or task.get("plan") or cfg["default_plan"]
    if name not in cfg["plans"]:
        sys.exit(f"Plano desconhecido: {name}. Opções: {', '.join(cfg['plans'])}")
    return name


def choose(cfg, plan, role, skip=()):
    chain = cfg["plans"][plan].get(role)
    if not chain:
        sys.exit(f"Papel {role} não definido no plano {plan}")
    usage = usage_all()
    report = []
    for i, cand in enumerate(chain):
        if i in skip:
            report.append((cand, False, "já tentado nesta execução"))
            continue
        ok, why = provider_ok(cand["agent"], usage, cfg)
        report.append((cand, ok, why))
        if ok:
            return i, cand, report
    return None, None, report


def print_report(plan, role, report):
    print(f"Plano: {plan} · papel: {role}")
    for cand, ok, why in report:
        mark = "✔" if ok else "✘"
        print(f"  {mark} {cand['agent']}/{cand['model']}·{cand['effort']}  ({why})")


# ---------- Orca ----------

def orca(*argv, dry=False):
    cmd = [ORCA, *argv, "--json"]
    if dry:
        print("  [dry-run]", " ".join(_quote(a) for a in cmd))
        return {}
    proc = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.exit(f"Falha no orca-ide ({proc.returncode}): {proc.stderr or proc.stdout}")
    if not data.get("ok", True):
        sys.exit(f"orca-ide retornou erro: {json.dumps(data.get('error', data), ensure_ascii=False)}")
    return data.get("result", data)


def _quote(a):
    return a if re.fullmatch(r"[\w:/.@=,-]+", a) else repr(a)


def terminal_handle(result):
    launch = result.get("launch") or {}
    handle = (launch.get("outcome") or {}).get("handle") or result.get("agentTerminalHandle")
    return handle or _find_key(result, "handle")


def build_prompt(role, cand, body, task_id=None):
    head = f"Atue como o agente `{role}` definido em .claude/agents/{role}.md"
    parts = [head + ".", body]
    if role == "code-reviewer":
        parts.insert(1, READ_ONLY_NOTE)
        if task_id:
            parts.append(LESSONS_REVIEW_NOTE.format(task=task_id))
    lessons = lessons_text(role)
    if lessons:
        parts.insert(1, "Lições de revisões anteriores (valem como regras do seu papel):\n\n" + lessons)
    return "\n\n".join(parts)


# ---------- lições de revisão ----------

def lessons_file(role):
    return LESSONS_DIR / f"{role}.md"


def lessons_text(role):
    f = lessons_file(role)
    if not f.exists():
        return ""
    lines = [re.sub(r"\s*<!-- key: [\w-]+ -->", "", l)
             for l in f.read_text().splitlines() if l.startswith("- ")]
    return "\n".join(lines)


def promoted_keys(role):
    f = lessons_file(role)
    return set(re.findall(r"<!-- key: ([\w-]+) -->", f.read_text())) if f.exists() else set()


def read_inbox():
    if not LESSONS_INBOX.exists():
        return []
    return [json.loads(l) for l in LESSONS_INBOX.read_text().splitlines() if l.strip()]


def group_inbox(role=None):
    """{(papel, key): {"tasks": {...}, "text": última redação}}"""
    groups = {}
    for e in read_inbox():
        if role and e["role"] != role:
            continue
        g = groups.setdefault((e["role"], e["key"]), {"tasks": set(), "text": e["text"]})
        g["tasks"].add(e["task"])
        g["text"] = e["text"]
    return groups


def promote(role, key, text, tasks):
    f = lessons_file(role)
    LESSONS_DIR.mkdir(parents=True, exist_ok=True)
    if not f.exists():
        f.write_text(f"# Lições de revisão · {role}\n\n"
                     "Promovidas automaticamente pelo `dispatch.py` quando o code-reviewer aponta o mesmo "
                     "padrão em tarefas diferentes. Entram no prompt do agente a cada lançamento. "
                     "Edite à vontade: junte, reescreva ou apague as que perderem o sentido.\n\n")
    origin = ", ".join(sorted(tasks))
    with open(f, "a") as fh:
        fh.write(f"- {text} _(revisões: {origin})_ <!-- key: {key} -->\n")
    n = len(lessons_text(role).splitlines())
    if n > LESSONS_SOFT_CAP:
        print(f"Atenção: {f.relative_to(ROOT)} tem {n} lições; vale consolidar.")


def apply_lessons(min_tasks=LESSON_MIN_TASKS, only_key=None):
    done = []
    for (role, key), g in sorted(group_inbox().items()):
        if key in promoted_keys(role):
            continue
        if only_key and key != only_key:
            continue
        if not only_key and len(g["tasks"]) < min_tasks:
            continue
        promote(role, key, g["text"], g["tasks"])
        done.append((role, key))
    for role, key in done:
        print(f"Lição promovida: {role} · {key} → {lessons_file(role).relative_to(ROOT)}")
    if only_key and not done:
        print(f"Nada promovido: key {only_key} não está na caixa ou já foi promovida.")
    return done


def cmd_lesson_add(args):
    if args.role not in LESSON_ROLES:
        sys.exit(f"Papel inválido: {args.role}. Opções: {', '.join(LESSON_ROLES)}")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", args.key):
        sys.exit("A key deve ser um slug em kebab-case (ex.: money-as-float).")
    text = " ".join(args.text.split())
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    entry = {"ts": time.time(), "task": args.task, "role": args.role, "key": args.key, "text": text}
    with open(LESSONS_INBOX, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    seen = len(group_inbox(args.role).get((args.role, args.key), {}).get("tasks", ()))
    print(f"Lição registrada: {args.role} · {args.key} (vista em {seen} tarefa(s)).")


def cmd_lessons(args):
    if args.promote:
        apply_lessons(only_key=args.promote)
        return
    if args.apply:
        if not apply_lessons():
            print(f"Nenhuma lição com {LESSON_MIN_TASKS}+ tarefas para promover.")
        return
    groups = group_inbox(args.role)
    roles = [args.role] if args.role else LESSON_ROLES
    for role in roles:
        promoted = promoted_keys(role)
        items = [(k, g) for (r, k), g in sorted(groups.items()) if r == role]
        if not items:
            continue
        print(f"## {role}")
        for key, g in items:
            mark = "promovida" if key in promoted else f"{len(g['tasks'])}/{LESSON_MIN_TASKS}"
            print(f"- [{mark}] {key}: {g['text']} (tarefas: {', '.join(sorted(g['tasks']))})")
    if not groups:
        print("Caixa de lições vazia.")


def log_dispatch(entry):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    entry["ts"] = time.time()
    with open(STATE_DIR / "dispatch-log.jsonl", "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def launch(task, role, cand, prompt, *, worktree=None, dry=False, retry_of=None):
    common = ["--agent", cand["agent"], "--model", cand["model"]]
    if cand["model"] != "haiku":  # o Orca recusa --effort no Haiku (qualquer nível)
        common += ["--effort", cand["effort"]]
    common += ["--surface", "terminal", "--prompt", prompt]
    if worktree:
        result = orca("agent", "launch", "--worktree", worktree, *common, dry=dry)
    else:
        cfg = load_config()
        result = orca("worktree", "create", "--repo", cfg["repo"], "--name", task["branch"],
                      "--no-parent", "--comment", f"{task['id']} · {task['title']} ({role})",
                      *common, dry=dry)
    handle = terminal_handle(result) if result else None
    if not worktree and result:
        wt = result.get("worktree") or {}
        wt_id = wt.get("id") or _find_key(result, "worktreeId")
        worktree = f"id:{wt_id}" if wt_id else None
    log_dispatch({"task": task["id"], "branch": task["branch"], "role": role, "candidate": cand,
                  "worktree": worktree, "terminal": handle, "retry_of": retry_of, "dry_run": dry})
    return handle, worktree


def task_worktree(task):
    """Worktree da tarefa: o id registrado na criação ou, sem registro, o caminho padrão do Orca."""
    log = STATE_DIR / "dispatch-log.jsonl"
    if log.exists():
        for line in reversed(log.read_text().splitlines()):
            e = json.loads(line)
            if e.get("branch") == task["branch"] and e.get("worktree") and not e.get("dry_run"):
                return e["worktree"]
    result = orca("worktree", "list")
    name = task["branch"].replace("/", "-")
    for w in result.get("worktrees", []):
        if w.get("branch", "").removeprefix("refs/heads/") in (task["branch"], name):
            return f"id:{w['id']}"
    sys.exit(f"Worktree do branch {task['branch']} não encontrado no Orca.")


# ---------- watch / fallback ----------

def watch(cfg, plan, role, task, handle, idx, prompt_body, worktree):
    tried = {idx}
    patterns = {k: [re.compile(p, re.I) for p in v] for k, v in cfg["limit_patterns"].items()}
    chain = cfg["plans"][plan][role]
    while True:
        cand = chain[idx]
        print(f"Acompanhando {handle} ({cand['agent']}/{cand['model']}) até ficar ocioso...")
        while True:
            proc = subprocess.run([ORCA, "terminal", "wait", "--terminal", handle, "--for", "tui-idle",
                                   "--timeout-ms", str(WATCH_IDLE_TIMEOUT_MS), "--json"],
                                  capture_output=True, text=True)
            try:
                code = (json.loads(proc.stdout).get("error") or {}).get("code")
            except json.JSONDecodeError:
                code = None
            # Timeout só quer dizer que o agente ainda está trabalhando.
            if code != "timeout":
                break
        tail = _find_key(orca("terminal", "read", "--terminal", handle), "tail") or ""
        if isinstance(tail, list):
            tail = "\n".join(map(str, tail))
        recent = tail[-4000:]
        hit = any(p.search(recent) for p in patterns.get(cand["agent"], []))
        if not hit:
            print("Agente ocioso sem sinal de limite: terminou ou aguarda resposta. Fim do acompanhamento.")
            if role == "code-reviewer":
                apply_lessons()
            return
        print(f"Limite de uso detectado em {cand['agent']}. Procurando fallback...")
        reset = (usage_all().get(cand["agent"]) or {}).get("five_hour_resets")
        mark_exhausted(cand["agent"], reset if reset and reset > time.time() else None)
        new_idx, new_cand, report = choose(cfg, plan, role, skip=tried)
        print_report(plan, role, report)
        if new_cand is None:
            print("Nenhum candidato disponível na cadeia. Retome manualmente quando o limite reiniciar.")
            return
        orca("terminal", "close", "--terminal", handle)
        resume = ("A sessão anterior desta tarefa parou por limite de uso. Antes de continuar, "
                  "rode `git status` e `git log main..HEAD` para ver o que já foi feito e retome "
                  "de onde parou.\n\nTarefa original:\n\n" + prompt_body)
        handle, _ = launch(task, role, new_cand, build_prompt(role, new_cand, resume, task["id"]),
                           worktree=worktree, retry_of=handle)
        tried.add(new_idx)
        idx = new_idx


# ---------- comandos ----------

def cmd_usage(_args):
    cfg = load_config()
    for provider, u in usage_all().items():
        ok, why = provider_ok(provider, {provider: u}, cfg)
        print(f"{provider:7} {'disponível' if ok else 'BLOQUEADO':11} {why}")
        if u.get("five_hour_resets") or u.get("weekly_resets"):
            print(f"        reinicia: 5h {_fmt_ts(u.get('five_hour_resets'))} · "
                  f"semanal {_fmt_ts(u.get('weekly_resets'))}")


def _prepare(args, review=False):
    cfg = load_config()
    task = parse_briefing(args.briefing, args.task)
    role = "code-reviewer" if review else task["agent"]
    body = task["review_prompt"] if review else task["prompt"]
    if not role or not body or not task["branch"]:
        sys.exit(f"Tarefa {task['id']} sem Agente, Branch ou Prompt no briefing.")
    plan = resolve_plan(task, args, cfg)
    return cfg, task, role, body, plan


def cmd_plan(args):
    cfg, task, role, _body, plan = _prepare(args, review=args.review)
    _i, _c, report = choose(cfg, plan, role)
    print(f"Tarefa {task['id']} · {task['title']}")
    print_report(plan, role, report)
    print(f"Sessão principal neste plano: {cfg['plans'][plan]['main'][0]}")


def _run(args, review):
    cfg, task, role, body, plan = _prepare(args, review=review)
    idx, cand, report = choose(cfg, plan, role)
    print(f"Tarefa {task['id']} · {task['title']}")
    print_report(plan, role, report)
    if cand is None:
        sys.exit("Nenhum candidato disponível: todos os provedores da cadeia estão acima do limiar.")
    worktree = task_worktree(task) if review and not args.dry_run else None
    if review and args.dry_run:
        worktree = f"<worktree de {task['branch']}>"
    handle, worktree = launch(task, role, cand, build_prompt(role, cand, body, task["id"]),
                              worktree=worktree, dry=args.dry_run)
    if args.dry_run:
        return
    print(f"Lançado: {cand['agent']}/{cand['model']}·{cand['effort']} · terminal {handle} · {worktree}")
    if args.watch and handle:
        watch(cfg, plan, role, task, handle, idx, body, worktree or task_worktree(task))


def cmd_watch(args):
    cfg = load_config()
    task = parse_briefing(args.briefing, args.task)
    role = args.role
    body = task["review_prompt"] if role == "code-reviewer" else task["prompt"]
    plan = resolve_plan(task, args, cfg)
    chain = cfg["plans"][plan][role]
    idx = args.index if args.index is not None else 0
    watch(cfg, plan, role, task, args.terminal, min(idx, len(chain) - 1), body, task_worktree(task))


def cmd_git(args):
    """Lança o git-operator num worktree existente (padrão: o do repositório principal)."""
    cfg = load_config()
    plan = args.plan or cfg["default_plan"]
    if plan not in cfg["plans"]:
        sys.exit(f"Plano desconhecido: {plan}. Opções: {', '.join(cfg['plans'])}")
    role = "git-operator"
    idx, cand, report = choose(cfg, plan, role)
    print_report(plan, role, report)
    if cand is None:
        sys.exit("Nenhum candidato disponível: todos os provedores da cadeia estão acima do limiar.")
    worktree = args.worktree or f"path:{ROOT}"
    task = {"id": "git", "title": args.instruction[:60], "branch": f"git:{worktree}"}
    prompt = build_prompt(role, cand, args.instruction)
    handle, _ = launch(task, role, cand, prompt, worktree=worktree, dry=args.dry_run)
    if args.dry_run:
        return
    print(f"Lançado: {cand['agent']}/{cand['model']}·{cand['effort']} · terminal {handle} · {worktree}")
    if args.watch and handle:
        watch(cfg, plan, role, task, handle, idx, args.instruction, worktree)


def main():
    # Sem isto, com stdout redirecionado o Python usa buffer de bloco e o log do --watch fica vazio.
    sys.stdout.reconfigure(line_buffering=True)
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("usage").set_defaults(fn=cmd_usage)

    def task_args(sp):
        sp.add_argument("briefing")
        sp.add_argument("task")
        sp.add_argument("--plan")

    sp = sub.add_parser("plan"); task_args(sp)
    sp.add_argument("--review", action="store_true"); sp.set_defaults(fn=cmd_plan)
    for name, review in (("run", False), ("review", True)):
        sp = sub.add_parser(name); task_args(sp)
        sp.add_argument("--watch", action="store_true")
        sp.add_argument("--dry-run", action="store_true")
        sp.set_defaults(fn=lambda a, r=review: _run(a, r))
    sp = sub.add_parser("watch"); task_args(sp)
    sp.add_argument("--terminal", required=True)
    sp.add_argument("--role", required=True)
    sp.add_argument("--index", type=int, help="posição do candidato atual na cadeia (padrão 0)")
    sp.set_defaults(fn=cmd_watch)

    sp = sub.add_parser("git")
    sp.add_argument("instruction", help="o que o git-operator deve fazer")
    sp.add_argument("--worktree", help="seletor do Orca (path:..., branch:..., id:...); padrão: repositório principal")
    sp.add_argument("--plan")
    sp.add_argument("--watch", action="store_true")
    sp.add_argument("--dry-run", action="store_true")
    sp.set_defaults(fn=cmd_git)

    sp = sub.add_parser("lesson", help="registra uma lição candidata (usado pelo code-reviewer)")
    lsub = sp.add_subparsers(dest="lesson_cmd", required=True)
    la = lsub.add_parser("add")
    la.add_argument("--role", required=True)
    la.add_argument("--key", required=True)
    la.add_argument("--task", required=True)
    la.add_argument("--text", required=True)
    la.set_defaults(fn=cmd_lesson_add)

    sp = sub.add_parser("lessons", help="lista a caixa de lições; --apply promove as repetidas")
    sp.add_argument("--role")
    sp.add_argument("--apply", action="store_true",
                    help=f"promove as lições vistas em {LESSON_MIN_TASKS}+ tarefas distintas")
    sp.add_argument("--promote", metavar="KEY", help="promove uma lição já na primeira ocorrência")
    sp.set_defaults(fn=cmd_lessons)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

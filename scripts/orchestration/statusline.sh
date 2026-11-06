#!/bin/sh
# Statusline do Claude Code: grava os rate_limits da assinatura para o dispatch
# (scripts/orchestration/dispatch.py) e repassa o payload ao statusline do Orca.
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/orca-plans"
payload=$(cat)

case "$payload" in
  *'"rate_limits"'*)
    mkdir -p "$state_dir"
    printf '%s' "$payload" | python3 -I -c '
import json, sys, time, os
data = json.load(sys.stdin)
out = {"captured_at": time.time(), "rate_limits": data.get("rate_limits")}
path = sys.argv[1]
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(out, f)
os.replace(tmp, path)
' "$state_dir/claude.json" 2>/dev/null || :
    ;;
esac

orca_statusline="$HOME/.orca/agent-hooks/claude-statusline.sh"
if [ -x "$orca_statusline" ]; then
  printf '%s' "$payload" | /bin/sh "$orca_statusline"
fi

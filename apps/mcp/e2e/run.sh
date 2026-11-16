#!/usr/bin/env bash
# E2E local do MCP: contêineres próprios (Postgres/PostGIS + Redis) em portas únicas, build, migração,
# seed de e2e e vitest. Não mexe no docker compose nem nos contêineres de outros worktrees.
# Uso (da raiz do repositório): apps/mcp/e2e/run.sh [argumentos do vitest, ex.: -t "cartão"]
# Variáveis: MCP_E2E_PG_PORT (55433), MCP_E2E_REDIS_PORT (56380), MCP_E2E_KEEP=1 (mantém os contêineres).
set -euo pipefail
cd "$(dirname "$0")/../../.."

PG_PORT="${MCP_E2E_PG_PORT:-55433}"
REDIS_PORT="${MCP_E2E_REDIS_PORT:-56380}"
SUFFIX="${MCP_E2E_NAME:-mcpqa}"
export MCP_E2E_DATABASE_URL="postgres://space_sports:space_sports@localhost:${PG_PORT}/space_sports_e2e"
export MCP_E2E_REDIS_URL="redis://localhost:${REDIS_PORT}"

cleanup() {
  if [ "${MCP_E2E_KEEP:-0}" != "1" ]; then
    docker rm -f "${SUFFIX}-pg" "${SUFFIX}-redis" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker rm -f "${SUFFIX}-pg" "${SUFFIX}-redis" >/dev/null 2>&1 || true
docker run -d --name "${SUFFIX}-pg" -e POSTGRES_USER=space_sports -e POSTGRES_PASSWORD=space_sports \
  -e POSTGRES_DB=space_sports_e2e -p "${PG_PORT}:5432" postgis/postgis:17-3.5 >/dev/null
docker run -d --name "${SUFFIX}-redis" -p "${REDIS_PORT}:6379" redis:7-alpine >/dev/null

pnpm --filter @space-sports/shared build
pnpm --filter @space-sports/api-client build
pnpm --filter @space-sports/api build
pnpm --filter @space-sports/mcp build

until docker exec "${SUFFIX}-pg" pg_isready -U space_sports -d space_sports_e2e >/dev/null 2>&1; do sleep 1; done
sleep 2
DATABASE_URL="$MCP_E2E_DATABASE_URL" pnpm --filter @space-sports/api db:migrate
(cd apps/api && DATABASE_URL="$MCP_E2E_DATABASE_URL" pnpm exec tsx test/e2e-seed/seed.ts)

pnpm --filter @space-sports/mcp test:e2e "$@"

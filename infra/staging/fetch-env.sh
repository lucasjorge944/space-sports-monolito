#!/usr/bin/env bash
# Grava env/<grupo>.env a partir dos parâmetros /space-sports/staging/<grupo>/<VARIÁVEL>. Assim uma
# variável nova não exige mudar este script. A pasta env/ é só do root, e cada arquivo tem permissão
# 600. Os valores não podem ter quebra de linha.
set -euo pipefail
cd "$(dirname "$0")"

PREFIX=/space-sports/staging

install -d -m 700 env
umask 077

fetch_group() {
  local group=$1 tmp
  tmp=$(mktemp env/.fetch.XXXXXX)
  aws ssm get-parameters-by-path --path "$PREFIX/$group" --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do
      if [ -n "$name" ] && [ "$name" != None ]; then printf '%s=%s\n' "${name##*/}" "$value"; fi
    done >"$tmp"
  mv "$tmp" "env/$group.env"
}

require() {
  grep -q "^$2=." "env/$1.env" || {
    echo "Falta o parâmetro $PREFIX/$1/$2 (infra/README.md)." >&2
    exit 1
  }
}

for group in api postgres seed; do fetch_group "$group"; done

require api DATABASE_URL
require api BETTER_AUTH_SECRET
require api ADS_DELIVERY_SECRET
require api PAYMENTS_DATA_KEY
require postgres POSTGRES_PASSWORD

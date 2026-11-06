#!/usr/bin/env bash
# Credenciais temporárias do papel de mídia (fotos no S3) para a API e o seed, sem chaves de acesso.
#
# Os contêineres não alcançam o serviço de metadados (limite de saltos 1, infra/README.md). Este
# script roda no host, assume o papel space-sports-staging-media com o papel da instância e grava as
# credenciais em aws/media.json, no formato do `credential_process`. O compose monta aws/ em /run/aws,
# e o SDK da API segue o aws/config: roda `cat` no arquivo sempre que as credenciais estão a menos de
# 5 minutos de expirar. Elas valem 1 hora, e o timer do systemd renova a cada 15 minutos.
#
# A montagem é da pasta, não do arquivo: o `mv` troca o arquivo, e a montagem de um arquivo ficaria
# presa na versão anterior.
#
#   media-credentials.sh           renova as credenciais
#   media-credentials.sh install   instala o serviço e o timer do systemd e renova (deploy.sh)
set -euo pipefail
cd "$(dirname "$0")"

ROLE_NAME=space-sports-staging-media
SESSION_DURATION=3600
SERVICE=space-sports-media-credentials
export AWS_DEFAULT_REGION=sa-east-1

# Se o assume-role falhar, o arquivo anterior fica, e o temporário some.
tmp=
trap '[ -z "$tmp" ] || rm -f -- "$tmp"' EXIT

refresh() {
  local account
  install -d -m 755 aws
  # O caminho é o de dentro do contêiner. Só a API lê esta pasta, como o usuário node.
  printf '[default]\ncredential_process = cat /run/aws/media.json\n' >aws/config
  chmod 644 aws/config

  account=$(aws sts get-caller-identity --query Account --output text)
  tmp=$(mktemp aws/.media.XXXXXX)
  aws sts assume-role --role-arn "arn:aws:iam::$account:role/$ROLE_NAME" \
    --role-session-name space-sports-staging-api --duration-seconds "$SESSION_DURATION" \
    --query '{Version: `1`, AccessKeyId: Credentials.AccessKeyId, SecretAccessKey: Credentials.SecretAccessKey, SessionToken: Credentials.SessionToken, Expiration: Credentials.Expiration}' \
    --output json >"$tmp"
  grep -Eq '"SessionToken": *"[^"]+"' "$tmp" || {
    echo "Resposta inesperada do sts assume-role para $ROLE_NAME." >&2
    exit 1
  }
  chmod 644 "$tmp"
  mv "$tmp" aws/media.json
}

# No boot, roda antes do Docker: as credenciais da véspera já expiraram quando a API sobe.
install_units() {
  local units=${SYSTEMD_DIR:-/etc/systemd/system}
  cat >"$units/$SERVICE.service" <<UNIT
[Unit]
Description=Space Sports: credenciais do papel de midia para a API
Wants=network-online.target
After=network-online.target
Before=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/bash $PWD/media-credentials.sh
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
UNIT
  cat >"$units/$SERVICE.timer" <<UNIT
[Unit]
Description=Space Sports: renova as credenciais do papel de midia

[Timer]
OnBootSec=15min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable "$SERVICE.service" "$SERVICE.timer"
  systemctl start "$SERVICE.timer"
}

case ${1:-refresh} in
refresh) refresh ;;
install)
  install_units
  refresh
  ;;
*)
  echo "Uso: $0 [refresh|install]" >&2
  exit 2
  ;;
esac

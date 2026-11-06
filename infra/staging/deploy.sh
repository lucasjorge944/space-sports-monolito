#!/usr/bin/env bash
# Aplica uma versão no servidor. O deploy-staging.yml extrai esta pasta em /opt/space-sports e chama
# este script por SSM Run Command (infra/scripts/apply-staging.sh):
#   deploy.sh <registro do ECR> <tag do commit> <tag do postgres>
#
# Qualquer falha para o deploy. As migrações rodam antes da troca: se falharem, API e web seguem na
# versão anterior.
set -euo pipefail
cd "$(dirname "$0")"

export ECR_REGISTRY=$1 IMAGE_TAG=$2 POSTGRES_IMAGE_TAG=$3

# Ex.: 123456789012.dkr.ecr.sa-east-1.amazonaws.com
AWS_DEFAULT_REGION=${ECR_REGISTRY#*.dkr.ecr.}
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION%%.*}

# Um deploy logo depois da criação da instância espera o bootstrap terminar. Saída 2 é erro
# recuperável do cloud-init, que não impede o deploy.
cloud-init status --wait >/dev/null || [ $? -eq 2 ] || {
  echo 'O bootstrap da instância falhou: veja /var/log/cloud-init-output.log.' >&2
  exit 1
}

bash fetch-env.sh
# Fotos: credenciais temporárias do papel de mídia para a API. Sem elas, só o upload de fotos falha,
# então o deploy segue com um aviso. O timer tenta de novo a cada 15 minutos.
bash media-credentials.sh install ||
  echo 'Aviso: sem credenciais do papel de mídia, o upload de fotos vai falhar (infra/README.md).' >&2

aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker compose pull --quiet

docker compose up --detach --wait --wait-timeout 120 postgres redis
docker compose run --rm -T migrate
docker compose up --detach --wait --wait-timeout 180 api web
# Recria para ler o Caddyfile novo. Os certificados ficam no volume.
docker compose up --detach --force-recreate caddy

# Só depois do sucesso: um `docker compose` manual, e o próximo boot, usam a versão que ficou no ar.
cat >.env <<RELEASE
ECR_REGISTRY=$ECR_REGISTRY
IMAGE_TAG=$IMAGE_TAG
POSTGRES_IMAGE_TAG=$POSTGRES_IMAGE_TAG
RELEASE

# O disco tem 20 GB, e voltar a uma versão anterior é um novo deploy a partir do ECR.
docker image prune --all --force
docker compose ps

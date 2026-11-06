#!/usr/bin/env bash
# Passo final do deploy-staging.yml: envia infra/staging para a instância e roda o deploy.sh por SSM
# Run Command, acompanhando até o fim. Precisa de INSTANCE_ID, ECR_REGISTRY, IMAGE_TAG e
# POSTGRES_IMAGE_TAG, e roda na raiz do repositório.
set -euo pipefail

# Pull, migrações e healthchecks, numa máquina pequena.
EXECUTION_TIMEOUT=1200

bundle=$(tar -C infra/staging -czf - compose.yml Caddyfile deploy.sh fetch-env.sh media-credentials.sh |
  base64 -w0)
parameters=$(jq -n \
  --arg bundle "$bundle" \
  --arg deploy "bash deploy.sh '$ECR_REGISTRY' '$IMAGE_TAG' '$POSTGRES_IMAGE_TAG'" \
  --arg timeout "$EXECUTION_TIMEOUT" \
  '{
    commands: [
      "set -euo pipefail",
      "cd /opt/space-sports",
      ("printf %s " + ($bundle | @sh) + " | base64 -d | tar -xzf - --no-same-owner"),
      $deploy
    ],
    executionTimeout: [$timeout]
  }')

command_id=$(aws ssm send-command --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "deploy $IMAGE_TAG" \
  --timeout-seconds 180 --parameters "$parameters" --query Command.CommandId --output text)
echo "Comando $command_id enviado para $INSTANCE_ID."

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

# `aws ssm wait command-executed` desiste em 100 segundos, menos do que um deploy leva.
status=Pending
deadline=$((SECONDS + EXECUTION_TIMEOUT + 240))
while [ "$SECONDS" -lt "$deadline" ]; do
  sleep 10
  if ! status=$(aws ssm get-command-invocation --command-id "$command_id" \
    --instance-id "$INSTANCE_ID" --query Status --output text 2>"$errors"); then
    # Logo depois do envio, a invocação ainda não existe. Qualquer outro erro é real.
    if ! grep -q InvocationDoesNotExist "$errors"; then
      cat "$errors" >&2
      echo "::error::Sem acompanhar o comando $command_id, que pode seguir rodando no servidor."
      exit 1
    fi
    status=Pending
  fi
  case $status in
  Pending | InProgress | Delayed | Cancelling) ;;
  *) break ;;
  esac
done

invocation() {
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
    --query "$1" --output text
}
invocation StandardOutputContent
invocation StandardErrorContent >&2

if [ "$status" != Success ]; then
  echo "::error::O deploy terminou com o estado $status."
  exit 1
fi

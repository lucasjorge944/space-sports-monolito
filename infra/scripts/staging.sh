#!/usr/bin/env bash
# Liga, desliga e mostra o estado da instância de staging. O disco e o Elastic IP continuam cobrados
# com ela desligada, mas a instância não. Use um perfil da conta-membro: AWS_PROFILE=<perfil>.
set -euo pipefail

export AWS_REGION=${AWS_REGION:-sa-east-1}
INSTANCE_NAME=space-sports-staging

find_instance() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
    "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output text
}

found=$(find_instance)
if [ -z "$found" ]; then
  account=$(aws sts get-caller-identity --query Account --output text)
  echo "Instância $INSTANCE_NAME não encontrada na conta $account, região $AWS_REGION." >&2
  exit 1
fi
read -r instance_id state <<<"$found"

case ${1:-} in
start)
  aws ec2 start-instances --instance-ids "$instance_id" >/dev/null
  aws ec2 wait instance-running --instance-ids "$instance_id"
  echo "Instância $instance_id ligada. Os contêineres sobem sozinhos em cerca de 1 minuto."
  echo "Commits do main feitos com ela desligada não foram aplicados. Para aplicar:"
  echo "  gh workflow run deploy-staging.yml --repo Space-Sports-Apps/mobile-web --ref main"
  ;;
stop)
  aws ec2 stop-instances --instance-ids "$instance_id" >/dev/null
  aws ec2 wait instance-stopped --instance-ids "$instance_id"
  echo "Instância $instance_id desligada."
  ;;
status)
  echo "$instance_id $state"
  ;;
*)
  echo "Uso: $0 start|stop|status" >&2
  exit 2
  ;;
esac

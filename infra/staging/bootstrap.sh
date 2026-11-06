#!/bin/bash
# User data da instância: roda uma vez, como root, no primeiro boot da Amazon Linux 2023. Alterar
# este arquivo não reaplica nada em uma instância que já existe (`infra/README.md`).
set -euxo pipefail

# Antes de tudo: o Run Command entra nesta pasta (`infra/scripts/apply-staging.sh`), e é o deploy.sh,
# de lá, que espera este script terminar. Se ela só existisse no fim, um deploy feito durante o
# bootstrap falharia no `cd`, sem chegar à espera.
install -d -m 750 /opt/space-sports

# A AL2023 não traz o plugin do Compose. Na troca de versão, atualize o checksum:
#   curl -fsSL https://github.com/docker/compose/releases/download/<versão>/docker-compose-linux-aarch64.sha256
COMPOSE_VERSION=v2.40.3
COMPOSE_SHA256=d26373b19e89160546d15407516cc59f453030d9bc5b43ba7faf16f7b4980137

# O Elastic IP é associado logo depois da criação, e a troca de IP derruba o que estiver baixando.
retry() {
  for _ in 1 2 3 4 5; do
    if "$@"; then return 0; fi
    sleep 15
  done
  return 1
}

# 2 GB de swap: o limite de memória dos contêineres soma 1,5 GB em uma máquina de 2 GB. A condição
# permite rodar o script de novo, à mão, se o primeiro boot falhar (`infra/README.md`).
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# overcommit: recomendação do Redis, para o fork da reescrita do AOF não falhar.
cat > /etc/sysctl.d/90-space-sports.conf <<'SYSCTL'
vm.swappiness=10
vm.overcommit_memory=1
SYSCTL
sysctl --system

retry dnf install -y docker
systemctl enable --now docker

retry curl -fsSL -o /tmp/docker-compose \
  "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-aarch64"
echo "${COMPOSE_SHA256}  /tmp/docker-compose" | sha256sum --check
install -D -m 755 /tmp/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
rm /tmp/docker-compose
docker compose version

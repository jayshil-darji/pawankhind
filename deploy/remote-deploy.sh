#!/bin/bash
set -euo pipefail
export HOME=/root

# Expects IMAGE and COMPOSE_B64 to be set by the caller.
REGISTRY="${IMAGE%%/*}"
cd /opt/pawankhind

echo "$COMPOSE_B64" | base64 -d > compose.yaml.new
mv compose.yaml.new compose.yaml

aws ecr get-login-password --region ap-southeast-2 \
  | docker login --username AWS --password-stdin "$REGISTRY"

sed -i '/^REGISTRATION_IMAGE=/d' .env
echo "REGISTRATION_IMAGE=$IMAGE" >> .env

docker compose config --quiet
docker compose pull registration
docker compose up -d --remove-orphans

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/health/ready > /dev/null; then
    echo "ready after $i checks: $IMAGE"
    exit 0
  fi
  sleep 2
done

echo "service did not become ready"
docker compose ps
docker compose logs --tail=50 registration
exit 1
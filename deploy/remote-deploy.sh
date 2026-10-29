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

# Secrets come from SSM Parameter Store via the instance role. Nothing passes through GitHub.
PARAMS_TMP=$(mktemp)
trap 'rm -f "$PARAMS_TMP"' EXIT
aws ssm get-parameters-by-path --region ap-southeast-2 \
  --path /pawankhind/dev/ --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text \
  | while IFS=$'\t' read -r name value; do
      printf '%s=%s\n' "${name##*/}" "$value"
    done > "$PARAMS_TMP"
[ "$(wc -l < "$PARAMS_TMP")" -ge 3 ] || { echo "expected 3 parameters from SSM"; exit 1; }
sed -i '/^RAZORPAY_/d' .env
cat "$PARAMS_TMP" >> .env
chmod 600 .env

docker compose config --quiet
docker compose pull registration
docker compose up -d --wait --wait-timeout 120 postgres redis
docker compose run --rm --no-deps registration \
  node ./node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m migrations
docker compose up -d --remove-orphans

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/health/ready > /dev/null; then
    echo "ready after $i checks: $IMAGE"
    exit 0
  fi
  sleep 2
done

echo "service did not become ready"
docker compose ps
docker compose logs --tail=50 registration
exit 1
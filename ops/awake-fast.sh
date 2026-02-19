#!/usr/bin/env bash
set -euo pipefail

# Quick wake wrapper:
# - Starts/restores EC2 services using fast lease-start path
# - Prints tested dashboard URL at the end
#
# Usage:
#   ./ops/awake-fast.sh
#   LEASE_MINUTES=240 ./ops/awake-fast.sh
#   STRICT_HEALTH_CHECK=1 ./ops/awake-fast.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LEASE_MINUTES="${LEASE_MINUTES:-240}"
STRICT_HEALTH_CHECK="${STRICT_HEALTH_CHECK:-0}"

LEASE_MINUTES="${LEASE_MINUTES}" STRICT_HEALTH_CHECK="${STRICT_HEALTH_CHECK}" ./ops/ec2-lease-start.sh

if [[ -f /tmp/bristlecone_deploy_vars ]]; then
  # shellcheck disable=SC1091
  source /tmp/bristlecone_deploy_vars
fi

PUBLIC_URL="${PUBLIC_URL:-}"
if [[ -n "${PUBLIC_URL}" ]]; then
  HTTP_CODE="$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "${PUBLIC_URL}" || true)"
  echo "URL: ${PUBLIC_URL}/?tab=dashboard"
  echo "HTTP: ${HTTP_CODE:-000}"
fi

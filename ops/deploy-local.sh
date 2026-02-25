#!/usr/bin/env bash
set -euo pipefail

# Local production-like deploy path that mirrors EC2 build artifacts:
# - install deps
# - prisma generate + push
# - next build
# Optional:
# - start app (RUN_SERVER=1)
#
# Usage:
#   ./ops/deploy-local.sh
#   SKIP_INSTALL=1 ./ops/deploy-local.sh
#   RUN_SERVER=1 ./ops/deploy-local.sh
#   EXTRA_ENV_FILE=/path/to/server.env ./ops/deploy-local.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
RUN_SERVER="${RUN_SERVER:-0}"
EXTRA_ENV_FILE="${EXTRA_ENV_FILE:-}"

cd "${ROOT_DIR}"

if [[ -f /etc/bristlecone/app.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/bristlecone/app.env
  set +a
fi

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

if [[ -n "${EXTRA_ENV_FILE}" ]]; then
  if [[ ! -f "${EXTRA_ENV_FILE}" ]]; then
    echo "EXTRA_ENV_FILE does not exist: ${EXTRA_ENV_FILE}"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "${EXTRA_ENV_FILE}"
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-file:${ROOT_DIR}/prisma/.runtime/interviewbot.db}"
mkdir -p ./prisma/.runtime ./prisma/prisma/.runtime

corepack pnpm --version >/dev/null

if [[ "${SKIP_INSTALL}" != "1" ]]; then
  corepack pnpm install --frozen-lockfile
else
  echo "Skipping dependency install (SKIP_INSTALL=1)."
fi

corepack pnpm prisma:generate
corepack pnpm prisma:push
corepack pnpm build

echo "Local deploy artifacts built successfully."
echo "DATABASE_URL=${DATABASE_URL}"

if [[ "${RUN_SERVER}" == "1" ]]; then
  exec corepack pnpm start
fi

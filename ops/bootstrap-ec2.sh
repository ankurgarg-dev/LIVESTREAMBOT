#!/usr/bin/env bash
set -euo pipefail

# One-time EC2 bootstrap:
# - installs base tools (git, curl, jq, node, pnpm when missing)
# - clones repo to /opt/bristlecone-app
# - installs systemd units + env files
# - enables app service (agent stays disabled by default)

if [[ -f /tmp/bristlecone_deploy_vars ]]; then
  # shellcheck disable=SC1091
  source /tmp/bristlecone_deploy_vars
fi

INSTANCE_ID="${INSTANCE_ID:-${EC2_INSTANCE_ID:-}}"
AWS_REGION="${AWS_REGION:-us-east-1}"
REPO_URL="${REPO_URL:-https://github.com/ankurgarg-dev/LIVESTREAMBOT.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/bristlecone-app}"

if [[ -z "${INSTANCE_ID}" ]]; then
  echo "INSTANCE_ID (or EC2_INSTANCE_ID) is required."
  exit 1
fi

echo "Using instance: ${INSTANCE_ID}"
echo "Using region:   ${AWS_REGION}"
echo "Repo:           ${REPO_URL}"
echo "Branch:         ${DEPLOY_BRANCH}"

REMOTE_SCRIPT=$(cat <<'SCRIPT'
set -e
APP_DIR="__APP_DIR__"
REPO_URL="__REPO_URL__"
BRANCH="__DEPLOY_BRANCH__"

install_base() {
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y git curl jq ca-certificates nodejs npm
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git jq ca-certificates nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y git jq ca-certificates nodejs npm
  fi
}

install_base

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable || true
    corepack prepare pnpm@10.18.2 --activate || true
  fi
fi
if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm
fi

if [ ! -d "$APP_DIR/.git" ]; then
  if [ -d "$APP_DIR" ]; then
    sudo mv "$APP_DIR" "${APP_DIR}.bak.$(date +%s)"
  fi
  sudo git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

sudo mkdir -p /etc/bristlecone
if [ ! -f /etc/bristlecone/app.env ]; then
  sudo cp "$APP_DIR/ops/templates/app.env.example" /etc/bristlecone/app.env
fi
if [ ! -f /etc/bristlecone/agent.env ]; then
  sudo cp "$APP_DIR/ops/templates/agent.env.example" /etc/bristlecone/agent.env
fi

sudo cp "$APP_DIR/ops/templates/bristlecone-app.service" /etc/systemd/system/bristlecone-app.service
sudo cp "$APP_DIR/ops/templates/bristlecone-agent.service" /etc/systemd/system/bristlecone-agent.service

sudo systemctl daemon-reload
sudo systemctl enable bristlecone-app.service
sudo systemctl disable bristlecone-agent.service || true

echo "Bootstrap completed."
SCRIPT
)

REMOTE_SCRIPT="${REMOTE_SCRIPT//__APP_DIR__/${APP_DIR}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__REPO_URL__/${REPO_URL}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__DEPLOY_BRANCH__/${DEPLOY_BRANCH}}"

COMMAND_ID="$(aws ssm send-command \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --region "${AWS_REGION}" \
  --query "Command.CommandId" \
  --output text \
  --parameters commands="$(jq -nc --arg script "${REMOTE_SCRIPT}" '$script | split("\n")')")"

echo "CommandId: ${COMMAND_ID}"

aws ssm wait command-executed \
  --command-id "${COMMAND_ID}" \
  --instance-id "${INSTANCE_ID}" \
  --region "${AWS_REGION}"

aws ssm get-command-invocation \
  --command-id "${COMMAND_ID}" \
  --instance-id "${INSTANCE_ID}" \
  --region "${AWS_REGION}" \
  --query '{Status:Status,StdOut:StandardOutputContent,StdErr:StandardErrorContent}' \
  --output json

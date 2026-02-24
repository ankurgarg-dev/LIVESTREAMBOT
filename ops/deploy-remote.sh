#!/usr/bin/env bash
set -euo pipefail

# Deploys latest code to EC2 via SSM, where EC2 pulls from git and builds locally.
# Defaults to app-only restart; enable agent restart with DEPLOY_ENABLE_AGENT=1.

if [[ -f /tmp/bristlecone_deploy_vars ]]; then
  # shellcheck disable=SC1091
  source /tmp/bristlecone_deploy_vars
fi

INSTANCE_ID="${INSTANCE_ID:-${EC2_INSTANCE_ID:-}}"
AWS_REGION="${AWS_REGION:-us-east-1}"
REPO_URL="${REPO_URL:-https://github.com/ankurgarg-dev/LIVESTREAMBOT.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/bristlecone-app}"
DEPLOY_ENABLE_AGENT="${DEPLOY_ENABLE_AGENT:-0}"

if [[ -z "${INSTANCE_ID}" ]]; then
  echo "INSTANCE_ID (or EC2_INSTANCE_ID) is required."
  exit 1
fi

echo "Using instance: ${INSTANCE_ID}"
echo "Using region:   ${AWS_REGION}"
echo "Repo:           ${REPO_URL}"
echo "Branch:         ${DEPLOY_BRANCH}"

aws sts get-caller-identity --region "${AWS_REGION}" >/dev/null

STATE="$(aws ec2 describe-instances \
  --instance-ids "${INSTANCE_ID}" \
  --region "${AWS_REGION}" \
  --query "Reservations[0].Instances[0].State.Name" \
  --output text)"

if [[ "${STATE}" != "running" ]]; then
  echo "Starting instance ${INSTANCE_ID}..."
  aws ec2 start-instances --instance-ids "${INSTANCE_ID}" --region "${AWS_REGION}" >/dev/null
  aws ec2 wait instance-running --instance-ids "${INSTANCE_ID}" --region "${AWS_REGION}"
fi

echo "Waiting for SSM Online..."
for _ in $(seq 1 36); do
  PING="$(aws ssm describe-instance-information \
    --region "${AWS_REGION}" \
    --query "InstanceInformationList[?InstanceId=='${INSTANCE_ID}'].PingStatus | [0]" \
    --output text)"
  if [[ "${PING}" == "Online" ]]; then
    break
  fi
  sleep 5
done

PING="$(aws ssm describe-instance-information \
  --region "${AWS_REGION}" \
  --query "InstanceInformationList[?InstanceId=='${INSTANCE_ID}'].PingStatus | [0]" \
  --output text)"

if [[ "${PING}" != "Online" ]]; then
  echo "SSM is not Online for ${INSTANCE_ID}."
  exit 1
fi

REMOTE_SCRIPT=$(cat <<'SCRIPT'
set -e
APP_DIR="__APP_DIR__"
REPO_URL="__REPO_URL__"
BRANCH="__DEPLOY_BRANCH__"
ENABLE_AGENT="__DEPLOY_ENABLE_AGENT__"

if [ ! -d "$APP_DIR/.git" ]; then
  if [ -d "$APP_DIR" ]; then
    mv "$APP_DIR" "${APP_DIR}.bak.$(date +%s)"
  fi
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git remote set-url origin "$REPO_URL"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable || true
    corepack prepare pnpm@10.18.2 --activate || true
  fi
fi
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm
fi

pnpm --version
pnpm install --frozen-lockfile
export DATABASE_URL="${DATABASE_URL:-file:./prisma/.runtime/interviewbot.db}"
mkdir -p ./prisma/.runtime
pnpm prisma:generate
pnpm prisma:push
pnpm build

sudo systemctl restart bristlecone-app.service
sleep 2
sudo systemctl is-active bristlecone-app.service

if [ "$ENABLE_AGENT" = "1" ]; then
  sudo systemctl restart bristlecone-agent.service
  sudo systemctl is-active bristlecone-agent.service
fi

git rev-parse --short HEAD
cat .next/BUILD_ID
SCRIPT
)

REMOTE_SCRIPT="${REMOTE_SCRIPT//__APP_DIR__/${APP_DIR}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__REPO_URL__/${REPO_URL}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__DEPLOY_BRANCH__/${DEPLOY_BRANCH}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__DEPLOY_ENABLE_AGENT__/${DEPLOY_ENABLE_AGENT}}"

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

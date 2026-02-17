#!/usr/bin/env bash
set -euo pipefail

# Shows EC2 status and, if running, checks auto-stop timer/service state via SSM.

if [[ -f /tmp/bristlecone_deploy_vars ]]; then
  # shellcheck disable=SC1091
  source /tmp/bristlecone_deploy_vars
fi

INSTANCE_ID="${INSTANCE_ID:-${EC2_INSTANCE_ID:-}}"

if [[ -z "${INSTANCE_ID}" ]]; then
  echo "INSTANCE_ID (or EC2_INSTANCE_ID) is required."
  exit 1
fi

STATE="$(aws ec2 describe-instances \
  --instance-ids "${INSTANCE_ID}" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text)"

echo "Instance ${INSTANCE_ID}: ${STATE}"

if [[ "${STATE}" != "running" ]]; then
  exit 0
fi

COMMAND_ID="$(aws ssm send-command \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --query "Command.CommandId" \
  --output text \
  --parameters "commands=[
    \"set -e\",
    \"echo === timer ===\",
    \"sudo systemctl status bristlecone-auto-stop.timer --no-pager || true\",
    \"echo === service ===\",
    \"sudo systemctl status bristlecone-auto-stop.service --no-pager || true\",
    \"echo === disk ===\",
    \"df -h /\"
  ]")"

aws ssm wait command-executed --command-id "${COMMAND_ID}" --instance-id "${INSTANCE_ID}"
aws ssm get-command-invocation \
  --command-id "${COMMAND_ID}" \
  --instance-id "${INSTANCE_ID}" \
  --query '{Status:Status,StdOut:StandardOutputContent,StdErr:StandardErrorContent}' \
  --output json

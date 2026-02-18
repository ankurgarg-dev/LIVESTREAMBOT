#!/usr/bin/env bash
set -euo pipefail

# Extends/renews the EC2 auto-stop lease without a full restart.
# Defaults to a 240-minute extension.

if [[ -f /tmp/bristlecone_deploy_vars ]]; then
  # shellcheck disable=SC1091
  source /tmp/bristlecone_deploy_vars
fi

INSTANCE_ID="${INSTANCE_ID:-${EC2_INSTANCE_ID:-}}"
LEASE_MINUTES="${LEASE_MINUTES:-240}"

if [[ -z "${INSTANCE_ID}" ]]; then
  echo "INSTANCE_ID (or EC2_INSTANCE_ID) is required."
  exit 1
fi

if ! [[ "${LEASE_MINUTES}" =~ ^[0-9]+$ ]] || [[ "${LEASE_MINUTES}" -lt 15 ]]; then
  echo "LEASE_MINUTES must be an integer >= 15."
  exit 1
fi

STATE="$(aws ec2 describe-instances \
  --instance-ids "${INSTANCE_ID}" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text)"

if [[ "${STATE}" != "running" ]]; then
  echo "Instance ${INSTANCE_ID} is ${STATE}. Start it first with ops/ec2-lease-start.sh."
  exit 1
fi

COMMAND_ID="$(aws ssm send-command \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --query "Command.CommandId" \
  --output text \
  --parameters "commands=[
    \"set -e\",
    \"sudo systemctl stop bristlecone-auto-stop.timer bristlecone-auto-stop.service || true\",
    \"sudo systemd-run --unit bristlecone-auto-stop --on-active=${LEASE_MINUTES}m /usr/bin/systemctl poweroff\",
    \"sudo systemctl list-timers --all | grep bristlecone-auto-stop || true\"
  ]")"

aws ssm wait command-executed --command-id "${COMMAND_ID}" --instance-id "${INSTANCE_ID}"
aws ssm get-command-invocation \
  --command-id "${COMMAND_ID}" \
  --instance-id "${INSTANCE_ID}" \
  --query '{Status:Status,StdOut:StandardOutputContent,StdErr:StandardErrorContent}' \
  --output json

echo "Lease extended by ${LEASE_MINUTES} minutes."

#!/usr/bin/env bash
set -euo pipefail

# Starts EC2, restores app/agent services, and arms an auto-stop timer.
# Defaults to a 120-minute lease.

if [[ -f /tmp/bristlecone_deploy_vars ]]; then
  # shellcheck disable=SC1091
  source /tmp/bristlecone_deploy_vars
fi

INSTANCE_ID="${INSTANCE_ID:-${EC2_INSTANCE_ID:-}}"
LEASE_MINUTES="${LEASE_MINUTES:-120}"

if [[ -z "${INSTANCE_ID}" ]]; then
  echo "INSTANCE_ID (or EC2_INSTANCE_ID) is required."
  exit 1
fi

echo "Starting instance: ${INSTANCE_ID}"
aws ec2 modify-instance-attribute \
  --instance-id "${INSTANCE_ID}" \
  --instance-initiated-shutdown-behavior Value=stop >/dev/null
aws ec2 start-instances --instance-ids "${INSTANCE_ID}" >/dev/null
aws ec2 wait instance-status-ok --instance-ids "${INSTANCE_ID}"
echo "Instance is healthy. Arming ${LEASE_MINUTES}m auto-stop timer and restoring services..."

COMMAND_ID="$(aws ssm send-command \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --query "Command.CommandId" \
  --output text \
  --parameters "commands=[
    \"set -e\",
    \"cd /opt/bristlecone-app\",
    \"sudo systemctl restart bristlecone-app.service\",
    \"sudo systemctl restart bristlecone-agent.service\",
    \"sudo systemctl is-active bristlecone-app.service\",
    \"sudo systemctl is-active bristlecone-agent.service\",
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

echo "Restore complete. Auto-stop lease is active."

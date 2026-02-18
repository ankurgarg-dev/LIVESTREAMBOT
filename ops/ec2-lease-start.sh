#!/usr/bin/env bash
set -euo pipefail

# Starts EC2, restores app/agent services, and arms an auto-stop timer.
# Defaults to a 240-minute lease.

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

retry() {
  local attempts="${1:-5}"
  shift
  local n=1
  until "$@"; do
    if [[ "${n}" -ge "${attempts}" ]]; then
      return 1
    fi
    sleep $((n * 2))
    n=$((n + 1))
  done
}

echo "Starting instance: ${INSTANCE_ID}"
aws ec2 modify-instance-attribute \
  --instance-id "${INSTANCE_ID}" \
  --instance-initiated-shutdown-behavior Value=stop >/dev/null
aws ec2 start-instances --instance-ids "${INSTANCE_ID}" >/dev/null
aws ec2 wait instance-status-ok --instance-ids "${INSTANCE_ID}"
echo "Instance is healthy. Waiting for SSM registration..."

for _ in {1..30}; do
  if aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=${INSTANCE_ID}" \
    --query "InstanceInformationList[0].PingStatus" \
    --output text 2>/dev/null | grep -q "Online"; then
    break
  fi
  sleep 5
done

SSM_PING="$(aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=${INSTANCE_ID}" \
  --query "InstanceInformationList[0].PingStatus" \
  --output text 2>/dev/null || true)"
if [[ "${SSM_PING}" != "Online" ]]; then
  echo "SSM is not Online for ${INSTANCE_ID}. Try again in a minute."
  exit 1
fi

echo "Arming ${LEASE_MINUTES}m auto-stop timer and restoring services..."

COMMAND_ID="$(retry 4 aws ssm send-command \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --query "Command.CommandId" \
  --output text \
  --parameters "commands=[
    \"set -e\",
    \"cd /opt/bristlecone-app\",
    \"sudo systemctl restart livekit-server || true\",
    \"sudo systemctl restart caddy || true\",
    \"sudo systemctl restart bristlecone-app.service\",
    \"sudo systemctl restart bristlecone-agent.service\",
    \"sudo systemctl is-active livekit-server || true\",
    \"sudo systemctl is-active caddy || true\",
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

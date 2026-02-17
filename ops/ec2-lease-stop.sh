#!/usr/bin/env bash
set -euo pipefail

# Stops the EC2 instance immediately.

if [[ -f /tmp/bristlecone_deploy_vars ]]; then
  # shellcheck disable=SC1091
  source /tmp/bristlecone_deploy_vars
fi

INSTANCE_ID="${INSTANCE_ID:-${EC2_INSTANCE_ID:-}}"

if [[ -z "${INSTANCE_ID}" ]]; then
  echo "INSTANCE_ID (or EC2_INSTANCE_ID) is required."
  exit 1
fi

echo "Stopping instance: ${INSTANCE_ID}"
aws ec2 stop-instances --instance-ids "${INSTANCE_ID}" >/dev/null
aws ec2 wait instance-stopped --instance-ids "${INSTANCE_ID}"
echo "Instance stopped."

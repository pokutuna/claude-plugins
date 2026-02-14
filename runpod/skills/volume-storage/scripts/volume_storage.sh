#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper around `aws s3` for RunPod Network Volume.
# Injects --endpoint-url, --region, --profile from runpod.toml.

usage() {
  echo "Usage: $(basename "$0") [--config <path>] <aws-s3-subcommand> [args...]"
  echo ""
  echo "Examples:"
  echo "  $(basename "$0") ls s3://VOLUME_ID/"
  echo "  $(basename "$0") cp s3://VOLUME_ID/file.json ./file.json"
  exit 1
}

CONFIG_PATH="./runpod.toml"

if [[ "${1:-}" == "--config" ]]; then
  CONFIG_PATH="${2:-}"
  shift 2
fi

if [[ $# -lt 1 ]]; then
  usage
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Error: Config file not found: $CONFIG_PATH" >&2
  exit 1
fi

DATACENTER_ID="$(CONFIG_PATH="$CONFIG_PATH" python -c "
import tomllib, sys, os
with open(os.environ['CONFIG_PATH'], 'rb') as f:
    c = tomllib.load(f)
v = c.get('pod', {}).get('datacenter_id', '')
if not v:
    print('Error: datacenter_id not found in ' + os.environ['CONFIG_PATH'], file=sys.stderr)
    sys.exit(1)
print(v)
")"

if ! command -v aws &>/dev/null; then
  echo "Error: aws CLI not found" >&2
  exit 1
fi

ENDPOINT_URL="https://s3api-$(echo "$DATACENTER_ID" | tr '[:upper:]' '[:lower:]').runpod.io/"

exec aws s3 "$@" \
  --endpoint-url "$ENDPOINT_URL" \
  --region "$DATACENTER_ID" \
  --profile "${AWS_PROFILE:-runpod}"

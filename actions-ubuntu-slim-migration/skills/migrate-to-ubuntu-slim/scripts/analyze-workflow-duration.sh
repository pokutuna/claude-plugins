#!/bin/bash
# Analyze workflow run times and calculate eligibility for ubuntu-slim migration
# Usage: ./analyze-workflow-duration.sh <workflow-file> [--repo <owner/repo>] [--limit <n>]

set -euo pipefail

WORKFLOW_FILE=""
REPO=""
LIMIT=50

while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)
      REPO="--repo $2"
      shift 2
      ;;
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    *)
      WORKFLOW_FILE="$1"
      shift
      ;;
  esac
done

if [[ -z "$WORKFLOW_FILE" ]]; then
  echo "Usage: $0 <workflow-file> [--repo <owner/repo>] [--limit <n>]" >&2
  exit 1
fi

WORKFLOW_NAME=$(basename "$WORKFLOW_FILE")

gh run list $REPO --workflow="$WORKFLOW_NAME" --limit="$LIMIT" --json conclusion,startedAt,updatedAt | jq -r --arg workflow "$WORKFLOW_NAME" '
  [.[] | select(.conclusion == "success")] |
  map((.updatedAt | fromdateiso8601) - (.startedAt | fromdateiso8601)) |
  if length == 0 then
    "\($workflow)\t-\t-\t-\t-\t-\tNo successful runs found"
  else
    . as $durations |
    (length) as $n |
    (add / $n) as $mean |
    (if $n > 1 then (map(. - $mean | . * .) | add / ($n - 1) | sqrt) else 0 end) as $stddev |
    ($mean + 2 * $stddev) as $two_sigma |
    if $two_sigma < 420 then
      "\($workflow)\t\($n)\t\($mean | floor)s\t\($stddev | floor)s\t\($two_sigma | floor)s\tyes\tRuntime OK (mean+2σ=\($two_sigma | floor)s < 420s)"
    else
      "\($workflow)\t\($n)\t\($mean | floor)s\t\($stddev | floor)s\t\($two_sigma | floor)s\tno\tRuntime too long (mean+2σ=\($two_sigma | floor)s >= 420s)"
    end
  end
'

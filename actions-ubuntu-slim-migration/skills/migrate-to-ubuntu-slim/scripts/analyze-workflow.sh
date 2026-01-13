#!/bin/bash
# Analyze workflow run times and calculate eligibility for ubuntu-slim migration
# Usage: ./analyze-workflow.sh <workflow-name> [--repo <owner/repo>] [--limit <n>]

set -euo pipefail

WORKFLOW=""
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
      WORKFLOW="$1"
      shift
      ;;
  esac
done

if [[ -z "$WORKFLOW" ]]; then
  echo "Usage: $0 <workflow-name> [--repo <owner/repo>] [--limit <n>]" >&2
  exit 1
fi

gh run list $REPO --workflow="$WORKFLOW" --limit="$LIMIT" --json conclusion,startedAt,updatedAt | jq -r --arg workflow "$WORKFLOW" '
  [.[] | select(.conclusion == "success")] |
  map((.updatedAt | fromdateiso8601) - (.startedAt | fromdateiso8601)) |
  if length == 0 then
    "\($workflow)\tNo successful runs\t-\t-\t-\t-"
  else
    . as $durations |
    (length) as $n |
    (add / $n) as $mean |
    (if $n > 1 then (map(. - $mean | . * .) | add / ($n - 1) | sqrt) else 0 end) as $stddev |
    ($mean + 2 * $stddev) as $two_sigma |
    "\($workflow)\t\($n)\t\($mean | floor)s\t\($stddev | floor)s\t\($two_sigma | floor)s\t\($two_sigma < 420)"
  end
'

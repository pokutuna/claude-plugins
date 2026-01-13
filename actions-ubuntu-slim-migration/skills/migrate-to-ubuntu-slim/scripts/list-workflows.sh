#!/bin/bash
# List workflows with ubuntu-latest runners
# Usage: ./list-workflows.sh [--repo <owner/repo>]

set -euo pipefail

REPO=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)
      REPO="--repo $2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

gh workflow list $REPO --json name,state | jq -r '.[] | select(.state == "active") | .name'

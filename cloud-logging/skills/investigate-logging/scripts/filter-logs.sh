#!/bin/bash
# filter-logs.sh - Apply jq filter to Cloud Logging JSON
# Usage: gcloud logging read 'FILTER' --format json | filter-logs.sh <filter-file>

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <filter-file.jq>" >&2
    exit 1
fi

jq -f "$1"

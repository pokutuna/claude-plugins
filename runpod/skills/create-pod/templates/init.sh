#!/bin/bash
# RunPod init script - runs on SSH connect (via create_pod.py --ssh)
# Customize for your project.
#
# This script runs interactively (output is visible).
# The pod's default startup command is NOT affected.
#
# Initialization flag: skips re-init on subsequent SSH connections.
# To re-initialize: rm /workspace/.initialized
set -euo pipefail

INIT_FLAG="/workspace/.initialized"

if [ -f "$INIT_FLAG" ]; then
  echo "Already initialized."
  exit 0
fi

echo "=== Initializing ==="

# --- Git credentials (requires gh CLI and GITHUB_TOKEN) ---
# gh auth setup-git
# gh api user --jq '.login' | xargs git config user.name
# gh api user --jq '.email' | xargs git config user.email

# --- Sync repository ---
# git fetch
# git reset --hard origin/main

# --- Install dependencies ---
# uv sync

# --- Project-specific setup ---
# Add your initialization steps here

touch "$INIT_FLAG"
echo "=== Done ==="

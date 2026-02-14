---
name: create-pod
description: |
  Create RunPod GPU pod instances from runpod.toml.
  Use when user mentions "create pod", "launch gpu pod", "runpod ssh",
  "pod 立てて", "pod 作成", "runpod 起動".
metadata:
  author: pokutuna
  version: 0.1.0
allowed-tools: "Bash(uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/scripts/create_pod.py:*)"
---

# RunPod Pod Creation

Create RunPod GPU pod instances from a `runpod.toml` configuration file.

## Prerequisites

- `runpodctl` CLI installed and configured (`~/.runpod/config.toml`)

## Setup

```bash
cp ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/templates/runpod.toml ./runpod.toml
mkdir -p scripts/runpod
cp ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/templates/init.sh ./scripts/runpod/init.sh
```

Edit `runpod.toml` with your settings. Register secrets at https://console.runpod.io/user/secrets and reference them as `{{ RUNPOD_SECRET_XXX }}` in `[env]`.

## Usage

```bash
uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/scripts/create_pod.py                   # Create a pod
uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/scripts/create_pod.py --ssh             # Create and SSH connect
uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/scripts/create_pod.py --dry-run         # Show command only
uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/scripts/create_pod.py -c other.toml     # Use a different config
uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/create-pod/scripts/create_pod.py --gpu "RTX 5090"  # Override GPU type
```

See `--help` for all options. See `runpod.toml` template for all config fields.

## Important

Pods incur costs while running. If creation or SSH connection fails, confirm with the user and stop the pod (`runpodctl stop pod <pod_id>`).

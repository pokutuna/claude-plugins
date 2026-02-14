---
name: volume-storage
description: |
  Manage files on RunPod Network Volume via S3-compatible API.
  Use when user mentions "volume storage", "network volume", "upload to volume",
  "download from volume", "volume ls", "volume files", "ボリューム", "ストレージ".
metadata:
  author: pokutuna
  version: 0.1.0
allowed-tools: "Bash(${CLAUDE_PLUGIN_ROOT}/skills/volume-storage/scripts/volume_storage.sh:*)"
---

# RunPod Volume Storage

Manage files on RunPod Network Volume via `aws s3`.

## Prerequisites

- `aws` CLI with `[profile runpod]` in `~/.aws/config`
- `runpod.toml` with `datacenter_id` and `network_volume_id`

## Usage

Build `s3://` paths using `network_volume_id` from `runpod.toml`. Pod's `/workspace/` maps to `s3://VOLUME_ID/`.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/volume-storage/scripts/volume_storage.sh ls s3://VOLUME_ID/
${CLAUDE_PLUGIN_ROOT}/skills/volume-storage/scripts/volume_storage.sh cp s3://VOLUME_ID/data/file.json ./file.json
${CLAUDE_PLUGIN_ROOT}/skills/volume-storage/scripts/volume_storage.sh sync ./output/ s3://VOLUME_ID/output/
```

All `aws s3` subcommands and options are passed through.

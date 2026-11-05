#!/usr/bin/env bash
# List the models the installed Codex CLI can use, one per line (tab-separated):
#   <slug>  default=<effort>  efforts=<supported,efforts>  <description>
# Hidden models are omitted. Order follows Codex's own priority (newest first).
# stdin is closed because codex subcommands may otherwise wait on it.
set -euo pipefail

codex debug models </dev/null 2>/dev/null | jq -r '
  .models[]
  | select(.visibility == "list")
  | [
      .slug,
      "default=" + .default_reasoning_level,
      "efforts=" + ([.supported_reasoning_levels[].effort] | join(",")),
      .description
    ]
  | @tsv'

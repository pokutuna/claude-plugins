# pokutuna-plugins

Claude Code plugins by pokutuna.

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add https://github.com/pokutuna/claude-plugins
```

Then install plugins:

```
/plugin install <plugin-name>@pokutuna-plugins
```

## Recommendation

Install plugins with **user scope** (default), then enable per-project via `<project>/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "runpod@pokutuna-plugins": true
  }
}
```

Project-scoped installation has known bugs that prevent installing the same plugin to multiple projects:
- [#14202](https://github.com/anthropics/claude-code/issues/14202) - Project-scoped plugins incorrectly detected as installed globally
- [#20593](https://github.com/anthropics/claude-code/issues/20593) - Plugin install matches wrong marketplace when same plugin name exists in multiple marketplaces

## Plugins

| Plugin | Description |
|--------|-------------|
| [allow-until](./allow-until/) | Time-limited auto-approval mode for Claude Code sessions |
| [actions-ubuntu-slim-migration](./actions-ubuntu-slim-migration/) | Analyze and migrate GitHub Actions to ubuntu-slim for cost reduction |
| [cloud-logging](./cloud-logging/) | Investigate Google Cloud Logging with gcloud/jq/duckdb |
| [vertexai-gemini-batch](./vertexai-gemini-batch/) | Run Vertex AI Batch Prediction for Gemini (50% OFF) |
| [hydra-experiment](./hydra-experiment/) | Guide Hydra-based ML experiment management |
| [runpod](./runpod/) | RunPod GPU cloud management - check GPU availability, upload models |
| [uv-features](./uv-features/) | Recommend lesser-known uv features (PEP 723, uvx, uv run --with, etc.) |

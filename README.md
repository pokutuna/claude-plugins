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
| [side-fork](./side-fork/) | Fork session and open original in a new tmux pane (new pane = experimental branch) |
| [kaggle-helper](./kaggle-helper/) | Kaggle discussion and notebook analysis for competition research |
| [things-app](./things-app/) | Read and update tasks in Things 3 via JXA |
| [toggle-plugin](./toggle-plugin/) | Toggle plugins enabled/disabled per project |
| [github-copilot](./github-copilot/) | GitHub Copilot CLI integration — second AI opinion and PR review requests |
| [codex](./codex/) | OpenAI Codex CLI integration for autonomous second opinions and code review |
| [octave-notification](./octave-notification/) | Musical scale notification sounds per tmux window (3 octaves, 21 notes) |
| [zoom](./zoom/) | Extract transcripts from Zoom recording share pages via Playwright |
| [pushover-notify](./pushover-notify/) | Send Pushover push notifications when Claude needs attention (display-aware on macOS) |
| [difit](./difit/) | Round-trip code review with difit — preload AI comments, pick up human replies via HTTP API |
| [limit-usage](./limit-usage/) | Stop tool execution before you exhaust your Claude rate limit (zero metering cost, reads from statusLine) |
| [jupyter](./jupyter/) | Run local notebooks on a remote Jupyter Server's kernel (GPU) via jupyter-mcp-server (SSH tunnel support) |
| [google-style-guide](./google-style-guide/) | Write or fix developer docs following the Google developer documentation style guide (en/ja skills) |
| [x-research](./x-research/) | Research X (Twitter) via the xAI Grok API x_search tool and answer with citation-verified quotes and links |
| [runbook](./runbook/) | Create and review runbooks that run top to bottom without judgment from whoever executes them |
| [docgen](./docgen/) | Write text deliverables — Japanese writing conventions, explanatory structure, and a single-file HTML design system |
| [progressive-outlining](./progressive-outlining/) | Progressive Outlining (Andrew Ng) — refine an outline stage by stage before writing prose or a design doc, with the user or a critic SubAgent |

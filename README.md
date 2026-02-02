# pokutuna-plugins

Claude Code plugins by pokutuna.

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add https://github.com/pokutuna/claude-marketplace
```

Then install plugins:

```
/plugin install <plugin-name>@pokutuna-plugins
```

## Plugins

### actions-ubuntu-slim-migration

Analyze and migrate GitHub Actions workflows from `ubuntu-latest` to `ubuntu-slim` for cost optimization.

**Usage:** `migrate to ubuntu-slim`

**Features:**
- Analyzes workflow runtime statistics (mean, stddev, mean+2σ)
- Checks for incompatible patterns (Docker services, heavy builds, JVM)
- Creates migration plan with eligibility reasoning
- Applies changes after user confirmation

[Details](./actions-ubuntu-slim-migration/README.md)

### cloud-logging

Investigate Google Cloud Logging with efficient context management.

**Usage:** `ログ調査`, `investigate logs`, `analyze Cloud Logging`

**Features:**
- Workflow for log existence check and structure discovery
- Query optimization with indexed fields
- File-based analysis with jq and duckdb
- Pre-built jq filters for common analysis patterns

### vertexai-gemini-batch

Run Vertex AI batch prediction for Gemini models with 50% cost reduction.

**Usage:** `create Gemini batch request`, `run Vertex AI batch API`

**Features:**
- JSONL input file generation with type-safe SDK helpers
- CLI script for batch job management (create, wait, status)
- Structured output with JSON schema support
- Cost-effective batch processing (50% OFF)

---

More plugins coming soon.

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

---

More plugins coming soon.

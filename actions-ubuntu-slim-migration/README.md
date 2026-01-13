# github-actions-ubuntu-slim

A Claude Code plugin to analyze and migrate GitHub Actions workflows from `ubuntu-latest` to `ubuntu-slim` for cost optimization.

## Features

- Analyzes `.github/workflows/` to find jobs using `ubuntu-latest`
- Fetches workflow run history via `gh` CLI to calculate average run times
- Identifies jobs eligible for migration (< 10 min average runtime)
- Presents a clear migration plan with reasoning
- Applies changes after user confirmation
- Shows diff and prompts for commit (does not auto-commit)

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Repository with GitHub Actions workflows

## Usage

Ask Claude to migrate your workflows:

```
migrate to ubuntu-slim
```

Claude will:
1. Scan your workflow files
2. Analyze run time history (past 30 days)
3. Present eligible jobs for migration
4. Wait for your confirmation
5. Apply changes and show diff
6. Prompt you to commit

## About ubuntu-slim

`ubuntu-slim` is a lightweight GitHub-hosted runner:

| Spec | ubuntu-slim | ubuntu-latest |
|------|-------------|---------------|
| CPU | 1 | 4 |
| Memory | 5 GB | 16 GB |
| Timeout | 15 min | 6 hours |

Best for: linting, formatting, simple tests, notifications, automations.

## Installation

Add this plugin via the Claude Code marketplace:

```
/plugin install github-actions-ubuntu-slim@pokutuna-plugins
```

## License

MIT

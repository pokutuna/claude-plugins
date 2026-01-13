---
name: migrate-to-ubuntu-slim
description: This skill should be used when the user asks to "migrate to ubuntu-slim".
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Migrate GitHub Actions to ubuntu-slim

Analyze GitHub Actions workflows and migrate eligible jobs from `ubuntu-latest` to `ubuntu-slim` for cost optimization.

## About ubuntu-slim

`ubuntu-slim` is a lightweight, single-CPU GitHub-hosted runner optimized for lightweight operations:

| Specification | ubuntu-slim | ubuntu-latest |
|--------------|-------------|---------------|
| CPU          | 1           | 4             |
| Memory       | 5 GB        | 16 GB         |
| Storage      | 14 GB       | 14 GB         |
| Timeout      | **15 min**  | 6 hours       |
| Cost (public)| Free        | Free          |

Best suited for: automation tasks, issue operations, short-running jobs, linting, simple tests.

## Migration Workflow

### Step 1: Discover Workflows

Search for workflow files in the repository:

```bash
ls -la .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null
```

Read each workflow file to understand its structure and identify jobs using `ubuntu-latest`.

### Step 2: Analyze Run Times

Use `gh` CLI to get workflow run history for the past 30 days:

```bash
# List workflow runs with timing
gh run list --workflow=<workflow-file> --limit=30 --json databaseId,conclusion,updatedAt,createdAt

# Get detailed timing for specific run
gh run view <run-id> --json jobs
```

Calculate average run time for each job. Only jobs with average run time **under 10 minutes** are candidates for migration.

### Step 3: Evaluate Eligibility

A job is eligible for ubuntu-slim if ALL conditions are met:

**Include if:**
- Average run time < 10 minutes (with margin for 15-minute timeout)
- Simple operations: linting, formatting, type checking, unit tests, deployments

**Exclude if:**
- Uses `services:` (Docker service containers)
- Uses `container:` (custom container image)
- Requires significant memory (build processes, large test suites)
- Has `matrix:` strategy with many combinations
- Runs Docker builds or heavy compilation
- Has variable run times that occasionally exceed 10 minutes

### Step 4: Present Migration Plan

Before making changes, present a clear summary to the user:

```
## Migration Plan

### Eligible for ubuntu-slim:
| Workflow | Job | Avg Time | Reason |
|----------|-----|----------|--------|
| ci.yml   | lint | 2m 30s  | Simple linting, fast execution |
| ci.yml   | test | 8m 45s  | Unit tests only, within limit |

### Not eligible:
| Workflow | Job | Reason |
|----------|-----|--------|
| ci.yml   | build | Uses services: postgres |
| deploy.yml | e2e | Average time 18 minutes |

Proceed with migration? (y/n)
```

Wait for user confirmation before proceeding.

### Step 5: Apply Changes

After user confirmation, edit workflow files to replace `ubuntu-latest` with `ubuntu-slim`:

```yaml
# Before
jobs:
  lint:
    runs-on: ubuntu-latest

# After
jobs:
  lint:
    runs-on: ubuntu-slim
```

Use the Edit tool to make precise replacements.

### Step 6: Show Diff and Prompt Commit

After making changes:

1. Show the diff using `git diff`
2. Remind the user to review and commit the changes
3. **Do NOT commit automatically** - let the user decide

```bash
git diff .github/workflows/
```

Suggest commit message:
```
chore(ci): migrate eligible jobs to ubuntu-slim runner

Migrated the following jobs to ubuntu-slim for cost optimization:
- ci.yml: lint, test
- deploy.yml: notify

These jobs have average run times under 10 minutes and don't require
the full resources of ubuntu-latest.
```

## Important Notes

- Always verify run time data before recommending migration
- Consider peak run times, not just averages - jobs with high variance may exceed 15-minute limit
- Some actions may not work correctly on ubuntu-slim due to reduced resources
- Recommend starting with non-critical workflows (linting, notifications) before migrating build/test jobs

## Reference

- [GitHub Docs: GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- ubuntu-slim runs as a container, not a full VM
- Available for both public and private repositories

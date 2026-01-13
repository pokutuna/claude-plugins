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

### Phase 1: Create Plan

First, discover all workflows and create a task list.

1. List workflow files:
```bash
ls .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null
```

2. Create a todo list with tasks:
   - "Analyze workflow: <workflow-name>" for each workflow file found
   - "Present migration plan"
   - "Apply changes (after user confirmation)"
   - "Show diff and prompt commit"

### Phase 2: Analyze Each Workflow

For each workflow, perform TWO checks:

#### Check 1: Runtime Statistics

Run the analysis script:
```bash
${CLAUDE_PLUGIN_ROOT}/skills/migrate-to-ubuntu-slim/scripts/analyze-workflow.sh <workflow-name>
```

Output: `workflow	n	mean	stddev	mean+2σ	eligible`

**Criteria**: mean + 2σ < 420 seconds (7 minutes). This allows 2x slowdown on ubuntu-slim (1 CPU vs 4 CPU) while staying under 15-minute timeout.

#### Check 2: Implementation Patterns

Read the workflow YAML and check for incompatible patterns.

**Reject if ANY found:**

| Pattern | Reason |
|---------|--------|
| `services:` | Docker service containers not supported |
| `container:` | Custom container images may not work |
| `docker build`, `docker-compose` | CPU/memory heavy |
| `cargo build`, `go build`, `make -j` | Heavy compilation too slow on 1 CPU |
| `npm run build`, `webpack`, `tsc --build` | Frontend builds may be slow |
| `java`, `gradle`, `maven`, `mvn` | JVM needs more memory |
| Large `matrix:` strategy | May overwhelm resources |

**Good candidates:**
- Linting (`eslint`, `ruff`, `golangci-lint`)
- Formatting checks (`prettier`, `black`)
- Simple unit tests
- Notifications, issue/PR operations

#### Result

Mark workflow as:
- **Eligible**: Runtime OK AND no blocking patterns
- **Not eligible**: Explain reason (runtime or pattern)

Update todo: mark "Analyze workflow: <name>" as completed.

### Phase 3: Present Migration Plan

After analyzing all workflows, present summary:

```
## Migration Plan

### Eligible:
| Workflow | mean+2σ | Note |
|----------|---------|------|
| test.yml | 198s | Simple pytest |
| lint.yml | 51s | ruff check |

### Not eligible:
| Workflow | Reason |
|----------|--------|
| build.yml | Uses services: postgres |
| e2e.yml | mean+2σ=920s exceeds limit |
```

Ask user: "Proceed with migration?"

### Phase 4: Apply Changes

After user confirmation, edit each eligible workflow file:

```yaml
# Before
runs-on: ubuntu-latest

# After
runs-on: ubuntu-slim
```

Update todo as each file is edited.

### Phase 5: Show Diff and Prompt Commit

1. Show diff:
```bash
git diff .github/workflows/
```

2. Suggest commit message:
```
chore(ci): migrate eligible jobs to ubuntu-slim runner
```

3. **Do NOT commit** - let user decide.

## Important Notes

- Always verify run time data before recommending migration
- Consider peak run times, not just averages - jobs with high variance may exceed 15-minute limit
- Some actions may not work correctly on ubuntu-slim due to reduced resources
- Recommend starting with non-critical workflows (linting, notifications) before migrating build/test jobs

## Reference

- [GitHub Docs: GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- ubuntu-slim runs as a container, not a full VM
- Available for both public and private repositories

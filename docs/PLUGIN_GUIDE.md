# Plugin Development Guide

## Directory Structure

```
<plugin-name>/
├── .claude-plugin/
│   └── plugin.json            # Plugin manifest
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md           # Skill definition
│       └── scripts/
│           ├── example.py     # Python script (PEP 723)
│           ├── example.ts     # TypeScript script
│           └── example.sh     # Shell script
├── commands/
│   └── <command-name>.md      # Slash commands
├── agents/
│   └── <agent-name>.md        # Agent definitions
└── hooks/
    └── <hook-name>.md         # Hook definitions
```

Naming convention: kebab-case (e.g., `my-plugin-name`)

## plugin.json

```json
{
  "name": "<plugin-name>",
  "version": "0.1.0",
  "description": "Plugin description",
  "author": "Author name",
  "keywords": ["keyword1", "keyword2"]
}
```

## Scripts

Reference from SKILL.md: `${CLAUDE_PLUGIN_ROOT}/skills/<skill-name>/scripts/example.py`

### Python (PEP 723)

Use PEP 723 format for dependencies, run with `uv run --script`:
https://docs.astral.sh/uv/guides/scripts/

```python
#!/usr/bin/env -S uv run --script
#
# /// script
# dependencies = ["requests"]
# ///
#
```

### TypeScript (deno / bun)

```typescript
#!/usr/bin/env -S deno run --allow-read --allow-net
```

```typescript
#!/usr/bin/env bun
```

### Shell (bash)

```bash
#!/usr/bin/env bash
```

Use [checkbashisms](https://manpages.debian.org/testing/devscripts/checkbashisms.1.en.html) to verify bash-specific syntax if portability is a concern.

## References

- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Agent Skills API Documentation](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [anthropics/skills](https://github.com/anthropics/skills) - Official skills repository
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) - Official plugins repository
- [Agent Skills Specification](https://agentskills.io)

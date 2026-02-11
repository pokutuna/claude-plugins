---
name: allow-until
description: Enable time-limited auto-approval mode
allowed-tools:
  - Bash(CLAUDE_SESSION_ID=* ${CLAUDE_PLUGIN_ROOT}/bin/allow-until.sh *)
---
Controls the time-limited auto-approval mode.

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

Run: `CLAUDE_SESSION_ID=${CLAUDE_SESSION_ID} ${CLAUDE_PLUGIN_ROOT}/bin/allow-until.sh <subcommand>`

Subcommand mapping:
- Empty or "enable" -> `enable 10`
- "enable N" or number only -> `enable N`
- "disable" or "off" -> `disable`
- "status" -> `status`
- "test-pattern <command>" -> `test-pattern <command>`

Report the result to the user.

Note: `SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS` env var overrides default patterns (semicolon-separated). Use `status` to see active patterns.

# allow-until

Time-limited auto-approval mode for Bash commands in Claude Code.

## Overview

This plugin provides a way to temporarily bypass permission prompts for Bash commands while still blocking dangerous operations. Useful when you want Claude to work autonomously for a limited time.

## Features

- **Time-limited approval**: Enable auto-approval for a specified duration (default: 10 minutes)
- **Safety first**: Dangerous commands (rm -rf, force push, etc.) always require confirmation
- **Customizable patterns**: Override default blocked patterns via environment variable
- **Pattern testing**: Verify which commands are blocked with `test-pattern`
- **Session-scoped**: Settings are isolated per Claude Code session
- **Simple commands**: Enable, disable, or check status with `/allow-until`

## Usage

### Enable auto-approval

```
/allow-until enable      # Enable for 10 minutes (default)
/allow-until enable 30   # Enable for 30 minutes
/allow-until 5           # Enable for 5 minutes
```

### Disable auto-approval

```
/allow-until disable
/allow-until off
```

### Check status

```
/allow-until status
```

### Test a command against forbidden patterns

```
/allow-until test-pattern "rm -rf /tmp/foo"
/allow-until test-pattern "git push --force origin main"
```

## Blocked Commands

The following patterns are always blocked and will require manual approval:

- `rm -rf`, `rm -fr`, `rm -r -f`, etc. - Recursive forced deletion
- `mkfs`, `dd if=` - Filesystem destruction
- `| sh`, `| bash` - Remote code execution via pipe
- `git push --force`, `git push -f` - Force push
- `git reset --hard` - Hard reset
- `git clean -f` - Force clean

## Configuration

### Custom Forbidden Patterns

You can override the default blocked patterns by setting the `SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS` environment variable. Patterns are separated by semicolons (`;`) and use bash regex syntax.

When set, the environment variable **completely replaces** the default patterns. When unset, the defaults listed in [Blocked Commands](#blocked-commands) are used.

### Setting Methods

#### Claude Code settings (recommended)

Set in `.claude/settings.json` or `.claude/settings.local.json`:

```json
{
  "env": {
    "SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS": "rm .*-(r.*f|f.*r|rf|fr);mkfs;dd if=;git push.*(--force| -f( |$))"
  }
}
```

#### Shell environment variable

```bash
export SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS="rm .*-(r.*f|f.*r|rf|fr);mkfs;dd if=;git push.*(--force| -f( |$))"
```

### Priority

Settings are applied in the following order (highest priority first):

1. `settings.json` / `settings.local.json` `env` - overrides shell environment variables
2. Shell environment variable (`export`)
3. Default patterns (built-in)

Use `/allow-until status` to see which patterns are currently active.

## Installation

Add to your Claude Code settings:

```json
{
  "enabledPlugins": {
    "allow-until@your-marketplace": true
  }
}
```

## How it works

1. The plugin registers a `PreToolUse` hook for Bash commands
2. When `/allow-until enable` is called, it stores an expiration timestamp
3. Before each Bash command, the hook checks:
   - Is auto-approval enabled and not expired?
   - Is the command safe (not in the blocked list)?
4. If both conditions are met, the command is auto-approved

Session state is stored in `${XDG_STATE_HOME:-~/.local/state}/claude-allow-until.conf` using git-config format.

# allow-until

Time-limited auto-approval mode for Bash commands in Claude Code.

## Overview

This plugin provides a way to temporarily bypass permission prompts for Bash commands while still blocking dangerous operations. Useful when you want Claude to work autonomously for a limited time.

## Features

- **Time-limited approval**: Enable auto-approval for a specified duration (default: 10 minutes)
- **Safety first**: Dangerous commands (sudo, rm -rf, force push, etc.) always require confirmation
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

## Blocked Commands

The following patterns are always blocked and will require manual approval:

- `rm -rf`, `rm -fr` - Recursive forced deletion
- `mkfs`, `dd if=` - Filesystem destruction
- `| sh`, `| bash` - Remote code execution via pipe
- `git push --force`, `git push -f` - Force push
- `git reset --hard` - Hard reset
- `git clean -f` - Force clean

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

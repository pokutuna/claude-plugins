---
name: side-fork
description: Fork the current Claude session into a new herdr workspace or tab, or a new tmux or screen window.
argument-hint: "[tab]"
allowed-tools: "Bash(${CLAUDE_PLUGIN_ROOT}/bin/side-fork.sh *)"
disable-model-invocation: true
---
# side-fork

Fork the current session into a new terminal window. Unlike the built-in `/branch` (which replaces the current terminal with the fork), this keeps the current terminal as the original session and opens the fork in a new window.

## Instructions

Run the following command:

```
${CLAUDE_PLUGIN_ROOT}/bin/side-fork.sh ${CLAUDE_SESSION_ID}
```

If the user passed `tab` or `--tab` as the argument, append `--tab` to the command. Under herdr this opens the fork in a new tab of the current workspace instead of a new workspace.

On success, tell the user:
- The forked session has been opened (in a new herdr workspace or tab, or a new tmux or screen window)
- This terminal continues as the original session

## Supported Terminals

- **herdr**: Opens a new workspace (`herdr workspace create`), or a new tab in the current workspace with `--tab` (`herdr tab create`)
- **tmux**: Opens a new window (`tmux new-window`)
- **screen**: Opens a new window (`screen -X screen`)

herdr takes precedence when it runs inside tmux. tmux and screen ignore `--tab`.

## Examples

- `/side-fork`: under herdr, fork into a new workspace. Under tmux or screen, fork into a new window
- `/side-fork tab`: under herdr, fork into a new tab of the current workspace

## Troubleshooting

### "unsupported terminal"

The script only supports herdr, tmux, and screen. If you're using another terminal, run the fork manually:

```
claude --resume <session_id> --fork-session
```

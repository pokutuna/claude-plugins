# side-fork

Fork the current Claude Code session and open the fork in a new herdr workspace or tab, or a new tmux or screen window.

## What it does

Type `/side-fork` in a Claude Code session running inside herdr, tmux, or screen:

- **This terminal** continues as the original session (main line)
- **New workspace, tab, or window** opens with the forked session

Unlike the built-in `/branch` (formerly `/fork`, which replaces the current terminal with the fork), `side-fork` keeps this terminal as the original and opens the fork in a new window.

| Terminal | `/side-fork` | `/side-fork tab` |
|----------|--------------|------------------|
| herdr | New workspace | New tab in the current workspace |
| tmux | New window | New window |
| screen | New window | New window |

When herdr runs inside tmux, herdr is used.

## Requirements

- [herdr](https://herdr.dev/), [tmux](https://github.com/tmux/tmux), or [screen](https://www.gnu.org/software/screen/)
- Claude Code running inside one of them
- `jq`

## Usage

```
/side-fork
/side-fork tab
```

## Installation

```
/plugin install side-fork@pokutuna-plugins
```

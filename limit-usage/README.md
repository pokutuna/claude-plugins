# limit-usage

Stop model requests before you exhaust your Claude usage.

## Overview

Set a threshold and once it is reached, the plugin **stops every model request**, subagents included, so you don't burn through your usage. Two kinds of threshold:

- **Usage %** for a rate-limit window (`5h` / `7d`) — for plans that have a usage quota (Pro / Max / Team / Enterprise).
- **Cost** — this session's **approximate cumulative USD**. Use this when `5h`/`7d` aren't reported, i.e. a plan with no usage quota.

Both figures come from Claude Code itself, so measuring costs **zero extra quota** — no `claude -p`, no OAuth token, no API calls, no statusLine setup. It fails open: with no data, no threshold, or an internal error, requests go through normally.

> **Requires a Claude Code build with mods** (function hooks, early access). On a build without them the plugin does not work: it stops nothing, and the build may report a plugin load error.

> **`cost` is per-session.** Each session's `cost` limit tracks only that session's own spend. `5h`/`7d` are account-wide, but each session checks only the usage reported to it, so a new session is not stopped until its first response arrives. Sessions on different accounts, such as Claude.app's and the CLI's, never see each other's usage.

## Install

```bash
claude plugin marketplace add pokutuna/claude-plugins
claude plugin install limit-usage@pokutuna-plugins --scope user
```

> **Note:** We recommend `--scope user` (default). See [Recommendation](https://github.com/pokutuna/claude-plugins#recommendation).

## Usage

```
/limit-usage 5h=80             # stop when the 5h window is 80% used (this session)
/limit-usage 5h=80 7d=90       # set both windows in one go
/limit-usage cost=$5           # stop once this session reaches ~$5 (cost=5 / $5 also work)
/limit-usage 7d=90 --global    # apply to all sessions (5h/7d only)
/limit-usage clear             # remove this session's thresholds (global ones stay)
/limit-usage clear --global    # remove this session's and the global thresholds
/limit-usage status            # thresholds + current usage
```

For `5h`/`7d` the number is the **used percentage** (0–100): `80` means "80% used / 20% left". A session threshold overrides the global one for the same window. For `cost` it's an **approximate USD** amount Claude Code estimates, so treat it as a rough cap. It is per-session only: `cost` with `--global` is set for the current session.

While a request is being stopped, the plugin's status line under the prompt shows why and how to lift it, e.g. `Blocked: 5h 81.0% >= 80% · resets 18:10 · /limit-usage clear`. When the threshold behind the block was set with `--global`, the line names `/limit-usage clear --global` instead. The command itself never sends a model request, so it works while blocked.

`5h`/`7d` figures appear after the session's first API response. If `status` never shows them, your plan has no usage quota — use a `cost` limit instead.

## How it works

```mermaid
flowchart LR
    CC[Claude Code] -.->|"session usage:<br>rate limits, cost"| G
    SET["/limit-usage"] -->|thresholds| ST[("session state /<br>plugin store")]
    STEP["each model step<br>(main and subagents)"] --> G{{"turn.step:<br>used% / cost ≥ threshold?"}}
    ST -.-> G
    G -- Yes --> STOP["No request sent"]
    G -- No / no data --> SEND["Request sent"]
```

1. Before each model request, main loop or subagent, a `turn.step` hook compares current usage against the thresholds. When one is reached it answers the step itself, so no request is sent.
2. Usage is read from Claude Code: the session's own rate limits and cost. A rate reading whose window has reset, or that has no reset time, is ignored: a session that is stopped gets no new readings, so a block has to lift when the window resets.
3. Session thresholds live in the session's plugin state; `--global` thresholds live in the plugin store Claude Code manages. The plugin keeps no state file of its own.

## Upgrading from 0.5.x

0.6.0 no longer shares rate readings between sessions or writes a snapshot for other tools. The readings 0.5.x shared are removed from the plugin store when a session starts. Delete the snapshot `${XDG_STATE_HOME:-~/.local/state}/cc-limit-usage.json` yourself.

## Upgrading from 0.4.x

0.4.x captured usage by wrapping your statusLine. After updating:

1. Set `statusLine.command` in `~/.claude/settings.json` back to your original command (the part 0.4.x passed to `statusline-wrapper.sh`).
2. Delete the old state file `${XDG_STATE_HOME:-~/.local/state}/cc-limit-usage.conf` and `~/.claude/plugins/data/limit-usage-pokutuna-plugins/`.

Thresholds are not carried over; set them again with `/limit-usage`.

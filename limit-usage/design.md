# limit-usage — design notes

A Claude Code plugin that stops tool execution before you cross a usage threshold you set — either a rate-limit utilization percentage or a per-session cumulative cost (approximate USD, for plans with no usage quota).

## Goals / requirements

- Stop Claude's work once the user-specified usage is reached (e.g. once 80% of the 5h window is used)
- Implement it with a hook
- **Zero metering cost** — never burn quota just to measure how much is left
- Assume the user already runs a custom statusLine, and don't break it

## Facts established by investigation (why this design)

### Comparing ways to obtain quota / usage state

| Approach | Metering cost | Information available | Verdict |
|---|---|---|---|
| Calling `GET /api/oauth/usage` directly (the real endpoint behind `/usage`) | ~zero | `utilization`% + `status` | ❌ Requires reading the OAuth token. The keychain token **was expired** (observed 401 in practice). You'd have to reimplement the `refreshOAuth: true`-style token refresh yourself — a minefield |
| The `rate_limit_event` from `claude -p --output-format json` | ❌ **Burns quota every time** | `status` (allowed/allowed_warning/rejected) + resetsAt + overage | ❌ Spinning up a new session and running inference just to measure how much is left is self-defeating. After 2026/6/15 there's also the concern of separate Agent SDK quota consumption |
| **`rate_limits` from statusLine stdin** | ⭕ **Truly zero** (rides on the normal response) | `five_hour.used_percentage` / `seven_day.used_percentage` (0–100) + `resets_at` | ✅ **Chosen.** No extra request, no token, no refresh |

### What's inside `rate_limits` / `rate_limit_event` (from analyzing the Claude Code binary v2.1.160)

Internally, Claude Code parses the API response headers `anthropic-ratelimit-unified-*` (function `s97()`) and holds the usage state. The header group:

- `anthropic-ratelimit-unified-status` — `allowed` / `allowed_warning` / `rejected`
- `anthropic-ratelimit-unified-reset` — reset epoch
- `anthropic-ratelimit-unified-fallback` — `available`
- `anthropic-ratelimit-unified-overage-status` / `-overage-reset` / `-overage-disabled-reason`
- `anthropic-ratelimit-unified-representative-claim` / `-upgrade-paths`

Meaning of `status` (from the binary's warning-display logic):

- `allowed` — normal, no display
- `allowed_warning` — near the limit. Warning is shown at `utilization >= 0.7` (70% or more); below 70% it's suppressed
- `rejected` — limit hit, error display

`rateLimitType` enum: `five_hour | seven_day | seven_day_opus | seven_day_sonnet | overage`

An observed sample of `claude -p --output-format json`:
```json
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1780417800,
 "rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"out_of_credits","isUsingOverage":false}}
```

### Only statusLine can receive `rate_limits` (a key constraint)

- **A plugin cannot provide a statusLine.** The `settings` in `plugin.json` only support `agent` and `subagentStatusLine`; the main `statusLine` is not allowed
- **statusLine is single and override-based.** It does not stack across scopes; exactly one wins — the most specific scope
- **statusLine is the only hook that receives `rate_limits`.** It does not arrive in SessionStart / PreToolUse / PostToolUse / Notification / Stop
- `rate_limits` only appears for **Claude.ai subscriptions (Pro/Max/Team/Enterprise), from the first API response of the session onward**. Each window can be independently absent

→ Conclusion: short of **wrapping the user's existing statusLine and teeing its stdin into a state file**, there is no way to get `rate_limits` at no extra cost.

### The problem of which path to bake into statusLine.command, and the fix (`CLAUDE_PLUGIN_DATA` + SessionStart)

When you write the wrapper into `statusLine.command` in settings.json, **which path you bake in** is the trap. Constraints confirmed by testing on a real machine (clean environment + official docs):

- `${CLAUDE_PLUGIN_ROOT}` is **not expanded in the statusLine execution context**. The only env passed to statusLine is `COLUMNS` / `LINES` / `FORCE_HYPERLINK`; `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` do not arrive (it's a different context from a hook)
- The real path behind `${CLAUDE_PLUGIN_ROOT}` is a **versioned cache path** `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. Baking that in literally **breaks on update** (the old version is deleted 7 days after being orphaned)
- The cache has **no** version-independent `latest` / `current` symlink
- There is **no** hook that fires on install/enable/update either (`Setup` is `--init-only` only and doesn't fire on normal startup, so it's unusable)

Adopted: **on install, copy the wrapper once into `CLAUDE_PLUGIN_DATA` (a persistent directory that survives version updates) and bake that stable path into statusLine.**

- `CLAUDE_PLUGIN_DATA` = `~/.claude/plugins/data/<plugin-id>/` (`@`→`-`, e.g. `limit-usage-pokutuna-plugins`). Persists until uninstall
- `guard.sh install` copies the wrapper to `$CLAUDE_PLUGIN_DATA/statusline-wrapper.sh` and bakes that path into `statusLine.command`. Since it's not the cache path, it doesn't break on a version update
- **No automatic re-copy on SessionStart etc.** (the wrapper's contents barely change; prefer simplicity over adding a hook). Only when a plugin update changes the wrapper do you re-run `/limit-usage-setup install` to re-copy the latest — noted in the README
- env propagation is asymmetric per layer (plugin-level hook = both ROOT+DATA / skill frontmatter hook = ROOT only / Bash tool subprocess = neither). For the skill that handles install to know `CLAUDE_PLUGIN_DATA` / `CLAUDE_PLUGIN_ROOT`, it **relies on `${...}` pre-substitution in the skill body** (Claude Code substitutes these; they don't reach the Bash tool subprocess env, so the skill body passes them explicitly as an env prefix)

### Identifying the settings.json to edit — don't trust Bash's env (confirmed by testing on a real machine)

How does install identify the settings.json it rewrites? For user scope it's `$CLAUDE_CONFIG_DIR/settings.json` if `CLAUDE_CONFIG_DIR` is set, otherwise `~/.claude/settings.json`. There are two traps here (both actually hit during clean-environment testing):

- **`CLAUDE_CONFIG_DIR` does not move `CLAUDE.md`'s location.** Even started with `CLAUDE_CONFIG_DIR=/tmp/cc-clean`, CLAUDE.md is still read from `~/.claude/CLAUDE.md` (asymmetric: the memory directory points at the `$CLAUDE_CONFIG_DIR` side). → **Do not infer the config directory from the CLAUDE.md path that shows up in context**
- **The Bash tool subprocess's `$CLAUDE_CONFIG_DIR` is contaminated by the profile.** Because a non-interactive shell re-reads `.zshenv` etc., if the profile has `export CLAUDE_CONFIG_DIR=~/.claude`, then even when started with `CLAUDE_CONFIG_DIR=/tmp/cc-clean claude` the value is **overwritten with the production value inside the Bash subprocess**. If the skill evaluates `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` in Bash it grabs the production settings — about to edit production dotfiles while thinking it's a clean-environment test (= the same "you can't trust the Bash subprocess env" problem we hit with `CLAUDE_PLUGIN_DATA`)

**Decision: don't chase this further (the current safeguards are enough).** Actual harm only occurs in the test-specific situation of "exporting `CLAUDE_CONFIG_DIR` in the profile while starting with a different config dir and installing"; it doesn't happen in normal use. Even if the wrong file is grabbed, install has a triple safeguard so the user can notice and stop it: (1) it picks the file that actually defines `statusLine`, (2) it resolves symlinks to their real target with `realpath`, and (3) it presents the target path with AskUserQuestion for consent before editing (in testing this actually let us stop after seeing "`~/.claude/settings.json` is a dotfiles symlink"). Passing `${CLAUDE_CONFIG_DIR}` via `${...}` substitution in the skill body could cure it at the root, but expansion isn't guaranteed and isn't worth the cost.

### Value format / units (confirmed against the implementation in `~/.claude/statusline.ts`)

```ts
rate_limits?: {
  five_hour?: { used_percentage?: number; resets_at?: number };
  seven_day?: { used_percentage?: number; resets_at?: number };
};
```

- **`used_percentage`**: the unit is **percent (%), a number from 0 to 100** (may be fractional, e.g. `23.5`). It's the **fraction already used** (`80` = 80% used = 20% left). The official docs also state "from 0 to 100"
- **`resets_at`**: **Unix epoch seconds** (a timestamp, not a percentage)
- All optional. Everything — including `rate_limits` itself — can be absent (free tier, before the first API response). The reference implementation guards every level with `?` (`input.rate_limits?.five_hour?.used_percentage`) and checks for both being absent with `fiveHourPct != null || sevenDayPct != null`
- → The `80` in `set 5h 80%` is the **ceiling on `used_percentage` (%)**. The check denies on `used_percentage >= 80`

### Cost ceiling for plans with no usage quota (implemented)

`rate_limits` (the 5h/7d used_percentage) only rides on responses for plans that have a usage quota. On plans without one, `rate_limits` doesn't arrive and the used_percentage check is ineffective (no rate in the snapshot → the rate side is always fail-open). So we added a **ceiling on cumulative session cost** (approximate USD, same scope as `/cost`) as a stopping criterion.

The source is **`cost.total_cost_usd` from statusLine stdin**. Unlike `rate_limits`, it's not header-derived — it's computed by Claude Code from tokens, so it **arrives on stdin regardless of plan** (statusline.ts actually reads it). It rides on the same wrapper plumbing. The transcript has no cost field, only raw tokens, so since we don't need any time-windowed aggregation here, the statusLine side is sufficient.

- **The value is just Claude Code's own estimate** (tokens × built-in rates). It can drift from actual billing, so the deny message carries a `~` (`Session cost ~$6.20 >= limit $5.00.`). Staying at 0 just means it never stops = safe side
- **cost is session-only** (reject `--global`; read does not fall back to global either). `total_cost_usd` is the cumulative figure for one session and is never summed across sessions, so a global cost couldn't mean "total across all sessions" and would be meaningless (stated explicitly as a point)
- **Detecting a no-quota plan** isn't strictly possible. If the snapshot has no `rate_limits`, it's either "a plan with no quota" or "before the first response" — don't assert; when no rate is visible via `status`, just **hint** at using cost rather than stating it as fact

This adds just one judgment axis (no new hook / surface, `limit-usage-setup` untouched):

1. **`statusline-wrapper.sh`** — pull `rate_limits`, `cost.total_cost_usd`, and `session_id` in one jq pass (`map(. // "null") | @tsv`) and write each scope only when its data is present (a `has_rate` flag for `[global]`, a non-empty session id for `[session]`)
2. **`guard.sh`** — add `cost-usd` (aliases `cost`/`usd`) to `window_key` / a `total_cost_usd >= threshold` branch in `check` (after rate, OR'd) / make `resolve_limit` treat cost as session-only / make `set` reject `--global` for cost / make `clear`, `status`, and `deny` handle cost (with `$` notation) / make `status` show a cost hint when rate is absent
3. **`limit-usage` SKILL.md** — normalize `cost=5` to `set cost 5` (strip `$`/`%`). Note that cost is session-only
4. **README / design** — state that it's an estimate, cumulative per session, and for plans with no usage quota (without naming any provider)

**A latent bug found during implementation (fixed)**: when receiving `jq … | @tsv` via `IFS=$'\t' read`, tab is IFS-whitespace, so **leading and consecutive empty fields collapse and values shift left**. When `five_hour` is absent but only `seven_day` is present, the `seven_day` value lands in `$five` and is mis-judged — that was a real bug. Cured it by making the jq side `map(. // "null")` so there are no empty fields, and `"null"` is rejected by the numeric check and falls open (still applied in the wrapper's capture jq). Note that with the later unification, `check` reads each key individually via `git config`, so this `@tsv` path no longer exists on the `check` side; the lesson is kept, and the bats "only 7d present" case guards against regression.

### State consolidated into one file — scope = section / kind = key prefix (an important correction)

**Background problem**: originally the snapshot was a single JSON (`cc-limit-usage-rate.json`) shared and overwritten by all sessions. `rate_limits` is an **account-shared value** (whichever session reports it, the 5h/7d used% is the same), so sharing is fine. But `cost.total_cost_usd` is a **per-session cumulative**. If put in a shared snapshot, it gets overwritten by "the last-responding session's cost," and another session's `check` would **judge against someone else's cumulative** (smaller than its own real cost → fail to stop; larger → stop too early). `cost` arrives on both subscription and API sessions, so it's not "safe because one of them doesn't get it." The condition is using `cost` with concurrent sessions at all; a mix is just one example.

**First-stage correction (later unified)**: moved the snapshot into a gitconfig keyed by scope, in a file separate from the thresholds, `cc-limit-usage-rate.conf`. The motivation was to "separate the snapshot the wrapper writes frequently from the threshold the user writes rarely, isolating lock contention and cleanup targets."

**Final correction (unification)**: judged the file split unnecessary and **consolidated into one file, `cc-limit-usage.conf`**. Reasons:
- `git config` writes are atomic (create `.lock` → rename), so even in one file the values don't mix as long as the keys differ. Concurrency is practically a handful of sessions, and even a collision falls open and recovers on the next response, so no retry is needed either (a review showed "15% lock failures at 100-way concurrency," but that's an unrealistic load for human-driven sessions). The main motivation for splitting (avoiding contention) was thin.
  - **Exception — an orphaned lock does not recover on its own**: a writer killed mid-write (SIGKILL, sleep, power loss) leaves `.lock` behind, and from then on every write fails with `could not lock config file`. Since the wrapper swallows write errors and `check` treats a stale snapshot as absent, the guard silently failed open for two days in practice. Fix: before writing, the wrapper and `set`/`clear`/`status` delete a `.lock` older than one minute (`find -mmin +1`, portable across BSD/GNU). git holds the lock for milliseconds, so a minute-old lock is never a live writer's.
- One file means state location, cleanup, and migration all happen in one place, reducing the number of concepts.

The structure after unification. **Sections are cut by scope (global / session); kinds are distinguished by key prefix** (`used-*` = measured / `limit-*` = threshold):

```ini
[global]                       ; account-shared
    used-5h = 42               ; measured quota % (wrapper). Same no matter which session writes it → safe to overwrite
    used-7d = 18
    reset-5h = 1780417800
    reset-7d = 1780999999
    epoch = 1780843000          ; last-updated epoch of the quota measurement
    schema = 1                  ; snapshot format generation (wrapper)
    limit-5h = 90               ; threshold for --global (set)
    limit-7d = 95
[session "<sid>"]              ; per-session
    used-usd = 4.52             ; measured cost (wrapper). Each session writes its own section → no collision
    epoch = 1780843005          ; last-updated epoch of the cost measurement
    limit-5h = 80               ; this session's threshold (set)
    limit-7d = 90
    limit-usd = 5               ; cost threshold (session-only)
```

Writer responsibilities are split by key prefix (no collision even co-located in the same section):
- **wrapper**: writes only `used-*` / `reset-*` / `epoch` / `schema`. `rate_limits` → `[global]`, `cost.total_cost_usd` → `[session "<sid>"]`. One update epoch per scope. Never touches `limit-*`
- **set / clear**: write only `limit-*`. Never touch `used-*`
- **check**: reads only. Never writes
- **Cleanup**: `[session]` sections accumulate, but on `set` / `clear` / `status` it **deletes session sections older than the GC period (default 7 days)** (GC at natural execution points, without adding another hook). `[global]` is one and doesn't grow. A `--remove-section` on an already-deleted section is swallowed as a no-op (safe even if a concurrent writer deleted it first)

**check invariants (settled in review, guarded by tests)**:
- **fail-open means "on any internal error, ultimately allow (exit 0, no output)."** Don't use `set -e`; swallow every `git config` read with `|| true`, so feeding it broken state never causes a deny (guarded by the bats "corrupt state file" case)
- **staleness is judged by the epoch of the measured value's scope.** `used-5h`/`used-7d` freshness is `global.epoch`; `used-usd` freshness is `session.epoch`. For 5h/7d the scopes cross (threshold = session, measurement = global), but freshness is always read from the **measurement** side (global)
- **session_id passes through verbatim** (subsection names are case-sensitive; no lowercasing or other normalization). An empty session_id is never written / never cost-judged (does not default to global)

**Migration**: the old wrapper writes to a separate file (`cc-limit-usage-rate.json` / `cc-limit-usage-rate.conf`), so a plugin update alone won't refresh the `used-*`/`schema` the new guard reads in `cc-limit-usage.conf`, and the guard stays fail-open forever (= silently ineffective). To detect this, the wrapper writes `global.schema` every time, and on `set`/`clear`/`status` the guard emits **a re-install warning only** if "schema is absent/below EXPECTED, or a legacy file lingers" (check never warns = fail-open preserved). `install` deletes the legacy files and recreates them. Thresholds from old sessions are discarded, not migrated.

### Why the wrapper works as pure stdin pass-through (confirmed in the implementation)

After checking the dependencies and output of the reference implementation (`~/.claude/statusline.ts`), the wrapper can be fully transparent:

| Dependency/output | What the implementation actually does | Effect on the wrapper |
|---|---|---|
| Input | stdin only (`JSON.parse(await Bun.stdin.text())`) | Tee stdin and forward it → transparent |
| Args `argv` | Not used | The wrapper may consume the arguments |
| Environment variables | `HOME` only | The wrapper passes env through |
| External commands | `ghq root` / `git -C` | The wrapper changes neither CWD nor env, so no effect |
| Output | One line to stdout via `console.log` only | If the wrapper doesn't touch stdout, it's displayed as-is |
| Exit code | Implicit 0 | The wrapper returns the original exit code |

→ The wrapper works as "absorb stdin with `$(cat)` → save it to the state file → forward stdin to the original command with `printf '%s' "$input" | sh -c "$orig"` (without touching stdout/stderr/exit code)." `ts` is added via jq's `now`.

## Architecture

```
[skill] /limit-usage-setup install ── copy the wrapper into ${CLAUDE_PLUGIN_DATA}/ (secure a stable path, once)
                                                    │
[Claude Code] --rate_limits (from response headers)--> statusLine stdin JSON
                                                    │
   settings.json: statusLine.command = ~/.claude/plugins/data/<id>/statusline-wrapper.sh '<original command>'
                                                    │
        wrapper.sh: save stdin to the state file (write used-*) → pass stdin through to the original statusLine
                                                    │
              ~/.local/state/cc-limit-usage.conf  ([global] used-* / [session] used-usd / limit-*)
                                                    │
[PreToolUse] guard.sh check ── compare used-* (measured) with limit-* (threshold) ── deny if over
                                                    │
[skill] /limit-usage ── threshold settings (set / clear / status). Writes limit-*
[skill] /limit-usage-setup ── install (interactively guides the wrapper swap) / uninstall
```

## Directory layout

```
limit-usage/
├── .claude-plugin/plugin.json
├── hooks/hooks.json                    # PreToolUse (all tools) → guard.sh check
├── bin/
│   ├── statusline-wrapper.sh           # tee stdin → pass through to the original command
│   └── guard.sh                        # check / set / clear / status / install / uninstall
│                                       # install copies the wrapper into CLAUDE_PLUGIN_DATA
├── skills/
│   ├── limit-usage/SKILL.md            # set / clear / status (doesn't touch settings.json; no Edit permission)
│   └── limit-usage-setup/SKILL.md      # install / uninstall (edits settings.json; has Edit permission)
├── design.md                           # this file
└── README.md
```

## Component spec

### 1. statusline-wrapper.sh

- Reads stdin and, in a single jq pass, extracts `rate_limits` (5h/7d used% + reset), `cost.total_cost_usd`, and session_id simultaneously, saving them to the unified state file (cost and rate ride on the same stdin together)
  - state file: `${XDG_STATE_HOME:-~/.local/state}/cc-limit-usage.conf` (the same file as thresholds; kinds distinguished by key prefix)
  - If `rate_limits` is present, write `used-5h`/`used-7d`/`reset-*` + `epoch` to `[global]`; if `cost` and session_id are present, write `used-usd` + `epoch` to `[session "<sid>"]`. Each window is set when present / unset when absent (so one window dropping out doesn't leave a stale value). Whenever anything is written, stamp `global.schema` every time
  - When both are absent (free tier, before the first response), write nothing (keep the previous snapshot). `rate_limits` is subscription-only; `cost` rides on all auth types
  - **Writes only `used-*` / `reset-*` / `epoch` / `schema`.** Never touches `limit-*` (thresholds)
- Passes stdin through unchanged to the original command in the first argument and runs it. If there is no original command, prints nothing (an empty statusLine stays empty and is respected. Claude Code has no built-in default statusLine, so emitting our own line would be an unwelcome imposition)

### 2. guard.sh + gitconfig state

One state file (gitconfig format) consolidating measured values and thresholds:
`${XDG_STATE_HOME:-~/.local/state}/cc-limit-usage.conf` (for the structure, see the "State consolidated into one file" section above)

| Key | scope | Meaning | Writer | Reader (check) |
|---|---|---|---|---|
| `used-5h` / `used-7d` | global | measured quota utilization (%) | wrapper | global (account-shared) |
| `reset-5h` / `reset-7d` | global | window reset epoch | wrapper | for the deny message |
| `used-usd` | session | measured cumulative session cost (approx USD) | wrapper | own session only |
| `epoch` | per scope | last-updated epoch of that scope's measurement | wrapper | staleness check (reads the epoch of the measured value's scope) |
| `schema` | global | snapshot format generation | wrapper | stale-wrapper detection |
| `limit-5h` / `limit-7d` | session/global | 5h/7d utilization ceiling (%) | `set 5h\|7d N` (default session / `--global` for global) | session.<id> → global → invalid if absent |
| `limit-usd` | session | cumulative session cost ceiling (approx USD) | `set cost N` (**session-only; `--global` not allowed**) | session.<id> only (no fallback to global) |

(The original-command stash `orig-statusline` is dropped. On uninstall the skill strips the wrapper off the current command in settings.json, so it holds no stashed value = even if the user hand-edits after install, that edit is respected.)

Subcommands:

- **`check`** (PreToolUse hook): reads the `used-*` (measured) in the state file, resolves the threshold `limit-*` with session→global fallback. For 5h/7d, `used-5h\|7d >= limit`; for cost, `used-usd >= limit-usd`. If any one is over, deny (rate → cost order, OR).
  ```json
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
   "permissionDecisionReason":"5h usage 82% >= limit 80%. Stopped by limit-usage. Resets at 14:30."}}
  ```
  - **fail-open (invariant)**: threshold unset / no state file / the relevant `used-*` absent / value not numeric / `epoch` too old → `exit 0` (pass through). Furthermore, **on any internal error, ultimately allow** — don't use `set -e`, and swallow every `git config` read with `|| true` (feeding it broken state never causes a deny)
  - **staleness is judged by the epoch of the measured value's scope**: `used-5h`/`used-7d` freshness is `global.epoch`; `used-usd` freshness is `session.epoch`. For 5h/7d the scopes cross (threshold = session, measurement = global), but freshness is always read from the measurement side (global)
  - **Avoiding self-deadlock (important)**: any call whose `tool_input.command` contains `guard.sh` always passes through regardless of the threshold. While the guard is tripped, the plugin's own management commands (`set` / `clear` / `status` / `uninstall`) also go through the same Bash tool, so unless these pass, "you lowered the threshold to stop yourself but lost the very means to change it back" deadlocks the session. SKILL.md calls guard.sh by full path, so it matches reliably (side effect: any command containing the string `guard.sh` also passes, but the escape hatch is only slightly wider, judged harmless)
- **`set 5h 80%` / `set 5h 80 7d 90` / `set cost 5`**: write the threshold `limit-*` to session (default) or global with `--global`. Windows are `5h`/`7d`/`cost`, and multiple can be given in one call (validate all pairs → write them together to prevent partial updates). `$`/`%` are stripped, saving only the number. **`cost` is session-only and passing `--global` is an error** (`total_cost_usd` is a per-session cumulative that doesn't sum, so global is meaningless)
- **`clear`**: removes every threshold `limit-*` in effect for this session (all 5h/7d/cost in session + global). It has no scope flag. To keep only a particular window, overwrite with `set`
- **`status`**: shows the current thresholds `limit-*` + measured `used-*` values and their freshness. When quota isn't visible, gives a cost hint. Runs `warn_if_stale_wrapper` (below) first
- **`install`**: copies the wrapper into `$CLAUDE_PLUGIN_DATA` and deletes legacy snapshot files. Prints `WRAPPER_PATH` + the path (settings.json is edited by the skill)
- **`uninstall`**: deletes the copied wrapper and prints `WRAPPER_REMOVED` (settings.json restore is on the skill side)

`set`/`clear`/`status` run **`warn_if_stale_wrapper`** before execution: if `global.schema` is below EXPECTED/absent, or legacy snapshot files (`cc-limit-usage-rate.json` / `-rate.conf`) linger, emit a "please re-install" warning to stderr only. This mechanism detects the case where forgetting to install after a plugin update leaves the old wrapper writing to old files while the new guard silently falls open. check does not warn (fail-open preserved).

Switching logic (session/global):
- Expressed via the write-target choice (the `--global` flag)
- Reads always fall back in `session.<id>` → `global` order
- 5h / 7d are two independent keys (setting only one is allowed)

### 3. Making install easy to accept (guided by the limit-usage-setup skill)

Principle: **never rewrite settings.json on its own.** The skill "presents the change (target file + before/after) in one line → Edit." **The single consent point is collapsed into the Edit tool's permission prompt**; the skill doesn't pile on a separate AskUserQuestion (that would ask twice and be redundant; if Edit is already allowed it's 0 asks, if unallowed/denied the Edit prompt asks once). Only this `limit-usage-setup` skill edits settings.json; the everyday `limit-usage` (set/clear/status) drops the `Edit` permission for least privilege.

The `/limit-usage-setup install` flow:
1. **Resolve settings.json rather than hardcoding it.** For user scope it's `$CLAUDE_CONFIG_DIR/settings.json` if `CLAUDE_CONFIG_DIR` is set, otherwise `~/.claude/settings.json` (`CLAUDE_CONFIG_DIR` does not move CLAUDE.md's location, so don't infer the config dir from the CLAUDE.md path in context — read the env var directly). `statusLine` may live in a project `.claude/settings.json` instead, so pick the file that actually defines `statusLine`. **If it's a symlink, edit the real target via `realpath`** (in-place editing of a symlink with Edit breaks dotfiles integration — hit on a real machine). If the real target is in dotfiles, tell the user a commit is needed
2. Read the current `statusLine.command` (if it already contains `statusline-wrapper.sh`, it's already wrapped; re-install just refreshes the copy, no settings.json edit). 
3. `guard.sh install` copies the wrapper to `$CLAUDE_PLUGIN_DATA/statusline-wrapper.sh` (also deletes legacy snapshot files) and prints `WRAPPER_PATH` + the path. **What gets baked in is the stable `CLAUDE_PLUGIN_DATA` path** (version-independent). The skill wraps the current command in single quotes and assembles `<wrapper> '<current command>'`:
   ```
   Before: "command": "~/.claude/statusline.ts"
   After:  "command": "~/.claude/plugins/data/<id>/statusline-wrapper.sh '~/.claude/statusline.ts'"
   (Display unchanged. It records utilization to a file in the background. uninstall strips the wrapper to restore)
   ```
4. Present the change in one line, then Edit settings.json (the real file). (No AskUserQuestion in between; the Edit prompt is the consent point.) Preserve `type` / `padding`
5. For a user with no statusLine, attach the wrapper with no original command (display stays empty; metering only)
6. `uninstall`: the skill **strips the wrapper off the current command** in settings.json to restore (it does not stash the original = even if the user hand-edits after install, that edit is respected). The uninstall steps are noted in the README
7. **Idempotent**: re-running install doesn't double-wrap (if it's already a wrapper, do nothing)
8. **Update**: when a plugin update changes the wrapper's contents, re-run `/limit-usage-setup install` (the stable path is unchanged; it just overwrites the copy)

### 4. SKILL.md (split in two)

- **`limit-usage`** (everyday): `5h=80 7d=90` (`--global`) / `clear` / `status`. Since it doesn't touch `settings.json`, its `allowed-tools` is only the Bash for guard.sh (no `Edit`). The skill converts the user's natural input (`5h=80`, omitted `set`, multiple windows) into the canonical form `set 5h 80 7d 90` and calls it. If not installed, points to `/limit-usage-setup install`. **Output just states the result of the executed command briefly** (set/clear: one-line confirmation; status: the status output. Don't pile on a long breakdown of current values, guidance about other settings, or follow-up questions)
- **`limit-usage-setup`** (setup): `install` / `uninstall`. Because it edits `settings.json`, its `allowed-tools` has `Edit(~/.claude/settings.json)` / `Edit(.claude/settings.json)` plus the Bash that passes `CLAUDE_PLUGIN_DATA` (the wrapper copy destination)
- Both show an argument hint via the frontmatter `argument-hint`

## Design notes

- **Zero metering cost**: don't use `-p`. Only `rate_limits` riding on the normal response
- **Reversibility**: install wraps the live `statusLine.command`, and uninstall strips the wrapper back off the current command — the skill does not stash the original (so a statusLine the user edited after install is respected). It doesn't break settings
- **Free tier / before the first response**: `rate_limits` doesn't arrive → fail-open (pass through, warning log only)
- **State file freshness**: statusLine updates on every response + `refreshInterval`. A too-old ts → pass through (safe side)
- **Meaning of thresholds**: 5h/7d are the ceiling on `used_percentage` (`set 5h 80%` = stop once 80% of the 5h window is used; values only arrive for plans with a usage quota). cost is the ceiling on cumulative session approximate USD (`set cost 5` = stop at ~$5; for plans with no usage quota; session-only). cost is Claude Code's estimate, so it can drift from actual billing
- **Avoiding self-deadlock**: while the guard is tripped, `set`/`clear`/`status`/`uninstall` go through the same Bash tool → blocking them would make recovery impossible. `check` avoids this by always passing commands that contain `guard.sh` (a real bug found during testing: under the `--plugin-dir` test, `status` itself got blocked)
- **Path baked into statusLine**: `${CLAUDE_PLUGIN_ROOT}` is not expanded in statusLine, and the cache path breaks on a version update. install copies the wrapper once to the stable `CLAUDE_PLUGIN_DATA` path and bakes that. See the "The problem of which path to bake into statusLine.command" section
- **settings.json symlink**: for users who manage dotfiles via symlink, Edit replaces the symlink with a plain file and breaks the integration. install/uninstall resolve the real target via `realpath` before editing (found during testing on a real machine)
- **Identifying the settings.json to edit**: don't hardcode `~/.claude/settings.json`; account for `CLAUDE_CONFIG_DIR`. But the Bash subprocess's `$CLAUDE_CONFIG_DIR` can be contaminated by the profile, so don't over-trust it. The harm is limited, so decided not to chase it further. See the "Identifying the settings.json to edit — don't trust Bash's env" section

## Existing plugins to reference

- `allow-until`: gitconfig-format state file (`git config -f`), `session.<id>` sections, the structure of returning a `permissionDecision` from PreToolUse
- `pushover-notify`: the hooks.json + bin + skills composition, the skill's toggle guidance

## Open / to confirm during implementation

- Whether `rate_limit_event` carries `utilization` (a numeric %) is unconfirmed (if it does, an option opens to supplement the % threshold from another source without `-p`, but for now statusLine's `used_percentage` is enough)
- Whether to use `status` (allowed_warning/rejected) as an auxiliary signal (the current design judges on the used_percentage threshold alone; a future option)
- Register plugin.json / the marketplace following `docs/CHECKLIST.md`

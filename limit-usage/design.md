# limit-usage — design

limit-usage runs on Claude Code's function hooks (mods, early access). Up to
0.4.x it was a shell plugin that captured usage by wrapping the user's
statusLine, kept everything in a git-config state file, and denied tool calls
from a `PreToolUse` hook. The mod API exposes the same figures directly, so
both workarounds go away.

## Goals

1. **Usage without the statusLine wrapper.** Read rate limits and session cost
   from `$.session.usage()`. No install step, no edit to
   settings.json, works whether or not the user has a statusLine.
2. **No state file of our own.** Measured values come from the engine on
   demand. Thresholds live in engine-managed storage: per-session in `$.state`,
   `--global` in `$.store`. The engine owns that storage, so the plugin does
   not lock a file against concurrent sessions, prune sections left by ended
   sessions, or migrate a file format.
3. **Stop the model request itself.** A `turn.step` hook answers without
   `next` when a threshold is reached, so no request is sent. A `PreToolUse`
   deny acts only after the model has already answered with a tool call, and
   never stops a turn that answers in text alone; stopping the step covers both.
   Subagent steps are stopped the same way. The `/limit-usage` command never
   needs a model request, so lifting a threshold always works.
4. **Same thresholds and semantics as the shell plugin.**
   - `5h` / `7d`: deny when `percentUsed >= limit` (0–100).
   - `cost`: deny when this session's `cost.usd >= limit`; session-only,
     so `cost` with `--global` is set for the current session.
   - A session threshold overrides the global one per window.
   - `clear` removes this session's thresholds; `clear --global` also removes
     the global ones, so lifting one session's block never changes the others.
   - A rate reading whose `resetsAt` has passed counts as absent.
5. **Each session reads only its own usage.** Sessions on one config
   directory can be signed in to different accounts with separate quotas:
   Claude.app runs its sessions with the CLI's `~/.claude` under its own
   login. Rate readings shared through `$.store` mixed those accounts, and the
   highest one blocked the other account's sessions. Reading only
   `$.session.usage()` keeps each account to its own figures without
   identifying the account. The cost: a session is not guarded on rate
   limits until its first response reports them. `--global` thresholds stay
   in `$.store`; they are a policy, checked against each session's own usage.
6. **Show why requests are stopped.** While a request is being stopped, the
   plugin's own `$.ui.status` line (beside the engine's notices, not the
   user's statusLine) says why and names the command that lifts it (`clear`,
   or `clear --global` for a global threshold); otherwise it is cleared.
   It is refreshed on each step, after each command, and at session start.
   A window that resets clears the line at the next step, not on its own.
7. **Fail open.** Any internal error lets the request through; a failed
   store write never blocks.

## Tests

`claude plugin test limit-usage` runs `tests/limit-usage.test.ts` against a
mocked engine. It covers threshold parsing, session-over-global precedence,
a stop on each window and on cost, reset windows ignored, readings left in
the store by 0.5.0 ignored, and the status line set while blocked and cleared after.
`claude plugin validate limit-usage` checks the manifest and the hooks module.

## Non-goals

- Codex support (mods are Claude Code only).
- A fallback for Claude Code builds without mods.
- Writing usage for display tools. 0.5.0 wrote a snapshot file; the only
  reader was a personal script, and readings from every account landed in it.

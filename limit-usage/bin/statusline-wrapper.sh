#!/bin/bash
# statusline-wrapper.sh - Tee statusLine stdin into the state file, then pass it
#                         through to the user's original statusLine command unchanged.
#
# Overview:
#   Claude Code feeds the statusLine command a JSON blob on stdin that includes
#   `rate_limits` (5h / 7d usage %) and `cost` (this session's cumulative cost).
#   This is the ONLY hook surface that receives them, and it rides on the normal
#   response — so capturing it here costs zero extra quota.
#
#   This wrapper:
#     1. reads stdin once
#     2. saves the figures into the state file (see layout below)
#     3. replays the exact same stdin to the original statusLine command
#   stdout / stderr / exit code of the original command are passed through untouched.
#   If there is no original command, nothing is printed — a user who had no
#   statusLine keeps an empty one (Claude Code has no built-in default to fall back to).
#
# State file (git-config; ${XDG_STATE_HOME:-~/.local/state}/cc-limit-usage.conf):
#   One file, sectioned by scope. rate_limits are account-wide (every session
#   reports the same 5h/7d %) so they live in [global]; cost.total_cost_usd is
#   per-session (it never adds up across sessions) so it lives in [session "<id>"].
#   Key prefix marks the kind: `used-*` = measured (written here), `limit-*` =
#   threshold (written by guard.sh set/clear). The two writers never share a key,
#   so co-locating them in one section is safe.
#
#     [global]
#         used-5h = 42                 ; measured quota %  (this wrapper)
#         used-7d = 18                 ; measured quota %  (this wrapper)
#         reset-5h = 1780417800        ; window reset epoch
#         reset-7d = 1780999999
#         epoch = <epoch>              ; quota snapshot last-updated
#         schema = 1                   ; snapshot format generation
#         limit-5h = 90                ; --global thresholds (guard.sh set)
#     [session "<id>"]
#         used-usd = 4.52              ; measured session cost (this wrapper)
#         epoch = <epoch>              ; cost snapshot last-updated
#         limit-usd = 5                ; thresholds (guard.sh set)
#
# This wrapper writes ONLY `used-*`, `reset-*`, `epoch`, and `schema`. It never
# touches `limit-*`. session_id is used verbatim (subsection names are
# case-sensitive — never normalize it).
#
# Usage (set into settings.json statusLine.command by the setup skill):
#   statusline-wrapper.sh '<original statusLine command>'

set -uo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}"
STATE_FILE="$STATE_DIR/cc-limit-usage.conf"

# Snapshot schema generation. Bump (monotonic integer) only on a format-breaking
# change to the snapshot layout — NOT on every plugin release. guard.sh carries a
# matching EXPECTED_SCHEMA and warns (on set/clear/status) when what it reads is
# older, which is how it catches "plugin updated but statusLine wrapper not
# re-installed" — the data/ copy of this script is frozen at install time, so a
# plugin update alone never refreshes it.
SNAP_SCHEMA=1

# A git config writer killed mid-write (SIGKILL, sleep, power loss) leaves
# $STATE_FILE.lock behind, and every later write fails on it until it is removed
# — silently, since the wrapper swallows write errors. git holds the lock only
# for milliseconds, so one older than a minute is an orphan: drop it.
clear_stale_lock() {
    local lock="$STATE_FILE.lock"
    if [[ -n "$(find "$lock" -mmin +1 2>/dev/null)" ]]; then
        rm -f "$lock" 2>/dev/null || true
    fi
}

input="$(cat)"

# Capture rate_limits (-> [global]) and cost (-> [session]) into the state file.
# Only write a scope when its data is actually present (absent on the first
# response or on plans without a usage quota), so we don't clobber a still-valid
# value with an empty one.
if command -v jq >/dev/null 2>&1; then
    mkdir -p "$STATE_DIR"
    clear_stale_lock

    # Pull everything we need in one jq pass: session id, the rate fields, cost,
    # and a "has rate_limits?" flag. Missing scalars come back as the literal
    # "null" so the field count is stable and easy to test.
    sid=""; five=""; seven=""; five_reset=""; seven_reset=""; cost=""; has_rate=""
    IFS=$'\t' read -r sid five seven five_reset seven_reset cost has_rate < <(
        printf '%s' "$input" | jq -r '
            .rate_limits as $r |
            [ .session_id,
              $r.five_hour.used_percentage, $r.seven_day.used_percentage,
              $r.five_hour.resets_at, $r.seven_day.resets_at,
              .cost.total_cost_usd,
              (if $r then "y" else "n" end)
            ] | map(. // "null") | @tsv' 2>/dev/null)

    now="$(date +%s)"

    # Account-wide rate snapshot -> [global]. Write only when rate_limits exists,
    # and per sub-value set it when present / unset it when absent so a window
    # that drops out (e.g. only 5h reported) doesn't leave a stale value behind.
    if [[ "$has_rate" == y ]]; then
        used_put() {  # key value
            if [[ "$2" == null || "$2" == "" ]]; then
                git config -f "$STATE_FILE" --unset "$1" 2>/dev/null || true
            else
                git config -f "$STATE_FILE" "$1" "$2" 2>/dev/null || true
            fi
        }
        used_put global.used-5h  "$five"
        used_put global.used-7d  "$seven"
        used_put global.reset-5h "$five_reset"
        used_put global.reset-7d "$seven_reset"
        git config -f "$STATE_FILE" global.epoch "$now" 2>/dev/null || true
    fi

    # Per-session cost snapshot -> [session "<id>"]. Needs a real session id.
    if [[ "$cost" != null && "$cost" != "" && "$sid" != null && "$sid" != "" ]]; then
        git config -f "$STATE_FILE" "session.${sid}.used-usd" "$cost" 2>/dev/null || true
        git config -f "$STATE_FILE" "session.${sid}.epoch"    "$now"  2>/dev/null || true
    fi

    # Stamp the schema generation whenever we wrote anything. This is the marker
    # guard.sh checks to tell a current wrapper from a stale one. Written on every
    # response is cheap and keeps it present even on cost-only (no rate) sessions.
    if [[ -f "$STATE_FILE" ]]; then
        git config -f "$STATE_FILE" global.schema "$SNAP_SCHEMA" 2>/dev/null || true
    fi
fi

# Pass through to the original statusLine command, if any. No original → print
# nothing (an empty status line stays empty).
orig="${1:-}"
if [[ -n "$orig" ]]; then
    printf '%s' "$input" | sh -c "$orig"
fi

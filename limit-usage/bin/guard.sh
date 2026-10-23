#!/bin/bash
# guard.sh - Stop tool execution before you exhaust your Claude rate limit.
#
# Reads usage captured by statusline-wrapper.sh (zero metering cost) and, from a
# PreToolUse hook, denies tool calls once a window passes the configured threshold.
#
# State file (git-config; ${XDG_STATE_HOME:-~/.local/state}/cc-limit-usage.conf):
#   One file, sectioned by scope. Key prefix marks the kind:
#     [global]                       account-wide
#         used-5h / used-7d          measured quota %      (statusline-wrapper.sh)
#         reset-5h / reset-7d        window reset epoch     (statusline-wrapper.sh)
#         epoch                      quota snapshot mtime   (statusline-wrapper.sh)
#         schema                     snapshot format gen    (statusline-wrapper.sh)
#         limit-5h / limit-7d        --global thresholds    (set/clear)
#     [session "<id>"]               per-session
#         used-usd                   measured session cost  (statusline-wrapper.sh)
#         epoch                      cost snapshot mtime     (statusline-wrapper.sh)
#         limit-5h / limit-7d / limit-usd   thresholds       (set/clear)
#
#   Writer split (each writer owns its key prefix; they never collide, so
#   co-locating them in one section is safe):
#     - statusline-wrapper.sh writes used-* / reset-* / epoch / schema
#     - set/clear write limit-*
#     - check only READS, and is fail-open: it must end in allow (exit 0, no
#       output) on ANY internal error. Hence no `set -e`, and every read is
#       `|| true`. A measured value is only honoured if its OWN scope's epoch is
#       fresh: used-5h/7d -> global.epoch, used-usd -> session.epoch.
#   session_id is used verbatim (subsection names are case-sensitive; never
#   normalize it) and a missing/empty session_id is skipped, not defaulted.
#
# Usage:
#   guard.sh check                      - Hook mode: read JSON from stdin, deny if over threshold
#   guard.sh set 5h 80 [--global]       - Set 5h window usage limit (%, plans with a usage quota)
#   guard.sh set 7d 90 [--global]       - Set 7d window usage limit (%, plans with a usage quota)
#   guard.sh set cost 5                 - Set this session's cost limit (approx USD; use when 5h/7d aren't available)
#   guard.sh set 5h 80 7d 90 [--global] - Set multiple windows at once
#   guard.sh clear                      - Remove every threshold in effect now (this session + global)
#   guard.sh status                     - Show thresholds and current usage
#   guard.sh install                    - Copy the wrapper into CLAUDE_PLUGIN_DATA; the skill rewrites settings.json
#   guard.sh uninstall                  - Remove the copied wrapper; the skill restores settings.json

set -uo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}"
STATE_FILE="$STATE_DIR/cc-limit-usage.conf"

# Snapshot schema this guard understands. statusline-wrapper.sh stamps the
# snapshot it writes with its own SNAP_SCHEMA; if what we read is older (or a
# pre-unification snapshot file is still around), the installed wrapper is stale
# — the user updated the plugin but didn't re-run install, so the frozen data/
# copy of the wrapper is still the old one. We only warn (never block); check
# stays fail-open. Keep this in sync with SNAP_SCHEMA in statusline-wrapper.sh.
EXPECTED_SCHEMA=1
# Pre-unification wrappers wrote a separate snapshot file (JSON, then a split
# .conf). Their presence is a tell that an old wrapper is (or was) the one
# running. install removes them; they are never read.
LEGACY_FILES=(
    "$STATE_DIR/cc-limit-usage-rate.json"
    "$STATE_DIR/cc-limit-usage-rate.conf"
)

# Usage snapshots older than this are ignored (fail-open). statusLine refreshes
# on every response and the wrapper rewrites the snapshot each time, so a stale
# snapshot means you simply haven't gotten a response recently — better to let
# the tool run than to block on old numbers.
STALE_SECONDS="${LIMIT_USAGE_STALE_SECONDS:-300}"

# Session sections older than this are garbage-collected on the next
# set/clear/status. Far above STALE_SECONDS so an idle-but-live session is never
# dropped; this only sweeps sessions that have truly ended.
SESSION_GC_SECONDS="${LIMIT_USAGE_SESSION_GC_SECONDS:-604800}"  # 7 days

format_time() {
    date -r "$1" '+%H:%M' 2>/dev/null || date -d "@$1" '+%H:%M'
}

# " (2s ago)" / " (400s ago, STALE — guard fails open)" for the status header's
# snapshot timestamp, or "" if it isn't a timestamp. status() reads the snapshot
# age from the global (5h/7d) epoch; cost age isn't tracked separately.
age_header() {
    local ts="$1" now="$2"
    [[ "$ts" =~ ^[0-9]+$ ]] || return 0
    local age=$(( now - ts ))
    if (( age > STALE_SECONDS )); then
        printf ' (%ss ago, STALE — guard fails open)' "$age"
    else
        printf ' (%ss ago)' "$age"
    fi
}

# A git config writer killed mid-write (SIGKILL, sleep, power loss) leaves
# $STATE_FILE.lock behind, and every later write fails on it until it is removed:
# set exits with an error, and the wrapper's snapshot writes fail silently so
# check ends up failing open. git holds the lock only for milliseconds, so one
# older than a minute is an orphan: drop it.
clear_stale_lock() {
    local lock="$STATE_FILE.lock"
    if [[ -n "$(find "$lock" -mmin +1 2>/dev/null)" ]]; then
        rm -f "$lock" 2>/dev/null || true
    fi
}

cfg_get() {
    git config -f "$STATE_FILE" "$1" 2>/dev/null || true
}

# Drop session sections whose epoch is older than the GC window — these belong
# to sessions that have ended. Called from set/clear/status (natural,
# low-frequency points) so we never add a hook just to clean up. The [global]
# section is never GC'd. A section that's already gone is a no-op (the remove is
# guarded), so a concurrent writer racing us is harmless.
gc_sessions() {
    [[ -f "$STATE_FILE" ]] || return 0
    local now sid ts line
    now="$(date +%s)"
    # List every session.<id>.epoch and drop the section if too old.
    while IFS= read -r line; do
        sid="${line#session.}"; sid="${sid%.epoch *}"
        ts="${line##* }"
        [[ "$ts" =~ ^[0-9]+$ ]] || continue
        (( now - ts > SESSION_GC_SECONDS )) && \
            git config -f "$STATE_FILE" --remove-section "session.${sid}" 2>/dev/null || true
    done < <(git config -f "$STATE_FILE" --get-regexp '^session\..*\.epoch$' 2>/dev/null)
}

# Print a one-line warning to stderr if the installed statusLine wrapper looks
# stale: the unified snapshot carries an older/absent schema, or a
# pre-unification snapshot file is still present (an old wrapper is the one
# actually running). Silent when up to date, never installed, or no snapshot yet
# — we don't nag before the first response. Called from set/clear/status
# (low-frequency, user-facing), never from check.
warn_if_stale_wrapper() {
    local schema legacy
    schema="$(cfg_get global.schema)"
    legacy=""
    for f in "${LEGACY_FILES[@]}"; do [[ -f "$f" ]] && legacy=1; done

    if [[ "$schema" =~ ^[0-9]+$ ]] && (( schema >= EXPECTED_SCHEMA )) && [[ -z "$legacy" ]]; then
        return 0
    fi
    # Below current, OR a legacy snapshot is lingering. But stay silent if there
    # is no sign of any wrapper at all (not installed / no response yet).
    if [[ ! "$schema" =~ ^[0-9]+$ && -z "$legacy" ]]; then
        return 0
    fi
    echo "Warning: your statusLine wrapper looks outdated (snapshot is old-format or pre-schema)." >&2
    echo "         Re-run /limit-usage-setup install to refresh it, or limits won't apply." >&2
}

# Map a friendly window name to its key suffix. Threshold keys are limit-<suffix>
# and measured keys are used-<suffix>, so the suffix composes both.
window_key() {
    case "$1" in
        5h|five-hour|five_hour) echo "5h" ;;
        7d|seven-day|seven_day) echo "7d" ;;
        cost|usd|cost-usd)      echo "usd" ;;
        *) echo "" ;;
    esac
}

# Resolve a threshold for a window suffix: session.<id> -> global -> empty.
# usd is session-only: total_cost_usd is a per-session cumulative figure (same
# scope as /cost) and never adds up across sessions, so a global cost limit
# would be meaningless — don't fall back to global for it.
resolve_limit() {
    local suffix="$1" val=""
    [[ -n "${CLAUDE_SESSION_ID:-}" ]] && val="$(cfg_get "session.${CLAUDE_SESSION_ID}.limit-${suffix}")"
    [[ "$suffix" != usd && -z "$val" ]] && val="$(cfg_get "global.limit-${suffix}")"
    echo "$val"
}

check() {
    # Fail-open: no jq, or no state file yet (before first API response).
    command -v jq >/dev/null 2>&1 || exit 0
    [[ -f "$STATE_FILE" ]] || exit 0

    # One jq over stdin for both the session id and the command being run.
    local cmd
    IFS=$'\t' read -r CLAUDE_SESSION_ID cmd < <(
        jq -r '[.session_id // "", .tool_input.command // ""] | @tsv' 2>/dev/null)
    export CLAUDE_SESSION_ID

    # Never block this plugin's own management commands. Otherwise tripping the
    # guard would block set/clear/status too — the commands needed to recover.
    [[ "$cmd" == *"guard.sh"* ]] && exit 0

    local now; now="$(date +%s)"
    local num='^[0-9]+([.][0-9]+)?$'

    # Measured quota is account-wide -> [global], and its freshness is global.epoch.
    # (Even when the *threshold* lives in the session scope, the *measurement*
    # and thus its staleness are global.) Stale/missing -> treat as absent.
    local five="" seven="" five_reset="" seven_reset="" gepoch
    gepoch="$(cfg_get global.epoch)"
    if [[ "$gepoch" =~ ^[0-9]+$ ]] && (( now - gepoch <= STALE_SECONDS )); then
        five="$(cfg_get global.used-5h)"
        seven="$(cfg_get global.used-7d)"
        five_reset="$(cfg_get global.reset-5h)"
        seven_reset="$(cfg_get global.reset-7d)"
    fi

    # Measured cost is per-session -> read only THIS session's [session "<id>"],
    # and its freshness is that session's epoch. Never another session's cost
    # (that was the shared-snapshot bug).
    local cost="" sepoch
    if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
        sepoch="$(cfg_get "session.${CLAUDE_SESSION_ID}.epoch")"
        if [[ "$sepoch" =~ ^[0-9]+$ ]] && (( now - sepoch <= STALE_SECONDS )); then
            cost="$(cfg_get "session.${CLAUDE_SESSION_ID}.used-usd")"
        fi
    fi

    local five_limit seven_limit cost_limit
    five_limit="$(resolve_limit 5h)"
    seven_limit="$(resolve_limit 7d)"
    cost_limit="$(resolve_limit usd)"

    # awk for float-safe >= ; deny on the first window over its limit (rate first,
    # then cost — OR across all three). Skip a window unless both measured value
    # and limit are plain numbers (fail-open on garbage / missing).
    if [[ "$five" =~ $num && "$five_limit" =~ $num ]] && awk -v u="$five" -v l="$five_limit" 'BEGIN{exit !(u>=l)}'; then
        deny "5h" "$five" "$five_limit" "$five_reset"
    elif [[ "$seven" =~ $num && "$seven_limit" =~ $num ]] && awk -v u="$seven" -v l="$seven_limit" 'BEGIN{exit !(u>=l)}'; then
        deny "7d" "$seven" "$seven_limit" "$seven_reset"
    elif [[ "$cost" =~ $num && "$cost_limit" =~ $num ]] && awk -v u="$cost" -v l="$cost_limit" 'BEGIN{exit !(u>=l)}'; then
        deny "cost" "$cost" "$cost_limit" ""
    fi
    exit 0
}

deny() {
    local label="$1" used="$2" limit="$3" reset="$4" resets=""
    [[ -n "$reset" && "$reset" != "null" ]] && resets=" Resets at $(format_time "${reset%.*}")."
    local reason
    if [[ "$label" == cost ]]; then
        # cost is Claude Code's own estimate (token count × built-in rates), so
        # it can be approximate — flag it with `~`.
        reason="$(printf 'Session cost ~$%.2f >= limit $%.2f. Stopped by limit-usage.' "$used" "$limit")"
    else
        reason="$(printf '%s usage %.2f%% >= limit %.2f%%. Stopped by limit-usage.%s' "$label" "$used" "$limit" "$resets")"
    fi
    jq -nc --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
}

# Where set writes: --global, else this session, else global (so it still works
# when invoked without a session id).
target_section() {
    if [[ "$1" == global ]]; then
        echo "global"
    elif [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
        echo "session.${CLAUDE_SESSION_ID}"
    else
        echo "global"
    fi
}

# Accepts one or more "<window> <value>" pairs, e.g. `set 5h 80 7d 90`.
# The skill normalizes friendlier input (5h=80, set omitted) into this form.
# All pairs are validated before any is written, so a bad pair never leaves a
# partial update.
set_limit() {
    local scope=session
    local args=()
    for a in "$@"; do
        case "$a" in
            --global) scope=global ;;
            *) args+=("$a") ;;
        esac
    done

    (( ${#args[@]} >= 2 && ${#args[@]} % 2 == 0 )) || {
        echo "Error: expected <window> <value> pair(s), e.g. set 5h 80 7d 90 (got '${args[*]}')" >&2
        exit 1
    }

    # First pass: validate every pair and collect resolved suffixes/values.
    local suffixes=() vals=() wins=()
    local i win val suffix
    for (( i = 0; i < ${#args[@]}; i += 2 )); do
        win="${args[i]}"
        val="${args[i+1]}"
        suffix="$(window_key "$win")"
        [[ -z "$suffix" ]] && { echo "Error: window must be 5h, 7d, or cost (got '${win}')" >&2; exit 1; }
        val="${val#\$}"; val="${val%\%}"
        [[ "$val" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "Error: value must be a number (got '${val}')" >&2; exit 1; }
        # cost is per-session only (the cost figure doesn't accumulate across
        # sessions), so a global cost limit can't be meaningful.
        [[ "$suffix" == usd && "$scope" == global ]] && { echo "Error: cost is per-session; --global is not allowed for cost" >&2; exit 1; }
        wins+=("$win"); suffixes+=("$suffix"); vals+=("$val")
    done

    # Second pass: write them all. cost is a USD amount, the rest are percents.
    local section
    section="$(target_section "$scope")"
    mkdir -p "$STATE_DIR"
    local out=()
    for (( i = 0; i < ${#suffixes[@]}; i++ )); do
        git config -f "$STATE_FILE" "${section}.limit-${suffixes[i]}" "${vals[i]}" \
            || { echo "Error: failed to write threshold (${section}.limit-${suffixes[i]})" >&2; exit 1; }
        if [[ "${suffixes[i]}" == usd ]]; then
            out+=("${wins[i]}=\$${vals[i]}")
        else
            out+=("${wins[i]}=${vals[i]}%")
        fi
    done
    echo "Set ${out[*]} (${scope})."
}

# Remove every threshold that could be in effect for this session: whatever is
# set under this session's section AND whatever is set globally. Reports only
# the keys that actually existed, so the user sees what was cleared.
clear_limits() {
    local cleared=()
    local section suffix val
    for section in ${CLAUDE_SESSION_ID:+"session.${CLAUDE_SESSION_ID}"} global; do
        for suffix in 5h 7d usd; do
            val="$(cfg_get "${section}.limit-${suffix}")"
            [[ -z "$val" ]] && continue
            git config -f "$STATE_FILE" --unset "${section}.limit-${suffix}" 2>/dev/null || true
            if [[ "$suffix" == usd ]]; then
                cleared+=("${section}.limit-${suffix}=\$${val}")
            else
                cleared+=("${section}.limit-${suffix}=${val}%")
            fi
        done
    done
    if (( ${#cleared[@]} == 0 )); then
        echo "No thresholds were set; nothing to clear."
    else
        echo "Cleared ${#cleared[@]} threshold(s): ${cleared[*]}"
    fi
}

status() {
    echo "limit-usage status"
    echo ""

    # Thresholds: 5h/7d can be set per-session and/or globally (session wins;
    # see resolve_limit), cost is session-only. Show each scope's own value so
    # it's clear where a limit lives and which one is in effect.
    local s5 g5 s7 g7 sc
    if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
        s5="$(cfg_get "session.${CLAUDE_SESSION_ID}.limit-5h")"
        s7="$(cfg_get "session.${CLAUDE_SESSION_ID}.limit-7d")"
        sc="$(cfg_get "session.${CLAUDE_SESSION_ID}.limit-usd")"
    fi
    g5="$(cfg_get global.limit-5h)"
    g7="$(cfg_get global.limit-7d)"
    echo "Thresholds:"
    echo "  5h limit:   $(threshold_line "$s5" "$g5" %)"
    echo "  7d limit:   $(threshold_line "$s7" "$g7" %)"
    echo "  cost limit: $(threshold_line "$sc" "" '$')"
    echo ""
    if [[ -f "$STATE_FILE" ]]; then
        local now; now="$(date +%s)"
        local five seven gepoch cost
        five="$(cfg_get global.used-5h)"
        seven="$(cfg_get global.used-7d)"
        gepoch="$(cfg_get global.epoch)"
        cost="$(cfg_get "session.${CLAUDE_SESSION_ID:-_}.used-usd")"

        # Round for display to match deny(): percentages to 2 decimals, cost to
        # cents. The captured figures carry full float precision (e.g.
        # 38.52632265000001), which is noise here. Non-numeric (missing) falls
        # through to "?".
        local num='^[0-9]+([.][0-9]+)?$'
        local five_disp="${five:-?}" seven_disp="${seven:-?}"
        [[ "$five" =~ $num ]]  && five_disp="$(printf '%.2f' "$five")"
        [[ "$seven" =~ $num ]] && seven_disp="$(printf '%.2f' "$seven")"

        # One snapshot age for the whole block, on the header. We use the global
        # (5h/7d) epoch; cost lands in the same snapshot, so its age isn't worth
        # tracking separately.
        echo "Current usage$(age_header "$gepoch" "$now"):"
        echo "  5h used:   ${five_disp}%"
        echo "  7d used:   ${seven_disp}%"
        if [[ "$cost" =~ $num ]]; then
            echo "  cost:      ~$(printf '$%.2f' "$cost") (approx, this session)"
        else
            echo "  cost:      (none this session)"
        fi
        # No quota snapshot at all means this plan has no 5h/7d quota to report —
        # set a cost limit instead. (It can also just mean the first response
        # hasn't carried them yet, so phrase it as a hint, not a fact.)
        if [[ -z "$gepoch" ]]; then
            echo ""
            echo "  Note: no 5h/7d usage reported — if your plan has no usage quota, use a cost limit (/limit-usage cost=5)."
        fi
    else
        echo "Current usage:"
        echo "  (no snapshot yet — run install and let one response go by)"
    fi
    return 0
}

# One threshold row, listing whichever scopes hold a value as
# "<val> <scope>" joined by "; " (e.g. "90% session; 70% global"). Takes the
# session value, the global value (empty for cost), and the unit ('%' or '$').
# Session is listed first since it wins; an absent scope is omitted; nothing set
# prints "(not set)".
threshold_line() {
    local sval="$1" gval="$2" unit="$3" fmt parts=()
    [[ "$unit" == '$' ]] && fmt='$%s' || fmt='%s%%'
    [[ -n "$sval" ]] && parts+=("$(printf "$fmt" "$sval") session")
    [[ -n "$gval" ]] && parts+=("$(printf "$fmt" "$gval") global")
    if (( ${#parts[@]} == 0 )); then
        printf '(not set)'
    else
        local out="${parts[0]}" i
        for (( i = 1; i < ${#parts[@]}; i++ )); do out+="; ${parts[i]}"; done
        printf '%s' "$out"
    fi
}

# install/uninstall manage only the wrapper copy under CLAUDE_PLUGIN_DATA. The
# setup skill owns settings.json: it wraps the current statusLine.command on
# install and strips the wrapper back off on uninstall. We deliberately do NOT
# remember the original command — the skill reads the live command and unwraps
# it, so a statusLine the user edited after install is respected.

install() {
    # Copy the wrapper into CLAUDE_PLUGIN_DATA (a version-stable dir) and print
    # its path. statusLine can't expand ${CLAUDE_PLUGIN_ROOT}, and the cache path
    # is versioned (breaks on update), so the skill bakes THIS path into
    # settings.json. Re-run install after an update to refresh the copy.
    local src="${CLAUDE_PLUGIN_ROOT:-}/bin/statusline-wrapper.sh"
    if [[ -z "${CLAUDE_PLUGIN_DATA:-}" || ! -f "$src" ]]; then
        echo "ERROR: CLAUDE_PLUGIN_DATA unset or wrapper not found at ${src}" >&2
        exit 1
    fi
    local wrapper="$CLAUDE_PLUGIN_DATA/statusline-wrapper.sh"
    mkdir -p "$CLAUDE_PLUGIN_DATA" "$STATE_DIR"
    cp "$src" "$wrapper"
    chmod +x "$wrapper"

    # Migration: drop any pre-unification snapshot files. They are never read by
    # this guard; leaving them only risks confusing a future reader and keeps the
    # stale-wrapper warning firing. (Thresholds in cc-limit-usage.conf are kept.)
    for f in "${LEGACY_FILES[@]}"; do rm -f "$f" 2>/dev/null || true; done

    echo "WRAPPER_PATH"
    echo "$wrapper"
}

uninstall() {
    # Only remove the copied wrapper. The skill restores settings.json by
    # unwrapping the live command. Idempotent: a missing wrapper is fine.
    [[ -n "${CLAUDE_PLUGIN_DATA:-}" ]] && rm -f "$CLAUDE_PLUGIN_DATA/statusline-wrapper.sh" 2>/dev/null || true
    echo "WRAPPER_REMOVED"
}

case "${1:-check}" in
    check)     check ;;
    set)       clear_stale_lock; gc_sessions; warn_if_stale_wrapper; shift; set_limit "$@" ;;
    clear)     clear_stale_lock; gc_sessions; warn_if_stale_wrapper; clear_limits ;;
    status)    clear_stale_lock; gc_sessions; warn_if_stale_wrapper; status ;;
    install)   install ;;
    uninstall) uninstall ;;
    *)
        echo "Usage: $0 {check|set 5h|7d|cost N [--global]|clear|status|install|uninstall}" >&2
        exit 1
        ;;
esac

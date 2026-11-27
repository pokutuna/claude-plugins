#!/bin/bash
# side-fork.sh - Open a forked Claude session in a new herdr workspace/tab or tmux/screen window
#
# Usage:
#   side-fork.sh <session_id> [--tab]
#
# Under herdr, the fork opens in a new workspace by default, or in a new tab of
# the current workspace with --tab. tmux and screen ignore --tab.

set -euo pipefail

get_session_cwd() {
    local config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
    local transcript
    transcript=$(find "${config_dir}/projects" -name "${1}.jsonl" 2>/dev/null | head -1)
    [[ -n "$transcript" ]] && grep -m1 '"cwd"' "$transcript" | jq -r '.cwd // empty'
}

# herdr is checked first because it is the inner multiplexer when both are used.
detect_terminal() {
    [[ "${HERDR_ENV:-}" == 1 ]] && command -v herdr &>/dev/null && { echo herdr; return; }
    [[ -n "${TMUX:-}" ]] && { echo tmux; return; }
    [[ -n "${STY:-}" ]]  && { echo screen; return; }
}

# Create a herdr workspace (or a tab with --tab) and run the command in its root pane.
open_herdr() {
    local cwd="$1" cmd="$2" created pane
    if [[ "$TAB" == 1 ]]; then
        created=$(herdr tab create --workspace "${HERDR_WORKSPACE_ID:?HERDR_WORKSPACE_ID is not set}" --cwd "$cwd" --focus)
    else
        created=$(herdr workspace create --cwd "$cwd" --focus)
    fi
    pane=$(jq -r '.result.root_pane.pane_id // empty' <<<"$created")
    [[ -z "$pane" ]] && { echo "side-fork: could not read the new pane ID from herdr: ${created}" >&2; exit 1; }
    herdr pane run "$pane" "$cmd" >/dev/null
}

open_new_window() {
    case "$1" in
        herdr)  open_herdr "$2" "$3" ;;
        tmux)   tmux new-window -c "$2" "$3" ;;
        screen) screen -X screen bash -c "cd '$2' && $3" ;;
    esac
}

SESSION_ID=""
TAB=0
for arg in "$@"; do
    case "$arg" in
        --tab) TAB=1 ;;
        -*)    echo "side-fork: unknown option: $arg" >&2; exit 1 ;;
        *)     SESSION_ID="$arg" ;;
    esac
done
[[ -z "$SESSION_ID" ]] && { echo "Usage: side-fork.sh <session_id> [--tab]" >&2; exit 1; }

TERMINAL=$(detect_terminal)
CWD=$(get_session_cwd "$SESSION_ID" || true)
if [[ -z "$CWD" ]]; then
    echo "side-fork: transcript not found for session ${SESSION_ID}, falling back to current directory"
    CWD="$PWD"
fi

if [[ -z "$TERMINAL" ]]; then
    echo "side-fork: unsupported terminal (herdr, tmux or screen required)" >&2
    echo "Run manually: cd '$CWD' && claude --resume ${SESSION_ID} --fork-session" >&2
    exit 1
fi

BANNER="Forked from SessionID: ${SESSION_ID}\nTo resume the original: claude --resume ${SESSION_ID}"
open_new_window "$TERMINAL" "$CWD" "printf '%b\n' '${BANNER}' && claude --resume ${SESSION_ID} --fork-session"

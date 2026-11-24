#!/usr/bin/env bash
# Play a bell sound corresponding to the current herdr tab position or tmux window index.
# Falls back to bell_0.wav if in neither or the index is out of range.
# Supports macOS (afplay) and Linux (paplay, aplay, pw-play).

set -euo pipefail

SOUNDS_DIR="$(cd "$(dirname "$0")/../sounds" && pwd)"
MAX_INDEX=21

# Print the position (1-based) of this pane's herdr tab, counted across all
# workspaces in sidebar order. This matches a tmux window index, where every
# window in the session gets its own number.
# HERDR_TAB_ID is fixed when the pane starts and goes stale if the pane is
# moved, so look up the pane's current tab first.
herdr_tab_index() {
    command -v jq &>/dev/null || return 1
    local tab
    tab=$(herdr pane get "$HERDR_PANE_ID" 2>/dev/null | jq -r '.result.pane.tab_id // empty')
    [ -n "$tab" ] || return 1
    # `herdr tab list` returns tabs in on-screen order within each workspace.
    # A tab's `number` field is not its position, so use the list order instead.
    jq -n -r --arg t "$tab" \
        --argjson ws "$(herdr workspace list 2>/dev/null)" \
        --argjson tabs "$(herdr tab list 2>/dev/null)" '
        ($ws.result.workspaces | map({key: .workspace_id, value: .number}) | from_entries) as $wsnum
        | $tabs.result.tabs
        | to_entries
        | sort_by($wsnum[.value.workspace_id], .key)
        | map(.value.tab_id)
        | index($t) // empty
        | . + 1'
}

# Determine the window index: herdr tab position, then tmux window index.
# herdr is checked first because it is the inner multiplexer when both are used.
INDEX=""
if [ "${HERDR_ENV:-}" = "1" ] && [ -n "${HERDR_PANE_ID:-}" ] && command -v herdr &>/dev/null; then
    INDEX=$(herdr_tab_index 2>/dev/null || true)
fi
if [ -z "$INDEX" ] && command -v tmux &>/dev/null && [ -n "${TMUX:-}" ] && [ -n "${TMUX_PANE:-}" ]; then
    INDEX=$(tmux display-message -t "$TMUX_PANE" -p '#{window_index}')
fi
INDEX=${INDEX:-0}

# Clamp to valid range
if [ "$INDEX" -gt "$MAX_INDEX" ] 2>/dev/null; then
    INDEX=$MAX_INDEX
fi

WAV="${SOUNDS_DIR}/bell_${INDEX}.wav"
if [ ! -f "$WAV" ]; then
    WAV="${SOUNDS_DIR}/bell_0.wav"
fi

# Play with available command
if command -v afplay &>/dev/null; then
    afplay "$WAV" &
elif command -v paplay &>/dev/null; then
    paplay "$WAV" &
elif command -v pw-play &>/dev/null; then
    pw-play "$WAV" &
elif command -v aplay &>/dev/null; then
    aplay -q "$WAV" &
fi

#!/bin/bash
# allow-until.sh - Time-limited auto-approval control for Claude Code
#
# Overview:
#   Called from PreToolUse hook to auto-approve Bash commands.
#   When enabled, non-dangerous commands are approved without prompts for a specified duration.
#
# State file:
#   ${XDG_STATE_HOME:-~/.local/state}/claude-allow-until.conf  - git-config format, per-session expiry
#
# Usage:
#   allow-until.sh enable [minutes]        - Enable auto-approval (default: 10 minutes)
#   allow-until.sh disable                 - Disable auto-approval
#   allow-until.sh status                  - Show current status
#   allow-until.sh check                   - Hook mode: read JSON from stdin and decide
#   allow-until.sh test-pattern <command>  - Test if a command matches forbidden patterns

set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}"
CONFIG_FILE="$STATE_DIR/claude-allow-until.conf"

require_session_id() {
    if [[ -z "${CLAUDE_SESSION_ID:-}" ]]; then
        echo "Error: CLAUDE_SESSION_ID is not set" >&2
        exit 1
    fi
}

get_section() {
    echo "session.${CLAUDE_SESSION_ID}"
}

# Dangerous command patterns (always require manual approval)
if [[ -n "${SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS:-}" ]]; then
    IFS=';' read -ra DANGEROUS_PATTERNS <<< "$SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS"
else
    DANGEROUS_PATTERNS=(
        'rm .*-(r.*f|f.*r|rf|fr)'
        'mkfs'
        'dd if='
        '\| *sh'
        'git push.*(--force| -f( |$))'
        'git reset --hard'
        'git clean -f'
    )
fi

is_dangerous() {
    local cmd="$1"
    for pattern in "${DANGEROUS_PATTERNS[@]}"; do
        if [[ "$cmd" =~ $pattern ]]; then
            return 0
        fi
    done
    return 1
}

enable_allow() {
    require_session_id
    local minutes="${1:-10}"
    local until_epoch=$(($(date +%s) + minutes * 60))
    mkdir -p "$STATE_DIR"
    git config -f "$CONFIG_FILE" "$(get_section).until" "$until_epoch"
    local until_time=$(date -r "$until_epoch" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$until_epoch" '+%Y-%m-%d %H:%M:%S')
    echo "Auto-approve enabled until $until_time ($minutes minutes)"
}

disable_allow() {
    require_session_id
    git config -f "$CONFIG_FILE" --remove-section "$(get_section)" 2>/dev/null || true
    echo "Auto-approve disabled"
}

show_status() {
    require_session_id
    local until_epoch=$(git config -f "$CONFIG_FILE" "$(get_section).until" 2>/dev/null || echo 0)

    if [[ "$until_epoch" -eq 0 ]]; then
        echo "Auto-approve: disabled"
    else
        local now=$(date +%s)

        if [[ "$now" -lt "$until_epoch" ]]; then
            local remaining=$(( (until_epoch - now) / 60 ))
            local until_time=$(date -r "$until_epoch" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$until_epoch" '+%Y-%m-%d %H:%M:%S')
            echo "Auto-approve: enabled until $until_time ($remaining minutes remaining)"
        else
            echo "Auto-approve: expired"
            git config -f "$CONFIG_FILE" --remove-section "$(get_section)" 2>/dev/null || true
        fi
    fi

    if [[ -n "${SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS:-}" ]]; then
        echo ""
        echo "Forbidden patterns (from SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS):"
    else
        echo ""
        echo "Forbidden patterns (default):"
    fi
    for pattern in "${DANGEROUS_PATTERNS[@]}"; do
        echo "  - $pattern"
    done
}

check_approval() {
    local input=$(cat)

    export CLAUDE_SESSION_ID=$(echo "$input" | jq -r '.session_id // empty')
    [[ -z "$CLAUDE_SESSION_ID" ]] && exit 0

    local command=$(echo "$input" | jq -r '.tool_input.command // empty')
    [[ -z "$command" ]] && exit 0

    # Dangerous commands always require manual approval
    is_dangerous "$command" && exit 0

    local until_epoch=$(git config -f "$CONFIG_FILE" "$(get_section).until" 2>/dev/null || echo 0)
    [[ "$until_epoch" -eq 0 ]] && exit 0

    local now=$(date +%s)
    if [[ "$now" -ge "$until_epoch" ]]; then
        git config -f "$CONFIG_FILE" --remove-section "$(get_section)" 2>/dev/null || true
        exit 0
    fi
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Auto-approved (time-limited mode)"
  }
}
EOF
}

test_pattern() {
    local cmd="${1:-}"
    if [[ -z "$cmd" ]]; then
        echo "Usage: $0 test-pattern <command>" >&2
        exit 1
    fi

    local matched=false
    for pattern in "${DANGEROUS_PATTERNS[@]}"; do
        if [[ "$cmd" =~ $pattern ]]; then
            echo "BLOCKED by pattern: $pattern"
            matched=true
        fi
    done

    if [[ "$matched" == false ]]; then
        echo "ALLOWED (no pattern matched)"
    fi
}

case "${1:-check}" in
    enable)
        enable_allow "${2:-10}"
        ;;
    disable)
        disable_allow
        ;;
    status)
        show_status
        ;;
    check)
        check_approval
        ;;
    test-pattern)
        shift
        test_pattern "$*"
        ;;
    *)
        echo "Usage: $0 {enable [minutes]|disable|status|check|test-pattern <command>}" >&2
        exit 1
        ;;
esac

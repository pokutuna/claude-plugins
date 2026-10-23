#!/usr/bin/env bats

# Test suite for guard.sh + statusline-wrapper.sh
# Run: bats limit-usage/test/limit-usage.bats
#
# State is one git-config file (cc-limit-usage.conf), sectioned by scope:
#   [global]  used-5h/used-7d/reset-*/epoch/schema (wrapper), limit-5h/7d (set --global)
#   [session "<id>"]  used-usd/epoch (wrapper), limit-5h/7d/usd (set)

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
GUARD="$SCRIPT_DIR/bin/guard.sh"
WRAPPER="$SCRIPT_DIR/bin/statusline-wrapper.sh"

setup() {
  export XDG_STATE_HOME="$BATS_TEST_TMPDIR/state"
  mkdir -p "$XDG_STATE_HOME"
  STATE_FILE="$XDG_STATE_HOME/cc-limit-usage.conf"
}

teardown() {
  rm -rf "$BATS_TEST_TMPDIR/state"
}

# --- helpers ---

# Feed the statusLine wrapper a JSON blob (as Claude Code would on stdin).
wrap() { printf '%s' "$1" | "$WRAPPER" >/dev/null; }

# Run the PreToolUse guard for session $1 (optional command in $2).
check() {
  local sid="$1" cmd="${2:-ls}"
  jq -nc --arg s "$sid" --arg c "$cmd" '{session_id:$s, tool_input:{command:$c}}' | "$GUARD" check
}

# guard.sh set/clear/status with CLAUDE_SESSION_ID in env (as the skill passes it).
guard() { CLAUDE_SESSION_ID="$1" "$GUARD" "${@:2}"; }

# Read a key from the unified state file.
state() { git config -f "$STATE_FILE" "$1" 2>/dev/null; }

# A deny decision carrying $1 in the reason.
assert_denied_with() {
  echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null
  [[ "$output" == *"$1"* ]]
}

# --- set / validation ---

@test "set 5h writes a session limit-5h threshold" {
  run guard S set 5h 80
  [ "$status" -eq 0 ]
  [[ "$output" == *"5h=80%"* ]]
  [ "$(state session.S.limit-5h)" = "80" ]
}

@test "set accepts multiple windows and strips \$ / %" {
  run guard S set 5h 80% 7d 90 cost '$5'
  [ "$status" -eq 0 ]
  [ "$(state session.S.limit-5h)" = "80" ]
  [ "$(state session.S.limit-7d)" = "90" ]
  [ "$(state session.S.limit-usd)" = "5" ]
}

@test "set 5h --global writes to global" {
  run guard S set 5h 80 --global
  [ "$status" -eq 0 ]
  [ "$(state global.limit-5h)" = "80" ]
}

@test "set cost --global is rejected (cost is per-session)" {
  run guard S set cost 5 --global
  [ "$status" -eq 1 ]
  [[ "$output" == *"per-session"* ]]
}

@test "set rejects an unknown window" {
  run guard S set foo 5
  [ "$status" -eq 1 ]
  [[ "$output" == *"must be 5h, 7d, or cost"* ]]
}

@test "set rejects a non-numeric value" {
  run guard S set 5h abc
  [ "$status" -eq 1 ]
  [[ "$output" == *"must be a number"* ]]
}

# --- check: rate windows ---

@test "5h over the limit denies" {
  guard S set 5h 80 >/dev/null
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":82,"resets_at":1780417800}}}'
  run check S
  assert_denied_with "5h usage 82.00% >= limit 80.00%"
}

@test "5h under the limit allows" {
  guard S set 5h 90 >/dev/null
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":82}}}'
  run check S
  [ -z "$output" ]
}

@test "only 7d present denies on 7d, not 5h (no field shift)" {
  guard S set 5h 80 7d 90 >/dev/null
  wrap '{"session_id":"S","rate_limits":{"seven_day":{"used_percentage":95,"resets_at":1780999999}}}'
  run check S
  assert_denied_with "7d usage 95.00% >= limit 90.00%"
}

# --- check: cost ---

@test "cost over the limit denies with a ~ approximate marker" {
  guard S set cost 5 >/dev/null
  wrap '{"session_id":"S","cost":{"total_cost_usd":6.2}}'
  run check S
  assert_denied_with 'Session cost ~$6.20 >= limit $5.00'
}

@test "cost under the limit allows" {
  guard S set cost 5 >/dev/null
  wrap '{"session_id":"S","cost":{"total_cost_usd":4.5}}'
  run check S
  [ -z "$output" ]
}

# --- the reason this design exists: per-session cost isolation ---

@test "concurrent sessions each see only their own cost" {
  guard SA set cost 5 >/dev/null   # API session
  guard SB set cost 2 >/dev/null   # other session
  wrap '{"session_id":"SA","cost":{"total_cost_usd":4.5}}'
  wrap '{"session_id":"SB","cost":{"total_cost_usd":0.8}}'

  # SA: own cost 4.5 < 5 -> allow (must NOT read SB's 0.8 or be tripped by it)
  run check SA
  [ -z "$output" ]
  # SB: own cost 0.8 < 2 -> allow
  run check SB
  [ -z "$output" ]

  # SA spends more; SB must stay unaffected.
  wrap '{"session_id":"SA","cost":{"total_cost_usd":5.2}}'
  run check SA
  assert_denied_with 'Session cost ~$5.20'
  run check SB
  [ -z "$output" ]
}

@test "rate_limits are account-wide: written by one session, seen by another" {
  guard SB set 5h 80 --global >/dev/null
  # SA's response carries the account-wide rate snapshot (-> [global]).
  wrap '{"session_id":"SA","rate_limits":{"five_hour":{"used_percentage":85,"resets_at":1780417800}},"cost":{"total_cost_usd":1.0}}'
  run check SB
  assert_denied_with "5h usage 85.00% >= limit 80.00%"
}

@test "session 5h limit is checked against global used-5h (cross-scope, global epoch)" {
  # Threshold in the session scope; measurement is account-wide in [global].
  guard S set 5h 80 >/dev/null
  wrap '{"session_id":"OTHER","rate_limits":{"five_hour":{"used_percentage":90}}}'
  run check S
  assert_denied_with "5h usage 90.00% >= limit 80.00%"
}

# --- fail-open ---

@test "no state file -> allow" {
  guard S set 5h 50 >/dev/null   # this creates the file with only a threshold
  rm -f "$STATE_FILE"
  run check S
  [ -z "$output" ]
}

@test "threshold set but no usage snapshot -> allow" {
  guard S set 5h 50 >/dev/null
  run check S
  [ -z "$output" ]
}

@test "stale snapshot -> allow" {
  guard S set 5h 50 >/dev/null
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":99}}}'
  run env LIMIT_USAGE_STALE_SECONDS=-1 bash -c "jq -nc '{session_id:\"S\",tool_input:{command:\"ls\"}}' | '$GUARD' check"
  [ -z "$output" ]
}

@test "no threshold set -> allow even when usage is high" {
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":99}},"cost":{"total_cost_usd":999}}'
  run check S
  [ -z "$output" ]
}

@test "self-deadlock escape: a command containing guard.sh is always allowed" {
  guard S set 5h 1 >/dev/null
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":99}}}'
  run check S "some/path/guard.sh status"
  [ -z "$output" ]
}

@test "corrupt state file -> check stays silent (fail-open invariant)" {
  # Garbage that is not valid git-config. check must never deny on internal error.
  printf 'not a valid [[[ git config @@@\n=== garbage\n' > "$STATE_FILE"
  run check S
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "non-numeric measured value -> allow (garbage is not over the limit)" {
  guard S set 5h 50 >/dev/null
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":40}}}'
  # Corrupt the measured value after the fact; keep the epoch fresh.
  git config -f "$STATE_FILE" global.used-5h "garbage"
  run check S
  [ -z "$output" ]
}

# --- clear ---

@test "clear wipes session and global thresholds and reports them" {
  guard S set 5h 80 7d 90 >/dev/null
  guard S set cost 3 >/dev/null
  guard S set 7d 95 --global >/dev/null
  run guard S clear
  [ "$status" -eq 0 ]
  [[ "$output" == *"limit-usd=\$3"* ]]
  [ -z "$(state session.S.limit-5h)" ]
  [ -z "$(state global.limit-7d)" ]
}

@test "clear with nothing set says so" {
  run guard S clear
  [[ "$output" == *"nothing to clear"* ]]
}

# --- status ---

@test "status shows the cost hint when no rate snapshot is present" {
  wrap '{"session_id":"API1","cost":{"total_cost_usd":3.5}}'
  run guard API1 status
  [[ "$output" == *"cost:      ~\$3.5"* ]]
  [[ "$output" == *"Note: no 5h/7d usage reported"* ]]
}

@test "status shows rate usage and no cost hint when rate is present" {
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":42}}}'
  run guard S status
  [[ "$output" == *"5h used:   42.00%"* ]]
  [[ "$output" != *"Note: no 5h/7d usage reported"* ]]
}

@test "status rounds noisy floats: cost to cents, percentages to 2 decimals" {
  # The captured figures carry full float precision; status must not echo it raw.
  wrap '{"session_id":"S","cost":{"total_cost_usd":38.52632265000001},"rate_limits":{"five_hour":{"used_percentage":26.7531},"seven_day":{"used_percentage":48.2}}}'
  run guard S status
  [[ "$output" == *"cost:      ~\$38.53"* ]]
  [[ "$output" != *"38.52632265"* ]]
  [[ "$output" == *"5h used:   26.75%"* ]]
  [[ "$output" == *"7d used:   48.20%"* ]]
}

@test "status states the snapshot age once on the Current usage header" {
  # The age comes from the global (5h/7d) epoch and labels the whole block; the
  # rows themselves stay clean (no per-line "(Ns)" note).
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":35},"seven_day":{"used_percentage":3}},"cost":{"total_cost_usd":0.31}}'
  run guard S status
  [[ "$output" == *"Current usage ("*"s ago):"* ]]
  [[ "$(echo "$output" | grep -E '^  5h used: ')" != *"s)"* ]]
}

@test "status shows threshold scope: session, global, and session-over-global" {
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":10}}}'
  guard S set 5h 80 >/dev/null            # session-only
  guard S set 7d 90 --global >/dev/null   # global-only
  guard S set cost 5 >/dev/null           # session (cost is session-only)
  run guard S status
  [[ "$output" == *"5h limit:   80% session"* ]]
  [[ "$output" == *"7d limit:   90% global"* ]]
  [[ "$output" == *"cost limit: \$5 session"* ]]
}

@test "status shows a session 5h override sitting on top of a global value" {
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":10}}}'
  guard S set 5h 70 --global >/dev/null   # global
  guard S set 5h 90 >/dev/null            # session override
  run guard S status
  [[ "$output" == *"5h limit:   90% session; 70% global"* ]]
}

@test "status shows (not set) for an unset threshold" {
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":10}}}'
  run guard S status
  [[ "$output" == *"5h limit:   (not set)"* ]]
  [[ "$output" == *"cost limit: (not set)"* ]]
}

# --- garbage collection of ended sessions ---

@test "set/clear/status GC sessions older than the GC window" {
  # A live session's cost snapshot and an ancient one.
  wrap '{"session_id":"LIVE","cost":{"total_cost_usd":1.0}}'
  git config -f "$STATE_FILE" session.OLD.used-usd 9
  git config -f "$STATE_FILE" session.OLD.epoch 1   # epoch 1 = ancient
  guard LIVE status >/dev/null
  # OLD is swept; LIVE survives (jq stores 1.0 as the number 1).
  [ -z "$(state session.OLD.used-usd)" ]
  [ "$(state session.LIVE.used-usd)" = "1" ]
}

# --- orphaned git config lock ---

@test "wrapper removes an orphaned lock and writes the snapshot" {
  touch -t 202001010000 "$STATE_FILE.lock"
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":42}}}'
  [ ! -e "$STATE_FILE.lock" ]
  [ "$(state global.used-5h)" = "42" ]
}

@test "set removes an orphaned lock and writes the threshold" {
  touch -t 202001010000 "$STATE_FILE.lock"
  run guard S set 5h 80
  [ "$status" -eq 0 ]
  [ "$(state session.S.limit-5h)" = "80" ]
}

@test "a fresh lock is left alone (a live writer may hold it)" {
  touch "$STATE_FILE.lock"
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":42}}}'
  [ -e "$STATE_FILE.lock" ]
  [ -z "$(state global.used-5h)" ]
}

# --- stale-wrapper detection (schema generation) ---

@test "current wrapper snapshot triggers no stale warning" {
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":10}}}'
  run guard S status
  [ "$status" -eq 0 ]
  [[ "$output" != *"looks outdated"* ]]
}

@test "a lingering legacy snapshot file triggers the stale warning" {
  wrap '{"session_id":"S","rate_limits":{"five_hour":{"used_percentage":10}}}'
  : > "$XDG_STATE_HOME/cc-limit-usage-rate.json"   # pre-unification snapshot left behind
  run guard S status
  [[ "$output" == *"looks outdated"* ]] || \
    { echo "$output" | grep -q "looks outdated"; }  # warning goes to stderr; run merges it
}

@test "no snapshot and no legacy file -> no warning (not installed yet)" {
  run guard S status
  [[ "$output" != *"looks outdated"* ]]
}

# --- install / uninstall (guard manages only the wrapper copy) ---

@test "install copies the wrapper and prints its path" {
  export CLAUDE_PLUGIN_ROOT="$SCRIPT_DIR"
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data"
  run "$GUARD" install
  [ "$status" -eq 0 ]
  [[ "$output" == *"WRAPPER_PATH"* ]]
  [[ "$output" == *"$CLAUDE_PLUGIN_DATA/statusline-wrapper.sh"* ]]
  [ -x "$CLAUDE_PLUGIN_DATA/statusline-wrapper.sh" ]
}

@test "install removes a pre-unification legacy snapshot file" {
  export CLAUDE_PLUGIN_ROOT="$SCRIPT_DIR"
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data"
  : > "$XDG_STATE_HOME/cc-limit-usage-rate.json"
  : > "$XDG_STATE_HOME/cc-limit-usage-rate.conf"
  run "$GUARD" install
  [ ! -f "$XDG_STATE_HOME/cc-limit-usage-rate.json" ]
  [ ! -f "$XDG_STATE_HOME/cc-limit-usage-rate.conf" ]
}

@test "uninstall removes the wrapper copy" {
  export CLAUDE_PLUGIN_ROOT="$SCRIPT_DIR"
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data"
  "$GUARD" install >/dev/null
  run "$GUARD" uninstall
  [ "$status" -eq 0 ]
  [[ "$output" == *"WRAPPER_REMOVED"* ]]
  [ ! -f "$CLAUDE_PLUGIN_DATA/statusline-wrapper.sh" ]
}

@test "uninstall is idempotent when nothing is installed" {
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data"
  run "$GUARD" uninstall
  [ "$status" -eq 0 ]
  [[ "$output" == *"WRAPPER_REMOVED"* ]]
}

#!/usr/bin/env bash
# Render an HTML file with headless Chrome and save a tall PNG for visual review.
#
# Usage:
#   screenshot.sh <html-file> [--dark] [--no-network] [--width N] [--height N] [-o out.png]
#
# Defaults: light theme, 1280x4000, output next to the input as
#   <basename>.light.png / <basename>.dark.png
# --dark forces the dark theme by stamping data-theme="dark" on a temporary copy,
# so the result does not depend on the OS setting.
# --no-network blocks every host, to prove an --offline bundle needs nothing from the web.
# A virtual time budget lets async work (Mermaid's ELK layout) finish before the capture.
set -euo pipefail

INPUT=""; DARK=0; NONET=0; WIDTH=1280; HEIGHT=4000; OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dark) DARK=1 ;;
    --no-network) NONET=1 ;;
    --width) WIDTH="$2"; shift ;;
    --height) HEIGHT="$2"; shift ;;
    -o) OUT="$2"; shift ;;
    -*) echo "unknown option: $1" >&2; exit 64 ;;
    *) INPUT="$1" ;;
  esac
  shift
done
[[ -n "$INPUT" && -f "$INPUT" ]] || { echo "usage: $0 <html-file> [--dark] [--no-network] [--width N] [--height N] [-o out.png]" >&2; exit 64; }

for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)"; do
  [[ -n "$c" && -x "$c" ]] && CHROME="$c" && break
done
[[ -n "${CHROME:-}" ]] || { echo "Chrome / Chromium not found" >&2; exit 69; }

DIR="$(cd "$(dirname "$INPUT")" && pwd)"
BASE="$(basename "$INPUT" .html)"
THEME=light; [[ $DARK -eq 1 ]] && THEME=dark
[[ -n "$OUT" ]] || OUT="$DIR/$BASE.$THEME.png"

TARGET="$DIR/$(basename "$INPUT")"
TMP=""
if [[ $DARK -eq 1 ]]; then
  # Same directory so relative references keep working
  TMP="$DIR/.$BASE.dark-shot.html"
  perl -0pe 's/<html\b([^>]*)>/<html$1 data-theme="dark">/' "$TARGET" > "$TMP"
  TARGET="$TMP"
fi
trap '[[ -n "$TMP" ]] && rm -f "$TMP"' EXIT

EXTRA=()
[[ $NONET -eq 1 ]] && EXTRA+=(--host-resolver-rules="MAP * ~NOTFOUND")
PROFILE="$(mktemp -d)"
rm -f "$OUT"
# Chrome does not always exit after writing the screenshot; wait for the file, then stop it.
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$PROFILE" \
  --window-size="${WIDTH},${HEIGHT}" \
  --timeout=8000 --virtual-time-budget=10000 ${EXTRA[@]+"${EXTRA[@]}"} \
  --screenshot="$OUT" "file://$TARGET" >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 60); do
  [[ -s "$OUT" ]] && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
sleep 0.5
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
rm -rf "$PROFILE"
[[ -s "$OUT" ]] || { echo "screenshot failed" >&2; exit 1; }
echo "$OUT"

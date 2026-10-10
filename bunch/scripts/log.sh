#!/bin/sh
# Append a timestamped entry to the Timeline / Work Log of a bunch document.
set -eu

usage() {
  cat <<'USAGE'
Usage: log.sh <document> <<'EOF'
<first line>
<more lines>
EOF

Append an entry to the end of <document>, whose last section must be
"## Timeline" or "## Work Log". The entry is read from stdin.

- The first line becomes "- <yyyy-mm-dd hh:mm> <first line>".
- The time is the machine's local time, even when TZ is set (e.g. to UTC).
- The other lines are indented by 2 spaces, nesting them under the first line.
- Quote the delimiter (<<'EOF') so the shell does not expand ` and $ in the text.

Options:
  -h, --help  Show this help.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac
if [ $# -ne 1 ]; then
  usage >&2
  exit 2
fi
file="$1"

if [ ! -f "$file" ]; then
  echo "log.sh: no such file: $file" >&2
  exit 1
fi

# Entries are appended to the end of the file, so the log section must be the last one.
last_heading=$(awk '/^## /{h=$0} END{print h}' "$file")
case "$last_heading" in
  "## Timeline" | "## Work Log") ;;
  *)
    echo "log.sh: the last section of $file is '${last_heading:-(none)}', not '## Timeline' or '## Work Log'" >&2
    exit 1
    ;;
esac

# Drop leading and trailing blank lines of the body.
body=$(awk 'NF{started=1} started' | sed -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}')
if [ -z "$body" ]; then
  echo "log.sh: empty entry; pass the text on stdin" >&2
  exit 1
fi

# Use the machine's local time even when TZ is set (e.g. to UTC).
unset TZ
stamp=$(date '+%Y-%m-%d %H:%M')
entry=$(printf '%s\n' "$body" | awk -v stamp="$stamp" '
  NR == 1 { print "- " stamp " " $0; next }
  /^[[:space:]]*$/ { print ""; next }
  { print "  " $0 }
')

# Keep the list tight: no blank line between the previous entry and this one.
if [ -n "$(tail -n 1 "$file" | tr -d '[:space:]')" ]; then
  # Last line has content; add the missing final newline if there is none.
  [ -n "$(tail -c 1 "$file")" ] && printf '\n' >>"$file"
  printf '%s\n' "$entry" >>"$file"
else
  # Trailing blank lines: rewrite in place (keeps the inode, so symlinks stay intact).
  content=$(sed -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}' "$file")
  printf '%s\n%s\n' "$content" "$entry" >"$file"
fi

printf '%s\n' "$entry"

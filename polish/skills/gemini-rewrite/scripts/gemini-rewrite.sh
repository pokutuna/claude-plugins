#!/usr/bin/env bash
# Have Gemini rewrite a file, or the documents under a directory, in place through pi,
# print Gemini's summary of the changes, and print the session ID ("session: <ID>") to stderr.
#
# Usage: gemini-rewrite.sh [options] PATH [INSTRUCTION]
#        gemini-rewrite.sh --session ID [options] PATH MESSAGE
#        gemini-rewrite.sh --check [options]
#
#   -s, --session ID       Resume the session ID printed by an earlier run on the same PATH,
#                          and send MESSAGE (for example, review feedback) to it.
#       --style NAME       How to rewrite: clarify or concise, from assets/styles/NAME.md
#                          (default: clarify). New sessions only; a resumed session keeps its style.
#       --check            Check that srt sandboxes commands, then send the model a one-line
#                          prompt with the same settings. Exits non-zero if either fails.
#   -m, --model MODEL      pi model pattern, optionally "provider/id" or "id:thinking"
#                          (default: $GEMINI_REWRITE_MODEL or gemini-4-argon)
#       --provider NAME    google (Gemini API) or google-vertex (Vertex AI)
#                          (default: pi picks one with credentials)
#   -t, --thinking LEVEL   off|minimal|low|medium|high|xhigh|max
#                          (default: medium)
#       --project ID       GCP project for Vertex AI with ADC (sets GOOGLE_CLOUD_PROJECT)
#       --location LOC     Vertex AI location (sets GOOGLE_CLOUD_LOCATION)
#
# pi runs in the directory of PATH (or in PATH itself if it is a directory), so it loads
# the AGENTS.md and CLAUDE.md files there and in parent directories. It does not load the
# user's extensions, skills, prompt templates, MCP servers, or project-local .pi settings.
# guard.ts lets Gemini read under the repository root (or the directory of PATH outside a
# repository) and edit only PATH, and runs its bash commands inside srt (sandbox-runtime)
# with the same limits and no network. Requires srt: npm install -g @anthropic-ai/sandbox-runtime
# Sessions are saved by pi; resume one interactively with: cd <dir> && pi --session ID
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
system_prompt_file="${script_dir}/../assets/system-prompt.md"
styles_dir="${script_dir}/../assets/styles"
guard_extension="${script_dir}/guard.ts"

model=${GEMINI_REWRITE_MODEL:-gemini-4-argon}
provider=
thinking=medium
style=clarify
check=false
session=
positional=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) check=true; shift ;;
    --style) style=$2; shift 2 ;;
    -s|--session) session=${2:?--session needs an ID}; shift 2 ;;
    -m|--model) model=$2; shift 2 ;;
    --provider) provider=$2; shift 2 ;;
    -t|--thinking) thinking=$2; shift 2 ;;
    --project) export GOOGLE_CLOUD_PROJECT=$2; shift 2 ;;
    --location) export GOOGLE_CLOUD_LOCATION=$2; shift 2 ;;
    --) shift; positional+=("$@"); break ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) positional+=("$1"); shift ;;
  esac
done

if ! command -v pi >/dev/null 2>&1; then
  echo "pi is not installed. See https://pi.dev for installation." >&2
  exit 127
fi
if ! srt=$(command -v srt); then
  echo "srt is not installed. Run: npm install -g @anthropic-ai/sandbox-runtime" >&2
  exit 127
fi
export GEMINI_REWRITE_SRT=$srt

pi_args=(
  --print --model "$model"
  --no-extensions --no-skills --no-prompt-templates --no-mcp --no-approve
)
if [[ -n "$provider" ]]; then
  pi_args+=(--provider "$provider")
fi

if $check; then
  echo "pi $(pi --version 2>/dev/null) ($(command -v pi))"
  echo "srt $(srt --version 2>/dev/null) (${srt})"
  # Allow writes to one directory only, then confirm a write there succeeds and others fail.
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  mkdir "$tmp/allowed"
  printf '{"filesystem":{"denyRead":[],"allowWrite":["%s"],"denyWrite":[]},"network":{"allowedDomains":[],"deniedDomains":[]}}' \
    "$tmp/allowed" >"$tmp/srt.json"
  if ! output=$(srt -s "$tmp/srt.json" -c "echo ok > '$tmp/allowed/f'" 2>&1); then
    echo "ng: srt could not run a command in the sandbox" >&2
    echo "$output" >&2
    exit 1
  fi
  if srt -s "$tmp/srt.json" -c "echo x > '$tmp/denied'" >/dev/null 2>&1 || [[ -e "$tmp/denied" ]]; then
    echo "ng: srt did not block a write outside the allowed directory" >&2
    exit 1
  fi
  echo "ok: srt sandboxes commands"
  echo "model ${provider:+$provider/}${model}"
  if output=$(pi "${pi_args[@]}" --no-session --no-context-files --thinking minimal --no-tools \
    -- "Reply with OK only." </dev/null 2>&1); then
    echo "ok: the model answered"
  else
    echo "ng: the model did not answer" >&2
    echo "$output" >&2
    echo "Available models: pi --list-models gemini" >&2
    exit 1
  fi
  exit 0
fi

if [[ ${#positional[@]} -lt 1 ]]; then
  echo "usage: $(basename "$0") [options] PATH [INSTRUCTION]" >&2
  exit 2
fi
target=${positional[0]}
instruction=${positional[1]:-}
style_file="${styles_dir}/${style}.md"
if [[ ! -f "$style_file" ]]; then
  echo "unknown style: $style (see ${styles_dir})" >&2
  exit 2
fi

if [[ -d "$target" ]]; then
  cd -- "$target"
  write_scope=$PWD
  subject="the documents under the current directory"
elif [[ -f "$target" ]]; then
  cd -- "$(dirname -- "$target")"
  name=$(basename -- "$target")
  write_scope=$PWD/$name
  subject=$name
else
  echo "not found: $target" >&2
  exit 2
fi
read_scope=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
export GEMINI_REWRITE_READ_SCOPE=$read_scope GEMINI_REWRITE_WRITE_SCOPE=$write_scope

if [[ -n "$session" ]]; then
  if [[ -z "$instruction" ]]; then
    echo "--session needs a MESSAGE to send to the session" >&2
    exit 2
  fi
  session_args=(--session "$session")
  prompt=$instruction
else
  session_args=()
  # The style goes in the first message, so a resumed session keeps it.
  prompt="Rewrite the text in ${subject} and edit in place."$'\n\n'"$(<"$style_file")"
  if [[ -n "$instruction" ]]; then
    prompt+=$'\n\nExtra instructions:\n'"$instruction"
  fi
fi

exec pi "${pi_args[@]}" ${session_args[@]+"${session_args[@]}"} --thinking "$thinking" \
  --append-system-prompt "$system_prompt_file" \
  --extension "$guard_extension" \
  --tools read,edit,write,ls,find,grep,bash \
  -- "$prompt" </dev/null

---
name: things-app
description: Create and update private personal todos in the Things 3 app. "things" などで起動。
argument-hint: "today | inbox | create <title> [...] | update <id> [...] | complete <id>"
compatibility: macOS with Things 3 installed
allowed-tools: "Bash(${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js *)"
---

# Things 3

Read and update tasks in Things 3.
Requires macOS with Things 3 installed.

## Script

All commands use a single executable script. It has a shebang so **always execute it directly** — never prefix with `osascript` or `node`:

```
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js --help
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js <command> [options]
```

`--help` / `-h` prints the full command reference and never executes anything, even after a command (`create --help` is safe). Unknown options and missing arguments fail with exit 1 instead of being treated as a title.

## Typical Workflows

### Inbox の仕分け
1. `inbox` でタスク一覧を取得
2. 各タスクを適切な project/area に振り分け、期日やタグを設定
3. 今日やるものは Today に移動

```bash
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js inbox
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js update "タスクID" --project "プロジェクト名" --when "2026-04-10" --due "2026-04-16"
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js update "タスクID" --area "エリア名" --add-tags "tag1"
```

### Today のタスク処理
1. `today` で今日のタスク一覧を確認し、ユーザーに共有する
2. ユーザーと会話しながらタスクを進め、完了したら `complete` で消化

```bash
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js today
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js complete "タスクID"
```

### タスク作成
1. ユーザーの依頼や会話の中で出てきた TODO を `create` で登録
2. project/area/tags/due を適切に設定して仕分け済みの状態で作る

```bash
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js create "タスク名" --project "プロジェクト名" --when "2026-04-15" --due "2026-04-21"
${CLAUDE_PLUGIN_ROOT}/skills/things-app/scripts/things.js create "タスク名" --area "エリア名" --tags "tag1, tag2" --today
```

## Key Behaviors

- IDs are shown in list output as `[ID: ...]`. Use them for detail/update/status commands. Falls back to name search if ID is not found.
- Default destination for `create` is Inbox. `--project` and `--area` override it.
- `--when YYYY-MM-DD` sets the activation date. The task appears in Today on that date automatically.
- `update` accepts multiple options in a single call. `--area none` removes from area (moves to Inbox).
- Update/status/delete commands modify actual tasks — always confirm with the user before running.
- Paging: use `--offset` and `--limit` for large lists (e.g. inbox).

## Output Format

### List (one-line per task)

```
- タスク名 (Today, When: 2025-01-15, Due: 2025-01-21) #tag1, #tag2 [ID: abc123]
```

- Task name. If title is empty, shows `(note) first 20 chars...` from notes
- Parentheses: Today flag, when date, due date, done/canceled status
- Tags as `#tag`
- `[ID: ...]` for use with detail/update commands

### Detail

```
タスク名

ID: abc123
Status: open
Today: Yes
When: 2025-01-15
Due: 2025-01-21
Tags: #tag1, #tag2
Project: プロジェクト名
Area: エリア名

Notes:
ノート内容
```

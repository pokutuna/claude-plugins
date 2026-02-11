---
name: allow-until
description: 時限式の自動承認モードを有効化する
allowed-tools:
  - Bash(CLAUDE_SESSION_ID=* ${CLAUDE_PLUGIN_ROOT}/bin/allow-until.sh *)
---
時限式の自動承認モードを制御します。

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

## 実行

以下の形式でコマンドを実行:
`CLAUDE_SESSION_ID=${CLAUDE_SESSION_ID} ${CLAUDE_PLUGIN_ROOT}/bin/allow-until.sh <subcommand>`

ARGUMENTS に応じて subcommand を決定:
- 空または "enable" → `enable 10` (10分間有効化)
- "enable N" または数字のみ → `enable N` (N分間有効化)
- "disable" または "off" → `disable`
- "status" → `status`
- "test-pattern <command>" → `test-pattern <command>` (コマンドが禁止パターンにマッチするかテスト)

実行後、結果をユーザーに報告してください。

## 補足

- 環境変数 `SKILLS_ALLOW_UNTIL_FORBIDDEN_PATTERNS` が設定されている場合、デフォルトの危険パターンの代わりにそちらが使われます (セミコロン区切り)
- `status` サブコマンドで現在有効なパターン一覧も確認できます

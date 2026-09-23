---
name: ask-codex
description: Ask OpenAI Codex CLI for an autonomous second AI opinion. "ask codex", "codex と相談" などで起動。
argument-hint: "[target] [focus] [--model NAME] [--effort LEVEL] [-y]"
compatibility: Codex CLI installed and authenticated
allowed-tools:
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/share-path.sh)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/run-codex.sh *)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/wait-codex.sh *)
  - Read
  - AskUserQuestion
---

# Codex CLI

OpenAI Codex CLI に質問や依頼を投げ、独立した AI の意見を得る。
コードレビュー、設計相談、調査、質問など用途を問わない。

このセッションの保存先は、skill 起動時に次を実行して確定する。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/share-path.sh
```

出力の 1 行目が RESULT_FILE (`.md`)、2 行目が TRANSCRIPT_FILE (`.jsonl`)。
以降の手順では上記パスを `--output-last-message` と実行イベントの保存先に指定し、ユーザーへの案内にも使う。

wrapper script は TRANSCRIPT_FILE から派生する 3 つのファイルも生成する。`${TRANSCRIPT_FILE%.jsonl}.log` が stderr ログ (LOG_FILE)、`${TRANSCRIPT_FILE%.jsonl}.exit` が codex の exit code (EXIT_FILE、完了時にのみ書かれる)、`${TRANSCRIPT_FILE%.jsonl}.pid` が codex 本体の PID (PID_FILE)。
wrapper には watchdog が組み込まれており、transcript/log に 20 分間書き込みがない、または実行が 90 分を超えると codex を kill して EXIT_FILE に非 0 を書く。

Codex は Auto 相当の次のオプションで必ず起動する。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/run-codex.sh "<上記 RESULT_FILE>" "<上記 TRANSCRIPT_FILE>" \
  --sandbox workspace-write -c 'approval_policy="on-request"' \
  --model gpt-6-luna -c 'model_reasoning_effort="xhigh"' \
  --color never --json -C "$PWD" "<prompt>"
```

- `--sandbox workspace-write`: ワークスペース内のファイル編集とコマンド実行を許可する
- `approval_policy="on-request"`: ワークスペース外への書き込みやネットワークアクセスなど、sandbox 外の操作だけで承認を求める
- `--model gpt-6-luna`: 使用モデルの既定値
- `model_reasoning_effort="xhigh"`: GPT-5.6 Luna の reasoning effort の既定値
- `--color never`: Claude Code に渡す出力から ANSI エスケープシーケンスを除く
- `--output-last-message`: 最終回答を `RESULT_FILE` に保存する
- `--json`: 実行イベントを JSONL で出力し、`TRANSCRIPT_FILE` に逐次保存する

`--dangerously-bypass-approvals-and-sandbox` と `--sandbox danger-full-access` は使用してはならない。

`RESULT_FILE` と `TRANSCRIPT_FILE` は `$TMPDIR`（未設定時は `/tmp`）配下のタイムスタンプ付きファイルである。前者には最終回答、後者には stdout の JSONL イベントを逐次保存する。Copilot CLI の `--share` のように 1 個の Markdown ファイルへセッション全体をまとめる形式ではない。

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

## Arguments

- **レビュー内容**: `$ARGUMENTS` と会話コンテキストから、対象と観点を判断する
- **オプション**: `--model <model>` と `--effort <level>` で Codex CLI に渡すモデルと reasoning effort を指定する。既定値は `gpt-6-luna` と `xhigh`。利用可能な effort はモデルにより異なる
- **確認スキップ**: `-y` / `--yes`

難しい問題、深い設計検討、複雑なデバッグでは、`gpt-6-sol` と `high` を案内する。例: `/ask-codex <依頼> --model gpt-6-sol --effort high`。既定の Luna Ultra より適切そうな場合は、この指定を提案してよい。

## Instructions

### 1. Build prompt

会話コンテキストと `$ARGUMENTS` から、Codex に渡すプロンプトを日本語で構築する。Codex がワークスペース内のファイルを読んで、必要に応じてコード検索・git コマンド・テスト・編集を自律的に行えるため、Claude が事前に情報を集める必要はない。

プロンプトには「何を聞きたいか」「対象範囲」「注目すべき観点」を明確に含める。たとえば、コードレビューでは対象範囲と性能・セキュリティ・可読性などの観点、設計相談では選択肢と判断基準を伝える。

### 2. Confirm with user

以下の場合は確認をスキップして Step 3 に進んでよい。

- `-y` / `--yes` が指定されている
- `$ARGUMENTS` でレビュー対象と観点が明確に指定されている

それ以外では、必ず `AskUserQuestion` ツールで実行前に確認する。テキストで確認してはならない。

- プロンプトを構築できる場合: 構築した依頼の要約を質問に含め、「このまま実行」「プロンプトを修正」「中止」を選択肢にする
- プロンプトを構築できない場合: まず対象や相談内容を引き出し、プロンプト構築後に改めて確認する

### 3. Run Codex

モデルと reasoning effort は、既定で `--model "gpt-6-luna" -c 'model_reasoning_effort="xhigh"'` を追加する。`--model <model>` または `--effort <level>` が指定されたときは、それぞれの既定値を置き換える。`-y` / `--yes`、`--model`、`--effort` 指定は Codex への依頼本文に含めない。

冒頭で確定した `RESULT_FILE` と `TRANSCRIPT_FILE` をそのまま wrapper script に文字列で指定する。wrapper は codex exec をプロセスグループから切り離して background 起動し、codex の PID を1行出力してすぐに戻る。起動コマンド自体は数秒で返るため、通常の Bash ツール timeout で問題ない。

`codex exec` は PROMPT 引数が省略・空文字列になると stdin からの入力待ちに切り替わり、ハングする。ヒアドキュメントで組み立てる `<依頼内容をここに記述>` の部分が必ず空でない実質的な内容に展開されていることを確認してから実行する。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/run-codex.sh "<冒頭で確定した RESULT_FILE>" "<冒頭で確定した TRANSCRIPT_FILE>" \
  --sandbox workspace-write -c 'approval_policy="on-request"' \
  --model "<model: 既定 gpt-6-luna>" -c 'model_reasoning_effort="<effort: 既定 xhigh>"' \
  --color never --json -C "$PWD" \
  "$(cat <<'PROMPT'
ワークスペース内では、自律的にファイルを読み取り、必要なコード検索・git コマンド・テスト・編集を行ってください。ワークスペース外への書き込み、ネットワークアクセス、破壊的操作が必要な場合は、承認を求めてください。

<依頼内容をここに記述>
PROMPT
)"
```

### 4. Present results

wrapper 起動後、codex は background で実行され続けるので、完了をポーリングで待つ。次のコマンドを `EXIT ...` が出力されるまで繰り返し実行する。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/wait-codex.sh "<冒頭で確定した TRANSCRIPT_FILE>" 300
```

第2引数は待機秒数 (既定 300)。`EXIT_FILE` (`${TRANSCRIPT_FILE%.jsonl}.exit`) が現れると `EXIT <code>` を出力して完了を報せる。待機秒数内に完了しなければ `RUNNING (<n> events done, last activity <s>s ago)` と直近イベントの要約 (種別とコマンド・メッセージの冒頭) を出力するので、進行状況を 1 行以内で伝えて即座に再実行する。codex プロセスが exit code を残さず消えた場合は `DEAD (...)` を出力するので、`LOG_FILE` と `TRANSCRIPT_FILE` の末尾から状況を報告する。`EXIT 143` / `EXIT 137` は watchdog による停止の可能性が高く、`LOG_FILE` 末尾の `watchdog:` 行で確認できる。要約は進行確認のためだけの出力なので、内容を解説したり結論を推測したりしない。プロセスグループが切り離されているため、ポーリングコマンドが timeout しても codex 本体には影響しない。

`EXIT_FILE` の中身が `0` なら `RESULT_FILE` を Read して最終回答を表示し、Codex CLI による結果である旨を短く注記する。末尾に保存先パス (`RESULT_FILE` と `TRANSCRIPT_FILE`) を明示する。`0` 以外なら `LOG_FILE` (`${TRANSCRIPT_FILE%.jsonl}.log`) と `TRANSCRIPT_FILE` の末尾を確認し、失敗内容を報告する。

ポーリングを待たずにユーザーへ制御を返す場合は、Codex プロセスを kill してはならない。`AskUserQuestion` で待機するか確認し、待たない場合は後で `RESULT_FILE` / `TRANSCRIPT_FILE` / `LOG_FILE` を読めることをパスとともに伝える。

バックグラウンドで実行中の Codex プロセスを `ps` などで確認する場合は、wrapper が出力した PID を第一の識別手段とする。`ps -o pid,ppid,tty,lstart,command -p <PID>` でプロセスの詳細を確認する。PID が分からない場合にプロセス名の一致だけで「自分が起動したものだ」と判断してはならない。その場合は `ps -o pid,ppid,tty,lstart,command` で `ppid` (今回のシェルの子か)、`lstart` (今回のセッション開始後に起動したか)、`tty` (無人実行か別の対話セッションか) を確認したうえで対象を特定する。

Codex CLI 自体が中断・クラッシュして最終回答が保存されなかった場合は、`TRANSCRIPT_FILE` に書き出し済みのイベントや `LOG_FILE` を読んで状態を確認する。保存セッションは `codex exec resume --last "<元の依頼を継続して完了してください>"` で再開できる。現在の Codex CLI の `resume` サブコマンドには `--sandbox` がないため、元のセッションの権限設定で再開される。wrapper script を使い、同じ `RESULT_FILE` と `TRANSCRIPT_FILE` を指定する。resume も同じ wrapper 経由で切り離し起動になるため、上記と同じポーリングフローで完了を待つ。

## Examples

```
/ask-codex staged -y
/ask-codex この設計方針についてレビューして
/ask-codex src/auth.ts --model gpt-6-luna --effort max
/ask-codex PR のエラーハンドリングに注目して
```

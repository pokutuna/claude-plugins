---
name: codex-review
description: Review the current changes with Codex CLI's built-in review mode, read-only. 「Codex でレビュー」「Codex にセカンドオピニオンを求める」などで起動。
argument-hint: "[--uncommitted | base <branch> | commit <sha>] [focus] [--model NAME] [--effort LEVEL] [-y]"
compatibility: Codex CLI installed and authenticated
allowed-tools:
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/share-path.sh)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/run-codex.sh *)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/wait-codex.sh *)
  - Read
  - AskUserQuestion
---

# Codex Review

Claude Code 自身のレビューとは独立した Codex CLI プロセスを起動し、`codex exec review` で変更をレビューする。
Codex は read-only sandbox で動くためファイルを編集せず、結果と実行ログを一時ファイルへ保存する。

汎用の相談・調査には `ask-codex` を使う。この skill は差分レビュー専用で、権限を read-only に固定する点が異なる。

このセッションの保存先は、skill 起動時に次を実行して確定する。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/share-path.sh
```

出力の 1 行目が RESULT_FILE (`.md`)、2 行目が TRANSCRIPT_FILE (`.jsonl`)。
wrapper script は TRANSCRIPT_FILE から派生する 3 つのファイルも生成する。`${TRANSCRIPT_FILE%.jsonl}.log` が stderr ログ (LOG_FILE)、`${TRANSCRIPT_FILE%.jsonl}.exit` が codex の exit code (EXIT_FILE、完了時にのみ書かれる)、`${TRANSCRIPT_FILE%.jsonl}.pid` が codex 本体の PID (PID_FILE)。
wrapper には watchdog が組み込まれており、transcript/log に 20 分間書き込みがない、または実行が 90 分を超えると codex を kill して EXIT_FILE に非 0 を書く。そのためポーリングが永遠に続くことはない。

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

## Arguments

- **対象**: 次のいずれかに解釈して `review` サブコマンドのフラグへ変換する
  - 未指定 → `--uncommitted` (staged・unstaged・untracked の変更)
  - `base <branch>` → `--base <branch>` (指定ブランチとの差分)
  - `commit <sha>` → `--commit <sha>` (指定コミットの変更)
- **レビュー観点**: 対象の後ろにある自然言語。渡し方は下の制約に従う
- **オプション**: `--model <model>` と `--effort <level>`。既定値は `gpt-6-luna` と `xhigh`
- **確認スキップ**: `-y` / `--yes`

`-y` / `--yes`、`--model`、`--effort` はレビュー観点の本文に含めない。

対象が省略されたまま `/codex-review` が呼ばれた場合は、確認せず `--uncommitted` を使う。
レビュー対象の変更が存在しない場合のみ、実行前に対象を確認する。

### 対象フラグと観点は排他

`codex exec review` は対象フラグ (`--uncommitted` / `--base` / `--commit`) と `[PROMPT]` を
同時に受け付けない。両方を渡すと
`error: the argument '--uncommitted' cannot be used with '[PROMPT]'` で即座に失敗する。

そのため観点の有無で渡し方を変える。

- **観点なし** → 対象フラグのみを渡す
- **観点あり** → 対象フラグを渡さず、`[PROMPT]` に観点とレビュー範囲を文章で書く

観点ありの場合、対象は Codex に自分で git コマンドを実行させて特定させる。
プロンプトの冒頭に範囲と確認手段を明示する。素の `git diff` は staged hunk も untracked ファイルも
出力しないため、`--uncommitted` 相当の範囲では確認コマンドを個別に指示する。例:

```text
staged・unstaged・untracked の変更をレビューしてください。
範囲は `git status --porcelain`、`git diff` (unstaged)、`git diff --cached` (staged) で確認し、
untracked ファイルは中身も読んでください。

観点: <ユーザー指定の観点>
```

`--base main` 相当なら「main ブランチとの差分 (`git diff main...HEAD`) をレビューしてください」、
`--commit <sha>` 相当なら「コミット <sha> の変更 (`git show <sha>`) をレビューしてください」と書く。

## Instructions

### 1. Confirm with user

以下の場合は確認をスキップして Step 2 に進んでよい。

- `-y` / `--yes` が指定されている
- `$ARGUMENTS` でレビュー対象と観点が明確に指定されている

それ以外では、必ず `AskUserQuestion` ツールで実行前に確認する。テキストで確認してはならない。
レビュー対象・観点・使用モデルを要約し、「このまま実行」「プロンプトを修正」「中止」を選択肢にする。

### 2. Run Codex

冒頭で確定した `RESULT_FILE` と `TRANSCRIPT_FILE` をそのまま wrapper script に文字列で指定する。
wrapper は codex exec をプロセスグループから切り離して background 起動し、PID を 1 行出力してすぐに戻る。

`--sandbox` / `--color` / `-C` は `exec` 側のオプションなので、必ず `review` より**前**に置く。
`review` の後ろに置くと `unexpected argument` で失敗する。

観点なし (対象フラグを渡す):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/run-codex.sh "<冒頭で確定した RESULT_FILE>" "<冒頭で確定した TRANSCRIPT_FILE>" \
  --sandbox read-only --ignore-user-config -c 'approval_policy="never"' \
  --model "<model: 既定 gpt-6-luna>" -c 'model_reasoning_effort="<effort: 既定 xhigh>"' \
  --color never --json -C "$PWD" \
  review --uncommitted
```

観点あり (対象フラグを渡さず、範囲と観点を PROMPT に書く):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/run-codex.sh "<冒頭で確定した RESULT_FILE>" "<冒頭で確定した TRANSCRIPT_FILE>" \
  --sandbox read-only --ignore-user-config -c 'approval_policy="never"' \
  --model "<model: 既定 gpt-6-luna>" -c 'model_reasoning_effort="<effort: 既定 xhigh>"' \
  --color never --json -C "$PWD" \
  review "$(cat <<'PROMPT'
<レビュー範囲の指示>

観点: <レビュー観点>
PROMPT
)"
```

- `--sandbox read-only`: ファイル編集とワークスペース書き込みを禁じる。レビューに編集は不要
- `--ignore-user-config`: `~/.codex/config.toml` を読み込まない (認証は維持される)。ユーザー設定の MCP サーバーや notify hook が起動を遅らせたりハングさせたりするのを防ぐ。レビューに必要な設定はすべてこのコマンドで明示している。ユーザーが config.toml の `model_providers` 経由でしか使えないモデルを指定した場合のみ、このフラグを外す
- `approval_policy="never"`: 承認要求で停止させない。read-only なので承認すべき操作は発生しない
- `review <target flag>`: `--uncommitted` / `--base <branch>` / `--commit <sha>` のいずれか 1 つ

`review` は対象フラグだけでも動作するので、`ask-codex` と違い PROMPT 省略で stdin 待ちにはならない。
ただし PROMPT を渡す形では空文字列にしてはならない。

`--sandbox danger-full-access` と `--dangerously-bypass-approvals-and-sandbox` は使用してはならない。

### 3. Present results

wrapper 起動後、codex は background で実行され続けるので、完了をポーリングで待つ。次のコマンドを `EXIT ...` が出力されるまで繰り返し実行する。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/wait-codex.sh "<冒頭で確定した TRANSCRIPT_FILE>" 300
```

第 2 引数は待機秒数 (既定 300)。`RUNNING (<n> events done, last activity <s>s ago)` と直近イベントの要約が出た場合は、進行状況を 1 行以内で伝えて即座に再実行する。要約は進行確認のためだけの出力なので、内容を解説したり finding を推測したりしない。プロセスグループが切り離されているため、ポーリングコマンドが timeout しても codex 本体には影響しない。ポーリングを待たずに制御を返す場合も、Codex プロセスを kill してはならない。

大きな差分に対する xhigh のレビューは 30〜60 分かかることがある。RUNNING が続いても異常ではないので、last activity が更新されている限り根気よくポーリングを続ける。最初の RUNNING を確認した時点で、レビューには数十分かかりうることをユーザーに一度伝えておく。

- `EXIT 0`: `RESULT_FILE` を Read し、Claude 自身のレビューとは独立した Codex の結果として提示する。finding の優先度、タイトル、ファイル位置、全体評価を変更せずに伝える。末尾に `RESULT_FILE` と `TRANSCRIPT_FILE` のパスを示す
- `EXIT 143` / `EXIT 137`: watchdog による停止の可能性が高い。`LOG_FILE` 末尾の `watchdog:` 行を確認し、無活動または実行時間超過で停止した旨を報告する
- その他の `0` 以外: `LOG_FILE` (`${TRANSCRIPT_FILE%.jsonl}.log`) と `TRANSCRIPT_FILE` の末尾を確認し、失敗内容を報告する
- `DEAD (...)`: codex プロセスが exit code を残さず消えている (クラッシュや再起動)。`LOG_FILE` と `TRANSCRIPT_FILE` の末尾を確認して状況を報告し、ポーリングを終了する
- 結果が保存されていない場合、推測で finding を作ってはならない

この skill はファイル編集、コミット、レビューコメントの投稿を行わない。
修正が必要な場合は、レビュー結果を提示した後にユーザーから別途依頼を受ける。

## Examples

```
/codex-review                                      # 未コミットの変更を --uncommitted でレビュー
/codex-review -y                                   # 確認スキップ
/codex-review base main                            # main との差分を --base main でレビュー
/codex-review commit abc1234                       # 特定コミットを --commit でレビュー
/codex-review base main セキュリティ観点で          # 観点あり → PROMPT に範囲と観点を記述
/codex-review --model gpt-6-sol --effort high    # モデル・effort 指定
```

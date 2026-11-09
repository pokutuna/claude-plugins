---
name: gemini-rewrite
description: pi CLI から Gemini を呼び出し、ファイルまたはディレクトリ以下の文章を直接書き直させる。レビューを返して同じセッションで直させることもできる。「Gemini で整えて」「Gemini に推敲させて」「gemini-rewrite」で起動。
argument-hint: "[--check] [file|dir] [instruction] [--style clarify|concise] [--session ID] [--model MODEL] [--thinking LEVEL] [--provider NAME] [--project ID] [--location LOC]"
compatibility: pi CLI (https://pi.dev) with Gemini credentials for Vertex AI or the Gemini API, and srt (@anthropic-ai/sandbox-runtime)
allowed-tools:
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/skills/gemini-rewrite/scripts/gemini-rewrite.sh *)
  - Bash(git diff *)
  - Read
---

# Gemini Rewrite

pi CLI で Gemini を起動し、ファイル、またはディレクトリ以下の文書を直接書き直させる。

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

引数にあるオプション (`--style`, `--session`, `--model`, `--thinking`, `--provider`, `--project`, `--location`) はそのままスクリプトに渡し、追加指示には含めない。各オプションの説明は `scripts/gemini-rewrite.sh` の冒頭のコメントにある。

## 環境の確認

`--check` があれば次を実行し、結果を伝えて終了する。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/gemini-rewrite/scripts/gemini-rewrite.sh --check [options]
```

## 1. 対象と指示を決める

- 対象はファイルかディレクトリのパスである。指定がなければユーザーに尋ねる。文章が直接渡されたら、ファイルに保存してから指定するよう伝える。別のファイルに書き出すよう言われたら、元をそのパスにコピーしてコピーを対象にし、手順 3 では `git diff --no-index --word-diff <元> <コピー>` で比べる。
- 新しく実行するとき、`--style` の指定がなく「短く」「簡潔に」「冗長」といった要望なら `--style concise` を付ける。それ以外は既定の `clarify` (分かりやすくする) でよい。
- 文体や読者などの要望があれば、1〜3 文の追加指示にまとめる。基本方針は `assets/system-prompt.md` と `assets/styles/` にあるので繰り返さない。

バックアップは取らない。

## 2. Gemini を呼び出す

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/gemini-rewrite/scripts/gemini-rewrite.sh [options] <path> "<追加指示>"
```

Bash ツールの `timeout` は 600000 にする。標準出力に Gemini による変更の要約が、標準エラー出力に `session: <ID>` が出る。

## 3. 結果を伝える

`git diff --word-diff <path>` で変更を確認する。Git の管理外なら対象 (ディレクトリなら配下すべて) を Read し、書き換え前と比べられないことも伝える。事実の確認が必要なら、関連するファイルを Read して照らし合わせる。

Gemini の要約、変更を見て気になった点、session ID を伝える。気になる点とは、意味や事実の変化、論理の飛躍、言い漏れ、コードや URL の変化、記法の崩れなどである。Claude は対象を直接編集しない。気になった点があれば、Gemini に直させるかをユーザーに尋ねる。

## 4. 指摘を返して直させる

同じセッションを再開して指摘を送る。対象のパスは手順 2 と同じものを渡す。`--style` は再開時に変えられないので、方針を変えたいと言われたら指摘の中で伝えるか、新しいセッションで実行する。指摘には、どこが、なぜ問題で、どう直すとよいかを書き、問題のない変更も伝える。終わったら手順 3 に戻る。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/gemini-rewrite/scripts/gemini-rewrite.sh --session <ID> [options] <path> "<指摘>"
```

## 失敗したとき

エラーは標準エラー出力に出る。原因が分からなければ、同じオプションに `--check` を付けて実行する。

- srt がない: `npm install -g @anthropic-ai/sandbox-runtime` でインストールしてもらう。Linux では bubblewrap と socat も要る
- session が見つからない: ID と対象のパスが前回と同じかを確かめる
- 認証エラー: 次のいずれかを設定してもらう。API キーはコマンドライン引数で渡さない
  - Vertex AI: `GOOGLE_CLOUD_API_KEY`、または `gcloud auth application-default login` と `GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`
  - Gemini API: `GEMINI_API_KEY`

## Examples

```
/gemini-rewrite --check
/gemini-rewrite README.md ですます調に統一して
/gemini-rewrite --style concise docs/
```

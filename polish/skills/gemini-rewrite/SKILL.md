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

pi CLI で Gemini を起動し、ファイル、またはディレクトリ以下の文書を直接書き直させる。Gemini はリポジトリ内を読めるが、書き換えられるのは対象だけである。コマンドは srt のサンドボックスの中で、ネットワークなしに動く。

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

`$ARGUMENTS` にあるオプション (`--style`, `--session`, `--model`, `--thinking`, `--provider`, `--project`, `--location`) はそのままスクリプトに渡し、追加指示には含めない。各オプションの説明は `scripts/gemini-rewrite.sh` の冒頭のコメントにある。

## 環境の確認

`--check` があれば次を実行し、結果を伝えて終了する。srt のサンドボックスとモデルへの接続を確かめる。

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/gemini-rewrite/scripts/gemini-rewrite.sh --check [options]
```

## 1. 対象と指示を決める

- 対象はファイルかディレクトリのパスである。指定がなければユーザーに尋ねる。文章が直接渡されたら、ファイルに保存してから指定するよう伝える。
- 書き直し方針を `--style` で選ぶ。指定がなければ要望から決める。
  - `clarify` (既定): 分かりやすくする。文を分け、省略を補い、流れを整える。長くなってもよい
  - `concise`: 必要な情報を残して短くする。「短く」「簡潔に」「冗長」といった要望ならこれを使う
- 文体や読者などの要望があれば、1〜3 文の追加指示にまとめる。基本方針は `assets/system-prompt.md` と `assets/styles/` にあるので繰り返さない。

バックアップは取らない。書き換え前の状態は、ユーザーがコミットや stash で残しておく。

## 2. Gemini を呼び出す

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/gemini-rewrite/scripts/gemini-rewrite.sh [options] <path> "<追加指示>"
```

Bash ツールの `timeout` は 600000 にする。標準出力に Gemini による変更の要約が、標準エラー出力に `session: <ID>` が出る。

## 3. 結果を伝える

`git diff --word-diff <path>` で変更を確認する。Git の管理外なら書き換え後の内容を Read する。事実の確認が必要なら、関連するファイルを Read して照らし合わせる。

Gemini の要約、変更を見て気になった点、session ID を伝える。気になる点とは、意味や事実の変化、論理の飛躍、言い漏れ、コードや URL の変化、記法の崩れなどである。Claude は対象を直接編集しない。気になった点があれば、Gemini に直させるかをユーザーに尋ねる。

## 4. 指摘を返して直させる

同じセッションを再開して指摘を送る。対象のパスは手順 2 と同じものを渡す。`--style` は最初の実行のものが引き継がれる。指摘には、どこが、なぜ問題で、どう直すとよいかを書き、問題のない変更も伝える。終わったら手順 3 に戻る。

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
/gemini-rewrite docs/guide/
/gemini-rewrite README.md ですます調に統一して
/gemini-rewrite --style concise docs/intro.md
/gemini-rewrite --session 01a1bfc3-80d0-722b-b382-c3da24b736ad docs/setup.md 2 段落目の太字を外して
/gemini-rewrite draft.md --provider google-vertex --project my-project --location global
```

---
name: kaggle-fetch
description: Kaggle の discussion と公開 notebook を取得し、リポジトリの kaggle/ 以下に保存する。分析はしない。"discussion を取得", "notebook を取り込む", "kaggle-fetch" などで起動。
compatibility: uv、kaggle CLI (認証済み)、playwright-cli が必要
argument-hint: "[--outputs] [--listing <file>] [--extension] <discussion URL | notebook URL | user/slug> ..."
context: fork
model: sonnet
allowed-tools:
  - "Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-fetch/scripts/fetch.py *)"
  - "Bash(playwright-cli *)"
  - "Bash(kaggle kernels output *)"
  - "Bash(cat .gitignore)"
  - Write
user-invocable: true
---

# kaggle-fetch Skill

引数の discussion と notebook を取得し、取得した内容をそのままファイルに保存する。内容の分析や要約はしない。分析は `kaggle-analyze` skill が行う。

引数: $ARGUMENTS

引数には、次の形式のものを 1 つ以上、空白で区切って渡す。

- discussion: `https://www.kaggle.com/competitions/<slug>/discussion/<id>`
- notebook: `https://www.kaggle.com/code/<user>/<slug>` (末尾の `/comments` などは無視される) か `<user>/<slug>`

`--listing <ファイル>` は `kaggle-updates` skill が付ける。notebook の一覧で読んだスコアなどを、取得した notebook のディレクトリに `listing.json` として残すためのもので、そのままスクリプトに渡す。

`--outputs` は、notebook の最新の実行の出力ファイル (`submission.csv` など) と実行ログも取得する。引数にあるときだけ Step 3 を行う。

`--extension` は、ページをユーザーの Chrome で読む。ログインが要るページ (参加者だけが見られる discussion など) を取るときに使う。

取得するものが無いか、オプション以外にどの形式にも当てはまらないものがあれば、取得せずにその旨を返す。

## Instructions

### Step 1: ブラウザを用意する

ページは playwright-cli のブラウザで読む。セッション名は `kaggle-fetch-1` から順に付ける。

`--extension` が無ければ、取得する件数ぶん (4 件を超えるときは 4 つ) のセッションでブラウザを開く。ログインしていないヘッドレスのブラウザが開く。

```bash
playwright-cli -s=kaggle-fetch-1 open
playwright-cli -s=kaggle-fetch-2 open
```

`--extension` があれば、ユーザーの Chrome に 1 つだけつなぐ。Chrome に Playwright の拡張機能が入っていて、ユーザーがつなぐことを許可する必要がある。

```bash
playwright-cli attach --extension --session=kaggle-fetch-1
```

playwright-cli は作業ディレクトリに `.playwright-cli/` (ログ) を作る。成果物ではないので、削除せずに残す。

### Step 2: 取得する

引数のうち、`--outputs` と `--extension` を除いたものと、Step 1 のセッション名をすべて、1 回のコマンドで渡す。

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-fetch/scripts/fetch.py --session kaggle-fetch-1 --session kaggle-fetch-2 [--listing <ファイル>] <URL や user/slug をすべて>
```

スクリプトは、セッションごとに 1 件ずつ並列に取得する。保存先はリポジトリのルート (git の作業ツリーのルート) の `kaggle/` 以下である。

- discussion: `kaggle/discussions/<id>_<タイトル>/discussion.md`
- notebook: `kaggle/notebooks/<kernel id>_<slug>/`
  - `kaggle kernels pull -m` で取得したコードのファイルと `kernel-metadata.json`
  - `comments.md`: コメントページの内容
  - `source.md`: 出力を除き、長い行とセルを切り詰めたコード。分析ではこれを読む
  - `listing.json`: `--listing` があるときだけ。一覧で読んだ版、スコア、votes、コメント数、実行日時と、取得日時。`--listing` が無いときは、前回の `listing.json` を消す
  - ディレクトリは kernel id で探すので、slug が変わっても同じディレクトリに保存する。名前の slug は最初に取得したときのまま
- 取り直したもので `insights.md` があれば、前回分析した取得からの差分を `changes.diff` に書く。`取得:` の行の違いは含めない。`kaggle-analyze` skill はこれを読んで、変わったところだけを反映する

出力は 1 件ごとに 1 行の JSON である。

```json
{"type": "discussion", "id": 760095, "dir": "kaggle/discussions/760095_...", "changes": 12, "comments": 1, "commentsTruncated": false}
{"type": "notebook", "ref": "user/slug", "id_no": 145952068, "dir": "kaggle/notebooks/145952068_slug", "absDir": "/path/to/repo/kaggle/notebooks/145952068_slug", "slugChanged": false, "changes": 0, "comments": 0, "commentsTruncated": false}
{"target": "https://example.com/x", "error": "..."}
```

- `absDir`: `dir` の絶対パス。Step 3 で使う
- `changes`: `changes.diff` の行数。`0` は内容が前回の分析から変わっていない。`null` は差分を作っていない (`insights.md` が無いか、前回の分析がどの取得をもとにしたか分からない)
- `commentsTruncated`: コメントが 300 件を超えたため読み込みを打ち切った。`comments` は読み込めた件数
- `error`: その 1 件は取得できていない。他の件は取得できている

取得したファイルは書き換えない。失敗した件を、別の方法 (snapshot や innerText) で取得して補ったり、代わりの内容をファイルに書いたりしない。

### Step 3: 出力を取得する

`--outputs` があるときだけ行う。取得できた notebook ごとに、`ref` と `absDir` を使って次を実行する。`dir` は使わない。作業ディレクトリがリポジトリのルートでないと、別の場所に保存されるため。

```bash
kaggle kernels output <ref> -p <absDir>/outputs -o
```

最新の実行の出力ファイルと、実行ログ `<slug>.log` が `outputs/` に保存される。同じ名前のファイルは上書きされ、今回の実行に無いファイルは前回のものが残る。大きさの上限は無い。

出力に `Next page token:` の行があれば、出力ファイルが 1 ページに収まらず、最初のページのぶんだけが保存されている。kaggle CLI には続きのページを取る方法が無いので、取り直さずに、一部だけであることを報告する。

続けて、`<absDir>/outputs/.gitignore` を、内容 `*` の 1 行で Write ツールで書く。`outputs/` をディレクトリごと git の管理外にするためのもので、Write で書くのはこのファイルだけである。

### Step 4: ブラウザを閉じ、結果を返す

取得に失敗した件があっても、Step 1 のセッションをすべて閉じる。開いたものは `playwright-cli -s=<セッション名> close`、`--extension` でつないだものは `playwright-cli -s=kaggle-fetch-1 detach` で閉じる。ユーザーの Chrome は閉じない。

次を返す。報告する内容はこれですべてである。

- 取得できた件ごとに、`dir` と、コメントの件数
- `slugChanged`、`commentsTruncated` があった件
- `changes` が `0` だった件 (内容が変わっていない)
- `--outputs` があれば、件ごとに保存したファイルの名前。`Next page token:` が出た件は、一部だけであること。取得に失敗した件は、そのエラー
- 失敗した件と `error` の内容。原因の見当がつけば添える (Troubleshooting を参照)
- リポジトリの `.gitignore` に `.playwright-cli/` が無いとき (`.gitignore` が無いときも含む) は、追加の依頼。playwright-cli が作業ディレクトリに作るログで、成果物ではない。`.gitignore` は自分では作らず、書き換えない

## Examples

### discussion と notebook をまとめて取得する

```
ユーザ: /kaggle-fetch https://www.kaggle.com/competitions/santa-2026/discussion/760095 ozertuu/santa-2026-starter-notebook

手順:
1. 2 件なので、kaggle-fetch-1 と kaggle-fetch-2 のブラウザを開く
2. 2 件と 2 つのセッション名を、1 回のコマンドで fetch.py に渡す
3. ブラウザを閉じ、保存先とコメントの件数を返す
```

### notebook を出力も含めて取得する

```
ユーザ: sacuscreed/public-merge を出力も含めて取得して

手順:
1. kaggle-fetch-1 のブラウザを開き、fetch.py で取得する
2. kaggle kernels output で outputs/ に出力を取得し、outputs/.gitignore を書く
3. ブラウザを閉じ、保存先と、取得した出力のファイルを返す
```

## Troubleshooting

### `kaggle kernels pull failed: ... 404`

原因: notebook が削除されたか、slug が変わった。作者がタイトルを変えると slug も変わる。
対処: Code タブで現在の URL を確かめ、新しい slug で取得する。同じ kernel id の既存ディレクトリがあれば、そこに保存される。

### `extract failed: ... TimeoutError`

原因: ページの読み込みが遅いか、DOM が変わってスクリプトが要素を見つけられない。
対処: もう一度実行する。続けて失敗するなら、失敗したことをそのまま返す。

### `goto failed (is the session open?)`

原因: Step 1 でブラウザを開いていないか、セッション名が違う。
対処: `playwright-cli list` で開いているセッションを確かめ、Step 1 からやり直す。

### 参加者だけが見られる discussion が取れない

原因: `--extension` が無いと、ログインしていないブラウザで開く。
対処: 取得できなかったことを返し、`--extension` を付けてユーザーの Chrome で取得できることを添える。

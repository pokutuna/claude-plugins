---
name: issues
description: GitHub Issues を作成・一覧・着手・close する。「Issue にして」「issue 一覧」「issue #N をやる」で起動。
argument-hint: "create <内容> | list [all] | do <number> | close <number>"
compatibility: gh CLI installed and authenticated
allowed-tools:
  - Bash(gh issue *)
  - Bash(rg *)
  - Bash(bash "${CLAUDE_PLUGIN_ROOT}/skills/issues/scripts/repo.sh")
  - Read
  - Edit
  - Write
  - AskUserQuestion
---

REPO: !`bash "${CLAUDE_PLUGIN_ROOT}/skills/issues/scripts/repo.sh"`

GitHub Issues の操作には `gh issue` コマンドを使用する。
REPO が取得できていない場合は、その旨をユーザに伝えて終了する。

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

引数の先頭キーワードでサブコマンドを判定する。

参照の検索 (`rg`) はリポジトリのルートで実行する。`--hidden -g '!.git'` を付け、`.github/` などの隠しディレクトリも対象にする。

## 参照の形式

コードやドキュメントから Issue を指すときは `Issue:{REPO}#{number}` と書く。
`{REPO}` は上の REPO の値に置き換える。REPO が `pokutuna/example` なら `Issue:pokutuna/example#12` になる。
`Issue:REPO#12` のように `REPO` の文字列をそのまま書かない。

参照には 2 種類ある:

- **印**: 未解決の問題がそこにあることを示すために置いたもの (例: 該当コードの直前の `# Issue:pokutuna/example#12`)。Issue が close されると不要になる
- **記録**: 経緯として Issue に言及しているもの (例: 「〜は Issue:pokutuna/example#12 に切り出した」「#12 で検証済み」)。close 後も残す

## create {内容}

現在取り組んでいる内容や調査中の内容から GitHub Issue を作成する。
主な用途: 未解決の問題、現在の作業から外れる別件の問題、追加調査が必要な問題。

手順:
1. 会話のコンテキストから Issue のタイトルと本文を組み立てる
2. `gh issue list --state all --search "{キーワード}" --limit 10` で似た Issue がないか探す。似た Issue があれば提示し、新しく作るか既存の Issue にコメントとして追記するかを AskUserQuestion で確認する
3. `gh issue create` で Issue を作成する
4. 作成後、現在編集中のコードや調査ドキュメントに関連する箇所があれば `Issue:{REPO}#{number}` の形式で参照を残す

## list [all]

GitHub Issues の一覧と、コードベース内の Issue 参照を返す。

手順:
1. `gh issue list --limit=20 --json number,title,labels,updatedAt --template '{{range .}}- #{{.number}} {{.title}}{{if .labels}} [{{range $i, $l := .labels}}{{if $i}}, {{end}}{{$l.name}}{{end}}]{{end}} ({{timeago .updatedAt}}){{"\n"}}{{end}}'` で open な Issue を表示する
2. `rg -n --hidden -g '!.git' 'Issue:{REPO}#[0-9]+'` でコードベースを検索する
3. `gh issue list --state open --limit 500 --json number -q '.[].number'` で open な Issue の番号を得て、参照を open な Issue への参照と closed な Issue への参照に分ける
4. open な Issue への参照を、Issue 番号・ファイルパス・行番号のリストで表示する
5. closed な Issue への参照は件数だけ表示する。引数に `all` があれば、`gh issue list --state closed --limit 500 --json number,title` でタイトルを得て、Issue 番号・タイトル・ファイルパス・行番号のリストで表示する

出力の方針:
- 一覧を得ることが目的なので、詳細は調べすぎない
- 簡潔に markdown のリストとして出力する

## do {number}

指定された Issue に取り組む。
実装タスクに限らず、調査・仮説検証・分析などのタスクも含まれる。

手順:
1. `gh issue view {number} --comments` で Issue の内容とコメントを確認する。以前の作業メモがあれば、その続きから取りかかる
2. 関連するコードやドキュメントを読み、計画を立てる
3. 方針に迷う点やユーザの判断が要る選択肢があれば AskUserQuestion で確認する。なければそのまま実行する
4. 作業の結果を `gh issue comment {number}` で Issue に書き残す
   - 完了した場合: 何をしたか、わかったこと、関連するファイルやコミット
   - 途中で止まった場合 (ユーザの中断、ブロッカー、作業の区切り): 済んだこと、残っていること、わかったこと、次に取るべき手順
5. 完了した場合は、`close {number}` で close できることをユーザに伝える。自分からは close しない

## close {number}

指定された Issue を close し、コード中の参照を整理する。

手順:
1. `gh issue view {number} --comments` で Issue の内容と結論を確認する
2. `rg -n --hidden -g '!.git' 'Issue:{REPO}#{number}\b'` で参照を探す
3. 各参照を前後の文脈から次のどれかに分ける
   - **消す**: 印。参照の行やコメントを削除する
   - **更新**: 記録だが、本文が未解決を前提にしている (例: 「#12 で評価予定」)。Issue の結論に合わせて書き直す
   - **残す**: 記録で、close 後もそのまま読める
4. 分類と変更内容を一覧で示し、AskUserQuestion で確認を取る
5. `gh issue close {number} --comment "{結論}"` で close する。結論が `do` で書き残したコメントと同じなら `--comment` は省く。解決せずに打ち切る場合は `--reason "not planned"` を付ける
6. close が成功したことを確かめてから、手順 4 で確認した内容で参照を編集する。close に失敗した場合は参照を編集せず、失敗した内容をユーザに伝える

## Examples

- `create 評価スクリプトが L4 で OOM する件` → 似た Issue を確認して作成し、該当コードに `Issue:{REPO}#{number}` を残す
- `list` → open な Issue と、それらへの参照箇所。closed な Issue への参照は件数のみ
- `list all` → closed な Issue への参照も含めて表示
- `do 12` → Issue #12 に取りかかり、結果や途中経過を Issue にコメントする
- `close 12` → close し、印を消して、必要なら記録を更新する

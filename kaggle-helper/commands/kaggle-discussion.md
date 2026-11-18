---
description: Kaggle discussion を分析する
allowed-tools:
  - Bash
---
あなたは与えられた kaggle で公開されている discussion を分析する専門家です
現在のリポジトリで取り組んでいる competition で高い成果を上げるための調査・分析を行うことがあなたのタスクです

<INPUT>
$ARGUMENTS
</INPUT>

## Discussion の取得
- playwright-cli を利用して discussion ページの内容を取得します
- 以下のスクリプトで Discussion 全体(本文+コメント)を Markdown テキストとして取得できます

```bash
# 1. ブラウザを開いて Discussion ページに移動
playwright-cli open "$URL"
# 2. スクリプトを実行して Markdown を標準出力に得る
#    run-code の結果は JSON 文字列でエンコードされているため、sed と jq でデコードする
playwright-cli run-code --filename=${CLAUDE_PLUGIN_ROOT}/commands/scripts/extract-discussion.mjs 2>&1 | sed -n '2p' | jq -r '.' | jq -r '.'
# 3. ブラウザを閉じる
playwright-cli close
```

- 取得した Markdown は標準出力から読み、リポジトリに中間ファイルを作らない
- playwright-cli は作業ディレクトリに `.playwright-cli/` (ログ) を作る。成果物ではないので、削除せずに残し、コミットにも含めない。リポジトリの `.gitignore` に無ければ、追加するようユーザーに伝える

- スクリプトは、末尾までのスクロールと折りたたまれた返信の展開を行い、全コメントを読み込んでから取得します
  - 読み込んだコメントが 300 件を超えた時点で読み込みを打ち切ります。そのときは出力の `## Comments (N)` の下に打ち切りの注記が入り、N は読み込めた件数です

### 分析対象の特定
- INPUT が空の場合:
  - ユーザーに Discussion URL を入力するよう促してください
- INPUT が Discussion URL の場合:
  - 次のパターンにマッチするもの:
  - `https://www.kaggle.com/competitions/$COMPETITION/discussion/$ID`
  - playwright-cli で URL を開き、スクリプトを実行してください
- URL が kaggle discussion ではない場合:
  - ユーザに確認を促してください

## Discussion の分析
以下の手順で取得した Markdown テキストを分析してください

1. discussion の話題・内容を把握する
2. 会話の流れから重要なポイント・発見を抽出する
  - 以下のような点に着目してレポートを作成する
  - 主要な議論内容・疑問点
  - 提案された解決策やアプローチ
  - 検証結果や実験データ
  - 技術的な知見や洞察
  - データの特性・ドメイン知識
  - 外部データ・リソース情報
  - 意見が分かれた場合の賛成/反対意見
3. discussion の内容をレポート
  - あくまで発言者の意見であることに注意して内容をまとめる
  - 特徴的な発言は `> 発言者名: 発言内容` の形式で引用する
  - 出力先: `${REPO_ROOT}/kaggle/discussions/${ID}_${REPLACED_TITLE}.md`
    - `REPLACED_TITLE` は、Discussion のタイトルを以下のスクリプトで置換したものとします
      - `echo "$TITLE" | sed 's/[^a-zA-Z0-9._-]/-/g' | sed 's/--*/-/g' | sed 's/^-//; s/-$//'`
  - `kaggle/discussions/` に同じ ID で始まるファイル (`${ID}_` で始まる名前) が既にある場合:
    - タイトルから作った名前と違っていても、そのファイルを更新する。ファイル名は変えず、同じ ID のファイルを新しく作らない
    - 既存内容を読み込み、新規取得した内容との差分(新規コメント・追加議論)を把握する
    - `## 要約` と `## 内容` は、新規取得した内容に合わせて書き直してよい。既存の記述が新規取得した内容と食い違うときは、新規取得した内容に合わせて直す
    - `## コメント・メモ` の既存の行は消さずに残す
    - `## コメント・メモ` に今回の更新日付と追記内容の要約を残す
  - 存在しない場合: 以下のテンプレートに従って新規作成する


#### discussion 分析テンプレート

```
URL: 

## 要約
<!-- 100~200 文字程度、discussion の内容や発見・意見を簡潔に -->

## 内容

## コメント・メモ
```

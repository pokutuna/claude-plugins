---
description: Kaggle notebook を取得・分析する
allowed-tools:
  - Bash(kaggle kernels pull:*)
  - Bash(playwright-cli:*)
  - Bash(sed:*)
  - Bash(jq:*)
---
あなたは与えられた kaggle で公開されている jupyter notebook を分析する専門家です
現在のリポジトリで取り組んでいる competition で高い成果を上げるための調査・分析を行うことがあなたのタスクです

<INPUT>
$ARGUMENTS
</INPUT>

## 前提条件
INPUT は以下のいずれかの形式を期待します
- `https://www.kaggle.com/code/$USER/$FILENAME(/comments)?`
- `$USER/$FILENAME`
そうではない場合、ユーザに確認を促してください

### kaggle notebook の分析
以下の手順で kaggle notebook を分析してください

1. kaggle notebook の取得
  - 次のコマンドで kaggle notebook を取得する
  - `$ kaggle kernels pull $USER/$FILENAME --path=${REPO_ROOT}/kaggle/notebooks/$USER__$FILENAME`
  - この slash command 内では、この path を作業ディレクトリとして扱う

2. notebook の内容を分析
  ‐ `${REPO_ROOT}/kaggle/notebooks/$USER__$FILENAME/$FILENAME.ipynb` の内容を分析する
  - 以下の点に着目して分析を行う
    - データの前処理や特徴量エンジニアリングの手法、欠損値や異常値への対応
    - 利用している機械学習ライブラリ、モデル・基盤モデルの選定
    - この notebook 独自の工夫や改善点と思われるポイント
    - バリデーション戦略とクロスバリデーションの実装方法
    - ハイパーパラメータチューニングとアンサンブル手法の実装

3. comments の取得と分析
  - playwright-cli で `https://www.kaggle.com/code/$USER/$FILENAME/comments` を開き、全コメントを Markdown として `comments.md` に書き出す
    ```bash
    playwright-cli open "https://www.kaggle.com/code/$USER/$FILENAME/comments"
    playwright-cli run-code --filename=${CLAUDE_PLUGIN_ROOT}/commands/scripts/extract-discussion.mjs 2>&1 | sed -n '2p' | jq -r '.' | jq -r '.' > ${REPO_ROOT}/kaggle/notebooks/$USER__$FILENAME/comments.md
    playwright-cli close
    ```
    - run-code の結果は JSON 文字列でエンコードされているため、`sed` と `jq` でデコードする
    - スクリプトは全コメントを読み込んでから取得する。読み込んだコメントが 300 件を超えた時点で読み込みを打ち切り、`## Comments (N)` の下に打ち切りの注記を入れる。N は読み込めた件数である
    - `comments.md` は取得した内容のまま保存し、書き換えない。既に存在する場合は上書きする
  - `comments.md` を読み、コメントでの会話内容を分析する

4. 既存ファイルの確認
  - 出力先 `${REPO_ROOT}/kaggle/notebooks/$USER__$FILENAME/analysis.md` が既に存在する場合:
    - 既存内容を読み込み、現在の分析結果との差分を把握する
    - 既存の知見は失わず、更新があれば反映し、新たな発見は統合・追記する
    - `## メモ・更新履歴` に今回の更新日付と追記内容の要約を残す
  - 存在しない場合: 新規作成する

5. 分析結果をまとめる
  - 以下のテンプレートに従って次のパスに出力してください
  - `${REPO_ROOT}/kaggle/notebooks/$USER__$FILENAME/analysis.md`


#### ノートブック分析テンプレート
```
URL: 

## 要約
<!-- 100~200 文字程度、手法・利用モデル・特徴的なところについて簡潔に -->

## データ理解・前処理
特徴量エンジニアリング手法: 
欠損値・異常値対応: 
データ拡張・サンプリング: 

## モデリング
使用モデル/ライブラリ: 
ハイパーパラメータ最適化: 
アンサンブル手法: 
バリデーション戦略: 

## 結果・考察
重要な特徴量: 
モデル解釈・可視化: 
改善点・疑問点: 

## 評価
参考度(★1-5): 
実装難易度(★1-5): 

## コメントでの議論の内容

## メモ・更新履歴

```

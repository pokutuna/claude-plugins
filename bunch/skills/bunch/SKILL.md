---
name: bunch
description: Split a multi-step or exploratory task and work through it in stages, logging progress and course corrections in a bunch document. Use when the user wants to go step by step or resume a bunch.
---

# Bunch Task

複数のステップから成る大きなタスクや探索的なタスクを以下の手順に沿って進めてください。

1. ユーザとの会話を通して一連のタスクの塊を決める
2. 全体の流れを管理する Bunch Document を作成し、計画を立てる
3. タスクごとに Task Document を作成して作業に着手する
4. タスクの完了やエスカレーションごとに Bunch Document を更新し、現在地を確認する
5. ゴールが達成されたら完了

再開時は既存の Bunch Document を読み、手順 4 から続ける

## 1. Bunch タスクの決定

ユーザの要求・指示・対話からひとまとまりのタスクを決める
この Skill は以下のような複数のステップが必要なタスクを扱う

- 複数の実装を組み合わせて出来上がる 1 つの機能やツール
- 進行しながら計画の更新・方向転換が必要な探索的なタスク
- 計画, 準備, 実行, 評価 に分けて順番に行う実験

短時間で終わる小さい作業にはこの Bunch Skill の方法を取らない
またプロジェクトを1つ完了させるような大きすぎるものは複数の Bunch に分割してさらに段階的に進める

## 2. Bunch Document の作成と計画

取り組む内容が決まれば、以下のテンプレートを元に Bunch Document を準備する
`${CLAUDE_PLUGIN_ROOT}/skills/bunch/assets/bunch-template.md`

- `<yyyymmdd>-<title>.md` という名前で作業ディレクトリに作成する
  - ただしプロジェクトの慣習・ユーザの指示があるならその配置場所に従う
  - 例: `20251209-oauth-login.md`, `experiments/012-tokenizer/20260407-vocab.md`
- テンプレートの `{{INIT: ...}}` を埋めて置き換える、テンプレート中の指示に従ってタスクリストを作成する

## 3. Task Document の作成と実行

各タスクに**着手する際**に以下のテンプレートを元に Task Document を準備する
`${CLAUDE_PLUGIN_ROOT}/skills/bunch/assets/task-template.md`

- Bunch Document の横に `<yyyymmdd>-<title>/<NN-slug>.md` を作成し、タスクリストのマーカーを `[~]` にする
  - ただしプロジェクトの慣習・ユーザの指示があるならその配置場所に従う
- テンプレートの `{{INIT: ...}}` を埋めて置き換える
- タスクを `bunch:task` Skill に従って進める
  - 着手は Timeline に書かない
  - 独立したタスクは SubAgent で並列実行してよい
    - SubAgent には「`bunch:task` Skill を読み、<Task Document のパス> を進める」と指示する

## 4. Task の確認と Bunch の更新

タスクが完了したとき、エスカレーションで止まったときに以下を行う

- タスクの確認 & 更新
  - 完了していれば成果物を確認しマーカーを `[x]` にする
  - エスカレーションなら、原因を取り除いてから続けさせる
    - 情報が足りない、進められないなら、文脈を足す、タスクを割る、Approach & Rules を変えるなど
    - 大きすぎる軌道修正は `[-]` にして新しいタスクを作り切り直す
- 結果を踏まえて Bunch Document, タスクリストを見直す
  - もし方針が変わったなら Approach & Rules を書き換える
  - 必要に応じてタスクを、追加する、分割する、並べ替える
    - 追加する際は番号をインクリメントしリストに挿入する、番号は振り直さない
    - `[?]` まで進んだら対応を決めてマーカーを更新し、必要ならタスクを具体化して追加する
  - 前提に大きな誤りがあり Bunch の目的が達成できない場合は、手順 5 の完了に進み、ユーザに仕切り直しを依頼する
- Bunch Document の Timeline に追記する
- 次に着手するタスクを決めて手順3へ / Bunch のタスクが完了すれば手順5へ

## 5. Bunch の完了

- Bunch Document の `{{END: ...}}` を埋めて置き換える
- ユーザに報告をする
- 報告後にユーザの指摘を受けて続ける場合は手順 4 に戻る

# progressive-outlining

Andrew Ng が DeepLearning.AI の講座 AI Prompting for Everyone で教える Progressive Outlining を
Claude Code のワークフローにした plugin。本文や実装を最初から生成せず、アウトラインの段階で往復して
構成を固め、末端が十分細かくなってから成果物を書く。

アウトラインの 1 箇所を直すと下流の節や実装がまとめて変わり、本文を直しても数語しか変わらない。
往復を修正の影響範囲が広い段階に集中させるのが要点で、2 つの skill はそれを文章と設計に当てはめたもの。

## Skills

| Skill | 成果物 | 起動例 |
|-------|--------|--------|
| [`writing`](skills/writing/SKILL.md) | 記事、レポート、提案書の本文 | `/progressive-outlining:writing 小規模 AI チームは大規模チームより速い、という記事` |
| [`coding`](skills/coding/SKILL.md) | 実装に入れる深さまで分解した設計文書。実装はしない | `/progressive-outlining:coding CLI に --watch オプションを足す` |

## 進め方

1. Brief: 目的、読者や利用者、主張や要求、必ず入れる素材、制約をヒアリングと調査で固めて合意する
2. 案: アウトラインまたは構造の案を出し、1 つ選ぶ
3. 詳細化: 一段ずつ細かくする。深さは内容で決まり、章・節・項のようなネストもそのまま扱う
4. 成果物: 文章なら本文を書き、以降は通常の会話で直す。設計なら分解が足りた時点で設計文書に整え、実装へ引き渡す

案を採用した後は、アウトラインや構造を更新するたびに次から選ぶ。

- この段階をもう一往復
- 次へ、自分でレビューする
- 残りを批評役 SubAgent と往復して自走 (writing は次の段階だけ自走することもできる)
- coding では、ここで設計を終えて実装へ引き渡す

案の選択はユーザー、以降の展開は brief を基準にした自走、という配分を既定で推奨する。
自走の後でも、作業ファイルにコメントを書けば任意の段階に戻って直せる。Agent ツールがない環境では自走の選択肢は出ない。

## 作業ファイルとフィードバック記法

往復は 1 つの作業ファイルで行う。writing は `<出力名>.outline.md`、coding は設計文書そのもの。
frontmatter の `stage` で途中再開できる。フィードバックはファイルを直接編集するか、マーカーで書く。

```markdown
>> 直前のブロック (段落、または項目とその子) へのコメント。冒頭なら全体、見出し直下なら節

ここは {原典>>ソースに言い換え} と書かれていた。{この文は要らない>>}
```

`{対象>>コメント}` は範囲指定で、コメントが空なら削除候補。Claude は `>>` を拾って反映し、マーカーを消す。

## Installation

```
/plugin install progressive-outlining@pokutuna-plugins
```

## 出所

- Andrew Ng, "Writing with AI" / "Brainstorming with AI" / "AI critique" (AI Prompting for Everyone, DeepLearning.AI, Module 2)

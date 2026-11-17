---
name: opus-5-5-frontend-design-defaults
description: フロントエンドの既定スタイル (クリーム色背景、見出しの斜体、01/02/03 ラベルなど) を名指しで禁止する。引数で禁止するスタイルを足せる。Opus 5.5 公式ガイドのプロンプト。
disable-model-invocation: true
argument-hint: "[additional styles to avoid]"
metadata:
  source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5#frontend-design-defaults
---

Follow this instruction for the rest of this session.

For frontend work, do not use a cream or off-white background, italic accent words in headlines, numbered "01/02/03" section labels, monospace labels, or pill-shaped buttons.

Also avoid these styles, if any are listed:

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

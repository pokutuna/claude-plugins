# prompts

定型プロンプトを skill として置き、`/prompts:<name>` で現在のセッションに差し込む Claude Code プラグイン。
Anthropic 公式のモデル別プロンプトガイドからの抜粋のほか、出典を問わず手元で使い回すプロンプトを置く。

## Skills

| Skill | Description |
|-------|-------------|
| [`prompts-discovery`](skills/prompts-discovery/SKILL.md) | 求める振る舞いや困っている挙動に合うプロンプトを、このプラグインの skill から探して提案する |

以下の skill は `disable-model-invocation: true` で、ユーザーが呼び出したときだけ働く。本文は出典のプロンプトを英語のまま載せている。

### Claude Fable 5.2

出典: [Prompting Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2)

| Skill | Description |
|-------|-------------|
| [`fable-5-2-finish-the-whole-task`](skills/fable-5-2-finish-the-whole-task/SKILL.md) | 作業が残っているのにターンを終える、続けるか尋ねて止まる、ありふれたエラーで止まる、を減らす |
| [`fable-5-2-say-who-owns-the-code`](skills/fable-5-2-say-who-owns-the-code/SKILL.md) | コードの所有者は自分だと伝え、重複の統合など構造の改善をさせる。頼んでいない変更や token が増える |
| [`fable-5-2-signal-intent`](skills/fable-5-2-signal-intent/SKILL.md) | 着手前に一行で予告し、作業中は短く報告し、最後にそれだけで読める要約を書かせる |
| [`fable-5-2-make-reports-easy-to-follow`](skills/fable-5-2-make-reports-easy-to-follow/SKILL.md) | 作業を見ていない読者に向けて、結論を先に、平易な短文で報告を書かせる |

### Claude Opus 5.5

出典: [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)

| Skill | Description |
|-------|-------------|
| [`opus-5-5-unattended-agentic-runs`](skills/opus-5-5-unattended-agentic-runs/SKILL.md) | 途中で止まる 4 つの終わり方を名指しで禁止し、無人で最後まで走らせる。人が応答できる場面では使わない |
| [`opus-5-5-explore-context-in-multi-app-workflows`](skills/opus-5-5-explore-context-in-multi-app-workflows/SKILL.md) | 手を動かす前に、タスクが明示していない資料も含めて関係しそうなものを広く調べさせる |
| [`opus-5-5-time-signals`](skills/opus-5-5-time-signals/SKILL.md) | 時間が大事だと伝え、避けられる時間を使わず並列に進めさせる |
| [`opus-5-5-frontend-design-defaults`](skills/opus-5-5-frontend-design-defaults/SKILL.md) | フロントエンドの既定スタイルを名指しで禁止する。引数で禁止するスタイルを足せる |

### その他

| Skill | Description | 出典 |
|-------|-------------|------|
| [`read-for-inspiration`](skills/read-for-inspiration/SKILL.md) | 方向性を決める前に本やエッセイを読ませ、そこから着想を得させる | [@fabianstelzer](https://x.com/fabianstelzer/status/2121876478304415929) |

## Installation

```
/plugin install prompts@pokutuna-plugins
```

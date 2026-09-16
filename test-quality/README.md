# test-quality

テストの価値を判定するための Claude Code プラグイン。プログラミング言語に依存しない、
自動テストのプラクティスを扱う。

判定の軸は「このテストが落ちるとき、何が壊れているのか」を一文で言えるかに置く。
言えないテストは削除候補として扱う。

コーディングエージェントによる実装では、実装を参照しながらテストを書くために
低価値なテストが量産されやすい。その類型と判断基準をまとめている。

## Skills

| Skill | Description |
|-------|-------------|
| [`test-policy`](skills/test-policy/SKILL.md) | 価値のあるテストを書く方針 |
| [`prune-tests`](skills/prune-tests/SKILL.md) | 低価値なテストを見分けて削除・集約する |

## Installation

```
/plugin install test-quality@pokutuna-plugins
```

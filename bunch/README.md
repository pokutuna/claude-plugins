# bunch

大きなタスクや探索的なタスクを段階に分けて進め、進捗と軌道修正をドキュメントに残す Claude Code プラグイン。

```
<作業ディレクトリ>/
  20261004-foobar.md           Bunch Document。Goal, Approach & Rules, Tasks, Timeline など
  20261004-foobar/01-setup.md  Task Document。タスク 1 つの Goal, Done When, Context, Work Log など
```

既定の配置は上のとおり。プロジェクトの慣習やユーザの指示があればそれに従う。

## Skills

| Skill | Description |
|-------|-------------|
| [`bunch`](skills/bunch/SKILL.md) | タスクを分割して計画し、各タスクの結果を見て Bunch Document を更新しながら進める |
| [`task`](skills/task/SKILL.md) | Task Document 1 つを受け取って進める。SubAgent に任せる場合もこれを読ませる |

## Installation

```
/plugin install bunch@pokutuna-plugins
```

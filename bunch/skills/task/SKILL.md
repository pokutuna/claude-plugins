---
name: task
description: Work on one task split out by a bunch. Loaded from the bunch skill or by a subagent.
allowed-tools:
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/log.sh *)
---

# Task

Task Document のパスを受け取り、タスクを進める。

- タスクの区切りごとに Work Log に記録する
  - 判断とその理由 / 進んだこと / 試してやめたこと / ユーザからの軌道修正 / エスカレーション など
  - 追記は `${CLAUDE_PLUGIN_ROOT}/scripts/log.sh` を使う
    ```sh
    bash ${CLAUDE_PLUGIN_ROOT}/scripts/log.sh <Task Document のパス> <<'EOF'
    {{したこと・おきたこと}}
    - {{補足(任意)}}
    EOF
    ```
- 想定を外れた問題が起きたら、無理に解決せずエスカレーションする
  - 自分で解決できない問題 / Goal・Done When が実情に合わない / 先に片付けるべき課題が見つかった / Goal に釣り合わない複雑さが要る など
- Done When で Goal の達成を確かめたら / 中止を指示されたら Task Document の `{{END: ...}}` を埋めて終了する

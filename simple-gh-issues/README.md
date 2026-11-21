# simple-gh-issues

GitHub Issues を、コードやドキュメントに残した参照と一緒に管理する Claude Code プラグイン。

`gh` を直接使えば Issue の操作はできる。このプラグインが決めるのは、その周りの規約である。

- Issue を指す参照は `Issue:owner/repo#N` の形で書く。`rg` で一覧でき、どのリポジトリの Issue かも明確になる
- 作業の結果や途中経過は Issue のコメントに書き残す。調査の結論が会話の中にしか残らない状態を避ける
- close するときは参照を整理する。未解決の印として置いた参照は消し、経緯の記録として書いた参照は残す

## Skills

| Skill | Description |
|-------|-------------|
| `issues` | `create` / `list [all]` / `do <number>` / `close <number>` |

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh auth login` 済み)
- [ripgrep](https://github.com/BurntSushi/ripgrep)

## Installation

```
/plugin install simple-gh-issues@pokutuna-plugins
```

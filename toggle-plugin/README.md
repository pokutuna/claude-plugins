# toggle-plugin

Turn plugins and skills on or off for each settings layer (user, project, local) in a pane.

## Overview

`/toggle` opens a pane with two tabs:

- **Plugins**: `enabledPlugins` for every plugin installed for you or for this project.
- **Skills**: `skillOverrides` for the skills in `~/.claude/skills` and `.claude/skills`, plus any name a layer already overrides.

Each row shows the value that wins on the left, then one cell per layer. Pressing a cell only stages the change. Nothing is written until you review the changes and save them, and the save refuses anything it cannot write back exactly (see [How saving stays safe](#how-saving-stays-safe)).

> **Requires a Claude Code build with mods** (function hooks, early access). On a build without them the plugin does not work, and the build may report a plugin load error.

> **Start Claude Code at the repository root.** The project layer is `.claude/` in the folder the session started in, and only plugins installed for that folder are listed.

## Install

```bash
claude plugin marketplace add pokutuna/claude-plugins
claude plugin install toggle-plugin@pokutuna-plugins --scope user
```

> **Note:** We recommend `--scope user` (default). See [Recommendation](https://github.com/pokutuna/claude-plugins#recommendation).

## Usage

```
/toggle            # open the pane on the last tab
/toggle plugins    # open it on the Plugins tab
/toggle skills     # open it on the Skills tab
```

```
[Plugins (12)] [Skills (30)] [Reload]
/Users/me/src/repo
user    ~/.claude/settings.json  (all projects)
project .claude/settings.json
local   .claude/settings.local.json
[+] on [-] off [ ] inherit * unsaved
2 unsaved [Review & save] [Undo all]
    plugin                         user project local
[+] runpod@pokutuna-plugins        [-]  [+]     [ ]
[-] difit@pokutuna-plugins         [+]  [ ]     [-]*
```

| Mark | Meaning |
| --- | --- |
| `[+]` / `[-]` | on / off |
| `[ ]` | not set in this layer; the layer below decides |
| `[n]` / `[u]` | skill `name-only` / `user-invocable-only` |
| `*` | staged, not saved |
| ` - ` | not offered (the user cell of a plugin installed for this project alone) |

The left mark is the value in effect: local over project over user. A skill name in the project color lives in `.claude/skills`.

| Key | Action |
| --- | --- |
| Tab / arrows, Enter | move between cells, press one |
| `1` / `2` | Plugins / Skills tab |
| `r` | read the settings files again |
| `s` | review the staged changes; `s` again saves them |
| `u` | drop every staged change |
| Esc | in the review, back to the list; with changes staged, warn once, then drop them and close |

Pressing a cell cycles its value:

- Plugins, user layer: on ↔ off.
- Plugins, project and local layers: unset → on → off → unset.
- Skills, every layer: unset → on → name-only → user-invocable-only → off → unset.

Run `/reload-plugins` after saving plugin changes. Skill changes need no reload.

> **Plugin skills cannot be overridden.** `skillOverrides` applies to the skills in `~/.claude/skills` and `.claude/skills`, not to a plugin's skills (Claude Code 2.1.322). To stop a plugin's skills, turn the plugin off.

## How saving stays safe

Each settings file is saved on its own. A file is left untouched when any check fails:

1. It must parse as a JSON object. A missing or empty file counts as `{}`.
2. `enabledPlugins` and `skillOverrides`, when present, must be objects.
3. Each staged key must still hold the value it held when you pressed the cell. The file is read for this just before the write. If another process changed the key, reload and press again.
4. Parsing the file and printing it back must give the same text. Indentation and the final newline follow the file, so a file in any other layout is refused rather than reformatted.
5. The new content must differ from the old only in the staged keys.
6. The file is read back after the write. If it differs from what was written, the old text is written back. A file the save created is left as `{}`, as the mod API cannot delete files.

A file that does not parse takes only its own layer out of the pane: its path is marked unreadable and its cells are not offered. The other layers still work.

Each staged change remembers its file. When the project folder changes during the session (`/cd`, a worktree move), the next reload drops the changes staged for the old folder instead of saving them to the new one.

A symlink, such as `~/.claude/settings.json` kept in a dotfiles repository, is written through, so the link stays.

When one file fails, the files before it stay saved and the pane names the file that failed. Its changes stay staged.

The mod API has no rename, so the write is not atomic. If Claude Code dies in the middle of a write, the file may be left cut short.

## Development

```bash
claude --plugin-dir ./toggle-plugin     # a session with this folder loaded
claude plugin validate ./toggle-plugin
claude plugin test ./toggle-plugin
```

Once Claude Code has loaded the folder, it writes the API types to `.claude-plugin/types/` (gitignored), and `npx -p typescript tsc -p toggle-plugin` type-checks the mod.

## Upgrading from 0.1.x

0.1.x was a skill (`/toggle-plugin enable <name>`) that wrote `.claude/settings.json`. 0.2.0 replaces it with the `/toggle` pane, and nothing needs to be migrated: the settings files are the same.

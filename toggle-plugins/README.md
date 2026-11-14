# toggle-plugins

Turn plugins and skills on or off for each settings layer (user, project, local) in a pane.

## Overview

`/toggle-plugins` opens a pane with two tabs:

- **Plugins**: `enabledPlugins` for every plugin installed for you or for this project.
- **Skills**: `skillOverrides` for your skills and command files (`~/.claude/skills`, `~/.claude/commands`), the project's (`.claude/skills`, `.claude/commands`, and what the session loaded from a parent folder or an added directory), the skills synced from claude.ai (`anthropic-skills:<name>`), plus any name a layer already overrides.

Each row shows the value that wins on the left, then one cell per layer. Pressing a cell only stages the change. Nothing is written until you review the changes and save them, and the save changes only the keys you pressed (see [How saving stays safe](#how-saving-stays-safe)).

> **Requires a Claude Code build with mods** (function hooks, early access). On a build without them the plugin does not work, and the build may report a plugin load error.

> **The project layer follows the session's folder.** `.claude/settings.json` is read from the folder the session is in (where it started, or where `/cd` took it), and only plugins installed for that folder are listed. `.claude/settings.local.json` is the one beside it, so in a git worktree both files are the worktree's own and a change stays there.

> **The repository root's `settings.local.json` also applies.** When the session's folder is not the repository root (a subfolder, or a worktree, whose root is the original repository), Claude Code reads that root's `settings.local.json` too, and its value wins for a key both files set. The pane shows such a value as the left mark and does not change that file.

## Install

```bash
claude plugin marketplace add pokutuna/claude-plugins
claude plugin install toggle-plugins@pokutuna-plugins --scope user
```

> **Note:** We recommend `--scope user` (default). See [Recommendation](https://github.com/pokutuna/claude-plugins#recommendation).

## Usage

```
/toggle-plugins            # open the pane on the last tab
/toggle-plugins plugins    # open it on the Plugins tab
/toggle-plugins skills     # open it on the Skills tab
```

```
[Plugins (12)] [Skills (30)] [Refresh]
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
| ` - ` | not offered (the user cell of a plugin installed for this project alone, or a layer whose file is unreadable) |
| ` ? ` | the layer holds a value the pane does not know, so it is left alone; edit it by hand |

The left mark is the value in effect: local over project over user. A value from `--settings`, managed settings, or the repository root's `settings.local.json` (see above) wins over all three; the pane says how many rows have one, shows it as the left mark, and cannot change it. A skill name in the project color is not one of your own skills or command files.

| Key | Action |
| --- | --- |
| Tab / arrows, Enter | move between cells, press one |
| `1` / `2` | Plugins / Skills tab |
| `r` | Refresh: read the settings files again (this is not `/reload-plugins`) |
| `s` | review the staged changes; `s` again saves them |
| `u` | drop every staged change |
| Esc | in the review, back to the list; with changes staged, warn once, then drop them and close |

Pressing a cell cycles its value:

- Plugins, user layer: on ↔ off.
- Plugins, project and local layers: unset → on → off → unset.
- Skills, every layer: unset → on → name-only → user-invocable-only → off → unset.

A save runs `/reload-plugins` and `/reload-skills` for you, once the session is idle. If a reload fails, the pane says so; run `/reload-plugins` yourself.

> **Plugin skills cannot be overridden.** `skillOverrides` applies to your and the project's skills and command files, not to a plugin's skills (Claude Code 2.1.323). To stop a plugin's skills, turn the plugin off.

## How saving stays safe

Each settings file is saved on its own. A file is left untouched when any check fails:

1. It must parse as a JSON object. A missing or empty file counts as `{}`.
2. `enabledPlugins` and `skillOverrides`, when present, must be objects.
3. Each staged key must still hold the value it held when you pressed the cell. The file is read for this just before the write. If another process changed the key, refresh and press again.
4. The new content must differ from the old only in the staged keys.
5. The file is read back after the write and compared as JSON, so a formatter that lays the file out again does not fail the save. If the content differs, the old text is written back. A file the save created is left as `{}`, as the mod API cannot delete files.

The order of the keys is kept, and a new key goes last in its section. A file is refused when writing it back would change more than spacing: a repeated key, a number-only key (JSON printing moves it to the front), or a number or escape written another way.

The file is written with its own indentation and final newline. A file in another layout (one line, aligned values) is saved all the same and comes back in the plain layout; the pane then says `(reformatted)` beside its path.

A file that does not parse takes only its own layer out of the pane: its path is marked unreadable and its cells are not offered. The other layers still work. An unreadable `installed_plugins.json` is named above the rows, and the Plugins tab then lists only the plugins a settings file names.

Each staged change remembers its file. When the project folder changes during the session (`/cd`, a worktree move), the next refresh drops the changes staged for the old folder instead of saving them to the new one.

A symlink, such as `~/.claude/settings.json` kept in a dotfiles repository, is written through, so the link stays.

When one file fails, the files before it stay saved. The pane stays on the review and names the file that failed and why, on its own line in the error color. Its changes stay staged.

The mod API has no rename, so the write is not atomic. If Claude Code dies in the middle of a write, the file may be left cut short.

## Development

```bash
claude --plugin-dir ./toggle-plugins     # a session with this folder loaded
claude plugin validate ./toggle-plugins
claude plugin test ./toggle-plugins
```

Once Claude Code has loaded the folder, it writes the API types to `.claude-plugin/types/` (gitignored), and `npx -p typescript tsc -p toggle-plugins` type-checks the mod.

## Upgrading

- **From 0.2.x**: the plugin was `toggle-plugin` and its command `/toggle`. Both are `toggle-plugins` from 0.3.0. Uninstall `toggle-plugin@pokutuna-plugins` and install `toggle-plugins@pokutuna-plugins`.
- **From 0.1.x**: it was a skill (`/toggle-plugin enable <name>`) that wrote `.claude/settings.json`. The pane replaces it, and nothing needs to be migrated: the settings files are the same.

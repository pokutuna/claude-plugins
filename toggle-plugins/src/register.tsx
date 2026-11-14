import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type {
  CellValue,
  Edit,
  Layer,
  PluginRow,
  SectionKey,
  SkillMode,
  SkillRow,
  Snapshot,
  Tab,
} from "../types";
import {
  LAYERS,
  SKILL_MODES,
  editId,
  effective,
  isObject,
  nextPluginValue,
  nextSkillValue,
  planFile,
  sameJson,
  section,
  shortPath,
  shown,
} from "./logic";
import type { Json } from "./logic";

const PANE = "toggle";
const COMMAND = "toggle-plugins";

const tabAtom = atom(
  { plugin: "toggle-plugins", key: "tab" } as const,
  "plugins" as Tab,
);
const messageAtom = atom(
  { plugin: "toggle-plugins", key: "message" } as const,
  null as string | null,
);
// What a save could not do, drawn apart from `message` in the error color.
const failureAtom = atom(
  { plugin: "toggle-plugins", key: "failure" } as const,
  null as string | null,
);
// Change the tag when Snapshot's fields change: it declines what an earlier
// version stored, which outlives a reload.
const snapshotAtom = atom(
  { plugin: "toggle-plugins", key: "snapshot" } as const,
  null,
  { shape: "snapshot-5" },
);

// Changes pressed and not yet saved; the tag guards the stored shape as above.
const pendingAtom = atom(
  { plugin: "toggle-plugins", key: "pending" } as const,
  [] as Edit[],
  { shape: "pending-2" },
);
const reviewingAtom = atom(
  { plugin: "toggle-plugins", key: "isReviewing" } as const,
  false,
);
const closeWarnedAtom = atom(
  { plugin: "toggle-plugins", key: "isCloseWarned" } as const,
  false,
);

/** The name color of a skill or command that is not the user's own. */
const PROJECT_COLOR = "suggestion";

type $ = EngineInterface;

// ---- reading -------------------------------------------------------------

async function readJson($: $, path: string): Promise<Json> {
  if (!(await $.fs.exists(path))) return {};
  const text = await $.fs.read(path);
  if (!text.trim()) return {};
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw new Error(`${path} is not a JSON object`);

  return value;
}

async function configDir($: $): Promise<string> {
  const home = (await $.env.get("HOME")) ?? "";

  return (await $.env.get("CLAUDE_CONFIG_DIR")) ?? `${home}/.claude`;
}

async function skillDirs($: $, dir: string): Promise<string[]> {
  if (!(await $.fs.exists(dir))) return [];
  const names: string[] = [];
  for (const entry of await $.fs.list(dir)) {
    if (entry.name.startsWith(".")) continue;
    if (entry.kind === "file") continue;
    if (await $.fs.exists(`${dir}/${entry.name}/SKILL.md`))
      names.push(entry.name);
  }

  return names;
}

/** The command names of a commands folder: `a/b.md` is `a:b`. */
async function commandFiles($: $, dir: string, prefix = ""): Promise<string[]> {
  if (!(await $.fs.exists(dir))) return [];
  const names: string[] = [];
  for (const entry of await $.fs.list(dir)) {
    if (entry.name.startsWith(".")) continue;
    if (entry.kind === "dir") {
      // Four folders deep is past any real layout, and stops a loop.
      if (prefix.split(":").length <= 4)
        names.push(
          ...(await commandFiles(
            $,
            `${dir}/${entry.name}`,
            `${prefix}${entry.name}:`,
          )),
        );
    } else if (entry.name.endsWith(".md")) {
      names.push(`${prefix}${entry.name.slice(0, -3)}`);
    }
  }

  return names;
}

/** The prefix of a claude.ai synced skill's full name. */
const SYNCED = "anthropic-skills:";

/** The skills claude.ai synced, by the short names the session lists. */
async function syncedSkills($: $, config: string): Promise<Set<string>> {
  const dir = `${config}/skills/synced`;
  const names = new Set<string>();
  if (!(await $.fs.exists(dir))) return names;
  for (const entry of await $.fs.list(dir)) {
    if (entry.kind === "file") continue;
    for (const name of await skillDirs($, `${dir}/${entry.name}`))
      names.add(name);
  }

  return names;
}

/**
 * The repository root's settings.local.json when the session's folder is not
 * that root (a subfolder, or a worktree, whose root is the original
 * repository), else null. The engine reads it beside the session folder's
 * and lets it win; the pane shows it and edits the session folder's alone.
 */
async function rootLocal($: $, cwd: string): Promise<string | null> {
  try {
    const repo = await $.session.repo();
    const home = (await $.env.get("HOME")) ?? "";
    if (repo && repo.root !== cwd && repo.root !== home)
      return `${repo.root}/.claude/settings.local.json`;
  } catch {
    // No answer: the session folder's file alone.
  }

  return null;
}

function settingsFiles(config: string, cwd: string): Record<Layer, string> {
  return {
    user: `${config}/settings.json`,
    // Absolute: `$.fs` resolves a relative path against the process, which
    // need not be the session's folder.
    project: `${cwd}/.claude/settings.json`,
    local: `${cwd}/.claude/settings.local.json`,
  };
}

async function loadSnapshot(
  $: $,
  cwd: string,
  files: Record<Layer, string>,
  above: string | null,
): Promise<Snapshot> {
  const config = await configDir($);
  const warnings: string[] = [];
  // A file that does not read takes its own layer out, not the pane.
  const layers: Record<Layer, Json> = { user: {}, project: {}, local: {} };
  const broken: Snapshot["broken"] = {};
  for (const layer of LAYERS) {
    try {
      layers[layer] = await readJson($, files[layer]);
    } catch (error) {
      broken[layer] = error instanceof Error ? error.message : String(error);
    }
  }

  // What wins over the three layers, highest first; the pane cannot change it.
  const upper: Json[] = [];
  for (const source of ["policy", "flag"] as const) {
    try {
      const held: unknown = await $.settings.read({ source });
      if (isObject(held)) upper.push(held);
    } catch {
      // A build without the read: the left mark shows the three layers alone.
    }
  }
  // The repository root's local file wins over the session folder's.
  if (above !== null) {
    try {
      upper.push(await readJson($, above));
    } catch {
      warnings.push(`${above} is unreadable; its values are not shown`);
    }
  }
  const aboveValue = (sectionKey: SectionKey, key: string): unknown =>
    upper.map((u) => section(u, sectionKey)[key]).find((v) => v !== undefined);
  /** The layers where `key` holds something `read` does not take. */
  const oddLayers = (
    sectionKey: SectionKey,
    key: string,
    read: (v: unknown) => CellValue,
  ) =>
    LAYERS.filter((layer) => {
      const v = section(layers[layer], sectionKey)[key];

      return v !== undefined && read(v) === null;
    });

  // Plugins: installed for the user or for this project, plus any id a layer names.
  const pluginIds = new Set<string>();
  const installScope = new Map<string, PluginRow["installed"]>();
  let installed: Json = {};
  try {
    installed = await readJson($, `${config}/plugins/installed_plugins.json`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(
      `installed_plugins.json unreadable (${reason}): only plugins a settings file names are listed`,
    );
  }
  for (const [id, records] of Object.entries(section(installed, "plugins"))) {
    const list = Array.isArray(records) ? records : [];
    const isHere = list.some(
      (r) => isObject(r) && (r.scope === "user" || r.projectPath === cwd),
    );
    if (isHere) pluginIds.add(id);
    if (list.length > 0) {
      const hasUser = list.some((r) => isObject(r) && r.scope === "user");
      installScope.set(id, hasUser ? "user" : "project");
    }
  }
  for (const layer of LAYERS) {
    for (const id of Object.keys(section(layers[layer], "enabledPlugins")))
      pluginIds.add(id);
  }

  const asPlugin = (v: unknown) => (typeof v === "boolean" ? v : null);
  const pluginValue = (layer: Layer, id: string) =>
    asPlugin(section(layers[layer], "enabledPlugins")[id]);
  const plugins: PluginRow[] = [...pluginIds].sort().map((id) => ({
    id,
    installed: installScope.get(id) ?? null,
    user: pluginValue("user", id),
    project: pluginValue("project", id),
    local: pluginValue("local", id),
    odd: oddLayers("enabledPlugins", id, asPlugin),
    above: asPlugin(aboveValue("enabledPlugins", id)),
  }));

  // Skills and command files, which skillOverrides covers alike. The user's
  // own come first: where a name is in both, the user's is the one that runs.
  const origins = new Map<string, SkillRow["origin"]>();
  const add = (names: string[], origin: SkillRow["origin"]) => {
    for (const name of names) if (!origins.has(name)) origins.set(name, origin);
  };
  add(await skillDirs($, `${config}/skills`), "user");
  add(await commandFiles($, `${config}/commands`), "user");
  add(await skillDirs($, `${cwd}/.claude/skills`), "project");
  add(await commandFiles($, `${cwd}/.claude/commands`), "project");
  // What the session loaded from anywhere else: a parent folder's .claude, an
  // added directory's, and the skills claude.ai synced. A synced skill is
  // listed under its full name, which is the key that cannot be taken for a
  // skill of the user's. A plugin's skills are left out, as skillOverrides
  // does not reach them.
  try {
    const synced = await syncedSkills($, config);
    for (const { name } of (await $.command.list()).filter(
      (c) => c.source === "user",
    )) {
      if (name.startsWith(SYNCED)) add([name], "synced");
      else if (synced.has(name)) add([`${SYNCED}${name}`], "synced");
      else add([name], "project");
    }
  } catch {
    // The folders above are the list.
  }
  // Any name a layer overrides (bundled skills only show up this way).
  for (const layer of LAYERS)
    add(Object.keys(section(layers[layer], "skillOverrides")), "override");

  const asSkill = (v: unknown) =>
    SKILL_MODES.includes(v as SkillMode) ? (v as SkillMode) : null;
  const skillValue = (layer: Layer, name: string) =>
    asSkill(section(layers[layer], "skillOverrides")[name]);
  const skills: SkillRow[] = [...origins.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, origin]) => ({
      name,
      origin,
      user: skillValue("user", name),
      project: skillValue("project", name),
      local: skillValue("local", name),
      odd: oddLayers("skillOverrides", name, asSkill),
      above: asSkill(aboveValue("skillOverrides", name)),
    }));

  return { cwd, files, plugins, skills, broken, warnings };
}

/** Adds a sentence to the message line. */
async function note($: $, text: string) {
  await update($, messageAtom, (prev) =>
    [prev, text].filter(Boolean).join(". "),
  );
}

async function refresh($: $) {
  // Asked each time: /cd or a worktree move changes it with no session.start.
  const cwd = await $.session.root();
  const files = settingsFiles(await configDir($), cwd);
  let snapshot: Snapshot;
  try {
    snapshot = await loadSnapshot($, cwd, files, await rootLocal($, cwd));
  } catch (error) {
    // No rows rather than the last folder's, which a press would save there.
    snapshot = {
      cwd,
      files,
      plugins: [],
      skills: [],
      broken: {},
      warnings: [],
    };
    await note($, `Failed to read settings: ${String(error)}`);
  }
  await update($, snapshotAtom, () => snapshot);

  let dropped = 0;
  await update($, pendingAtom, (prev) => {
    const kept = prev.filter((p) => p.file === snapshot.files[p.layer]);
    dropped = prev.length - kept.length;

    return kept;
  });
  if (dropped > 0)
    await note(
      $,
      `Dropped ${dropped} change(s) staged for another folder's settings`,
    );
}

// ---- pending changes -----------------------------------------------------

/** Stages a change; one that brings a cell back to the file's value drops out. */
async function stage(
  $: $,
  layer: Layer,
  file: string,
  section: SectionKey,
  key: string,
  from: CellValue,
  value: CellValue,
) {
  const id = editId({ layer, section, key });
  await update($, pendingAtom, (prev) => {
    const rest = prev.filter((p) => editId(p) !== id);

    return value === from
      ? rest
      : [...rest, { layer, file, section, key, from, value }];
  });
  await update($, reviewingAtom, () => false);
  await update($, closeWarnedAtom, () => false);
}

async function discard($: $, message: string | null) {
  await update($, pendingAtom, () => []);
  await update($, reviewingAtom, () => false);
  await update($, closeWarnedAtom, () => false);
  await update($, messageAtom, () => message);
}

async function readText($: $, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? await $.fs.read(path) : "";
}

/**
 * Writes one file's staged changes, or throws why it did not. Answers
 * whether the file's layout changed with them.
 */
async function saveFile($: $, path: string, edits: Edit[]): Promise<boolean> {
  let target = path;
  const existed = await $.fs.exists(path);
  if (existed) {
    // Write through a symlink (the user settings live in dotfiles) instead of
    // replacing it with a plain file.
    const stat = await $.fs.stat(path, { resolve: true });
    if (stat.isLink && stat.realPath) target = stat.realPath;
  }

  // Read just before the write: planFile's check of each pressed key's value
  // is what refuses a file changed since the pane loaded.
  const original = await readText($, target);
  const plan = planFile(original, edits);
  if ("error" in plan) throw new Error(plan.error);
  await $.fs.write(target, plan.text);

  // Compared as JSON: a formatter may lay the file out again after the write.
  const written = await readText($, target);
  let isKept = false;
  try {
    isKept = sameJson(JSON.parse(written), JSON.parse(plan.text));
  } catch {
    // Not JSON any more: undone below.
  }
  if (!isKept) {
    // `$.fs` cannot delete, so a file this save created is left as `{}`.
    if (existed) {
      await $.fs.write(target, original);
      throw new Error("the file read back differently; restored the old text");
    }
    await $.fs.write(target, "{}\n");
    throw new Error("the new file read back differently; left it as {}");
  }

  return plan.reformatted;
}

async function saveAll($: $) {
  const snapshot = await read($, snapshotAtom);
  const pending = await read($, pendingAtom);
  if (snapshot === null || pending.length === 0) return;

  const home = (await $.env.get("HOME")) ?? "";
  const saved: Layer[] = [];
  const reformatted = new Set<Layer>();
  let failure: string | null = null;
  for (const layer of LAYERS) {
    const path = snapshot.files[layer];
    // An edit for another folder's file is left for refresh() to drop.
    const edits = pending.filter((p) => p.layer === layer && p.file === path);
    if (edits.length === 0) continue;
    try {
      if (await saveFile($, path, edits)) reformatted.add(layer);
      saved.push(layer);
      await update($, pendingAtom, (prev) =>
        prev.filter((p) => !(p.layer === layer && p.file === path)),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failure = `Not saved ${shortPath(home, snapshot.cwd, path)}: ${reason}`;
      break;
    }
  }

  const done =
    saved.length > 0
      ? `Saved ${saved
          .map(
            (l) =>
              shortPath(home, snapshot.cwd, snapshot.files[l]) +
              (reformatted.has(l) ? " (reformatted)" : ""),
          )
          .join(", ")}`
      : null;
  // A failure keeps the review open, where the unsaved changes are listed.
  if (failure === null) await update($, reviewingAtom, () => false);
  await update($, closeWarnedAtom, () => false);
  await update($, messageAtom, () => done);
  await update($, failureAtom, () => failure);
  await refresh($);

  // Last, after the pane is up to date: /reload-plugins may load this module
  // again, and what follows the call here would then not run.
  if (saved.length > 0) await applySaved($);
}

const RELOADS = ["reload-plugins", "reload-skills"];

/** Runs the reload commands this build has, so a save needs nothing typed. */
async function applySaved($: $) {
  try {
    const known = new Set((await $.command.list()).map((c) => c.name));
    for (const command of RELOADS)
      if (known.has(command)) await $.command.run({ command });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await update($, failureAtom, (prev) =>
      [prev, `Not reloaded: ${reason}; run /reload-plugins`]
        .filter(Boolean)
        .join(". "),
    );
  }
}

// ---- drawing -------------------------------------------------------------

type Mark = { text: string; color?: string };

// Every mark is 3 cells wide, so the columns line up. Unset is the empty box:
// nothing is written there, and the layer below decides.
const UNSET: Mark = { text: "[ ]" };

function pluginMark(value: boolean | null): Mark {
  if (value === null) return UNSET;

  return value
    ? { text: "[+]", color: "success" }
    : { text: "[-]", color: "error" };
}

const SKILL_MARK: Record<SkillMode, Mark> = {
  on: { text: "[+]", color: "success" },
  "name-only": { text: "[n]", color: "warning" },
  "user-invocable-only": { text: "[u]", color: "warning" },
  off: { text: "[-]", color: "error" },
};

function skillMark(value: SkillMode | null): Mark {
  return value === null ? UNSET : SKILL_MARK[value];
}

const OPEN = {
  id: PANE,
  title: "Toggle plugins",
  focus: true,
  closeOnEscape: true,
  // Docked width wanted (the engine caps it at 45% of the terminal).
  columns: 80,
} as const;

/** A `ui.close` answer that skips `next`, which keeps the pane open. */
const KEEP_OPEN = { value: undefined };

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Toggle plugins and skills for this project",
      argumentHint: "[plugins|skills]",
    });
    // Something to draw until the first refresh(), which reads the folder; a
    // snapshot already held (a reload) is kept for refresh() to replace.
    await update(
      $,
      snapshotAtom,
      (prev) =>
        prev ?? {
          cwd: e.cwd,
          files: { user: "", project: "", local: "" },
          plugins: [],
          skills: [],
          broken: {},
          warnings: [],
        },
    );

    return next(e);
  });

  on("command.run", { command: COMMAND }, async ($, e) => {
    try {
      const arg = e.args.trim();
      if (arg === "plugins" || arg === "skills")
        await update($, tabAtom, () => arg);
      await update($, messageAtom, () => null);
      await update($, failureAtom, () => null);
      await update($, reviewingAtom, () => false);
      await update($, closeWarnedAtom, () => false);
      await refresh($);
      await $.ui.open(OPEN);

      return { text: "Opened the toggle pane." };
    } catch (error) {
      return { text: `toggle: ${String(error)}` };
    }
  });

  // Esc with unsaved changes: in the review, back to the list; else warn once,
  // and the next Esc discards them and closes.
  on("ui.close", async ($, e, next) => {
    if (e.id !== PANE || e.origin.kind !== "person") return next(e);
    const pending = await read($, pendingAtom);
    if (pending.length === 0) return next(e);
    if (await read($, reviewingAtom)) {
      await update($, reviewingAtom, () => false);

      return KEEP_OPEN;
    }
    if (!(await read($, closeWarnedAtom))) {
      await update($, closeWarnedAtom, () => true);
      await update(
        $,
        messageAtom,
        () =>
          `${pending.length} unsaved change(s). Esc again discards them; s saves.`,
      );

      return KEEP_OPEN;
    }
    await discard($, null);

    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const snapshot = await read($, snapshotAtom);
    const tab = await read($, tabAtom);
    const message = await read($, messageAtom);
    const failure = await read($, failureAtom);
    const pending = await read($, pendingAtom);
    const isReviewing = (await read($, reviewingAtom)) && pending.length > 0;

    if (snapshot === null) return <Text dimColor>Loading...</Text>;

    const home = (await $.env.get("HOME")) ?? "";

    const markText = (m: Mark, bold = false) =>
      m.color ? (
        <Text color={m.color} bold={bold}>
          {m.text}
        </Text>
      ) : (
        <Text dimColor>{m.text}</Text>
      );

    // Wrapped: a refusal's reason is the part worth reading.
    const messageLine = (message !== null || failure !== null) && (
      <Box flexDirection="column">
        {message !== null && (
          <Text color="suggestion" wrap="wrap">
            {message}
          </Text>
        )}
        {failure !== null && (
          <Text color="error" wrap="wrap">
            {failure}
          </Text>
        )}
      </Box>
    );

    // The changes, file by file, and the buttons that write or drop them.
    if (isReviewing) {
      return (
        <Box flexDirection="column">
          <Text bold>Save these changes?</Text>
          {LAYERS.filter((l) => pending.some((p) => p.layer === l)).map(
            (layer) => (
              <Box key={`review:${layer}`} flexDirection="column">
                <Text wrap="truncate-start">
                  {shortPath(home, snapshot.cwd, snapshot.files[layer])}
                  <Text dimColor>
                    {layer === "user"
                      ? "  (user: all projects)"
                      : `  (${layer})`}
                  </Text>
                </Text>
                {pending
                  .filter((p) => p.layer === layer)
                  .map((p) => (
                    <Text key={`review:${editId(p)}`} wrap="truncate-end">
                      {"  "}
                      <Text dimColor>{p.section}.</Text>
                      {p.key}: {shown(p.from)} →{" "}
                      <Text bold>{shown(p.value)}</Text>
                    </Text>
                  ))}
              </Box>
            ),
          )}
          <Box flexDirection="row" gap={1}>
            <Button
              key="confirm"
              hotkey="s"
              label="Save"
              variant="primary"
              autoFocus
              onPress={() => saveAll($)}
            />
            <Button
              key="back"
              hotkey="b"
              label="Back"
              onPress={() => update($, reviewingAtom, () => false)}
            />
          </Box>
          {messageLine}
        </Box>
      );
    }

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button
            key="tab-plugins"
            hotkey="1"
            label={`Plugins (${snapshot.plugins.length})`}
            variant={tab === "plugins" ? "primary" : "secondary"}
            onPress={() => update($, tabAtom, () => "plugins")}
          />
          <Button
            key="tab-skills"
            hotkey="2"
            label={`Skills (${snapshot.skills.length})`}
            variant={tab === "skills" ? "primary" : "secondary"}
            onPress={() => update($, tabAtom, () => "skills")}
          />
          <Button
            key="refresh"
            hotkey="r"
            label="Refresh"
            onPress={async () => {
              await update($, messageAtom, () => null);
              await update($, failureAtom, () => null);
              await refresh($);
            }}
          />
        </Box>
        <Text dimColor wrap="truncate-start">
          {snapshot.cwd}
        </Text>
        {LAYERS.map((layer) => (
          <Text key={`file:${layer}`} dimColor wrap="truncate-end">
            {layer.padEnd(8)}
            {shortPath(home, snapshot.cwd, snapshot.files[layer])}
            {layer === "user" ? "  (all projects)" : ""}
            {snapshot.broken[layer] !== undefined && (
              <Text color="error">{`  unreadable: ${snapshot.broken[layer]}`}</Text>
            )}
          </Text>
        ))}
        {snapshot.warnings.map((w) => (
          <Text key={`warning:${w}`} color="error" wrap="wrap">
            {w}
          </Text>
        ))}
        <Text wrap="truncate-end">
          <Text color="success">[+]</Text> on <Text color="error">[-]</Text> off{" "}
          <Text dimColor>[ ]</Text> inherit <Text color="warning">*</Text>{" "}
          unsaved
          {tab === "skills" && (
            <Text>
              {"  "}
              <Text color="warning">[n]</Text> name-only{" "}
              <Text color="warning">[u]</Text> user-invocable-only{"  "}
              <Text color={PROJECT_COLOR}>name</Text> project
            </Text>
          )}
        </Text>
        {/* Always one line, blank with nothing staged, so the rows below
            stay put when the first change is pressed. */}
        {pending.length === 0 ? (
          <Text> </Text>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text color="warning" bold>
              {pending.length} unsaved
            </Text>
            <Button
              key="save"
              hotkey="s"
              label="Review & save"
              variant="primary"
              onPress={async () => {
                await update($, reviewingAtom, () => true);
                await update($, closeWarnedAtom, () => false);
              }}
            />
            <Button
              key="undo"
              hotkey="u"
              label="Undo all"
              onPress={() =>
                discard($, `Discarded ${pending.length} change(s).`)
              }
            />
          </Box>
        )}
        {messageLine}
      </Box>
    );

    const fit = (name: string, width: number) => {
      if (width <= 0) return "";

      return name.length > width
        ? `${name.slice(0, width - 1)}…`
        : name.padEnd(width);
    };

    // The name column takes what the mark and the three buttons leave.
    // Each layer's cell is as wide as its name ("project"), so the header reads
    // in full above a 3-cell mark.
    const nameWidth = (names: string[]) => {
      const fixed = 3 + 1 + LAYERS.reduce((sum, l) => sum + l.length + 1, 0);
      const longest = Math.max(...names.map((n) => n.length), 6);

      return Math.max(8, Math.min(longest, e.props.bodyColumns - fixed - 1));
    };

    // Splits "name@market" into the name and a dim "@market", cutting the
    // market first so the name stays readable.
    const nameCells = (label: string, width: number, color?: string) => {
      const at = label.indexOf("@");
      if (at < 0)
        return (
          <Text color={color} wrap="truncate-end">
            {fit(label, width)}
          </Text>
        );
      const name = label.slice(0, at);
      if (name.length >= width)
        return <Text wrap="truncate-end">{fit(name, width)}</Text>;

      return (
        <Text wrap="truncate-end">
          {name}
          <Text dimColor>{fit(label.slice(at), width - name.length)}</Text>
        </Text>
      );
    };

    // A row's values with its staged changes laid over the file's.
    const staged = <T extends CellValue>(
      sectionKey: SectionKey,
      key: string,
      row: Record<Layer, T | null>,
    ) => {
      const values = { ...row } as Record<Layer, T | null>;
      const changed = new Set<Layer>();
      for (const p of pending) {
        if (p.section !== sectionKey || p.key !== key) continue;
        values[p.layer] = p.value as T | null;
        changed.add(p.layer);
      }

      return { values, changed };
    };

    // One row: the effective value, the name, then a button per layer.
    const row = <T extends CellValue>(r: {
      key: string;
      name: string;
      width: number;
      section: SectionKey;
      /** The row as the files hold it. */
      file: Record<Layer, T | null> & { odd: Layer[]; above: T | null };
      mark: (v: T | null) => Mark;
      /** The value in effect when no layer sets one. */
      fallback: T | null;
      next: (layer: Layer, current: T | null) => T | null;
      /** A cell that would change nothing, so is not offered. */
      isPointless?: (layer: Layer) => boolean;
      nameColor?: string;
    }) => {
      const { values, changed } = staged(r.section, r.name, r.file);
      // Why a layer's cell is not a button: "?" holds a value the pane does
      // not know, "-" is unreadable or would change nothing.
      const closed = (layer: Layer) => {
        if (layer in snapshot.broken) return " - ";
        if (r.file.odd.includes(layer)) return " ? ";

        return r.isPointless?.(layer) ? " - " : null;
      };

      return (
        <Box key={r.key} flexDirection="row" gap={1}>
          {markText(
            r.mark(r.file.above ?? effective(values) ?? r.fallback),
            true,
          )}
          {nameCells(r.name, r.width, r.nameColor)}
          {LAYERS.map((layer) => (
            <Box key={`${r.key}:${layer}:cell`} width={layer.length}>
              {closed(layer) !== null ? (
                <Text dimColor>{closed(layer)}</Text>
              ) : (
                <Button
                  key={`${r.key}:${layer}`}
                  plain
                  onPress={() =>
                    stage(
                      $,
                      layer,
                      snapshot.files[layer],
                      r.section,
                      r.name,
                      r.file[layer],
                      r.next(layer, values[layer]),
                    )
                  }
                >
                  {markText(r.mark(values[layer]))}
                  <Text color="warning" bold>
                    {changed.has(layer) ? "*" : " "}
                  </Text>
                </Button>
              )}
            </Box>
          ))}
        </Box>
      );
    };

    // Says so when a row's left mark comes from above the three layers.
    const aboveNote = (rows: { above: CellValue }[]) => {
      const count = rows.filter((x) => x.above !== null).length;

      return (
        count > 0 && (
          <Text dimColor wrap="wrap">
            {count} row(s) are set by --settings, managed settings, or the
            repository root's settings.local.json; the left mark shows that
            value, and no cell here changes it.
          </Text>
        )
      );
    };

    const columns = (label: string, width: number) => (
      <Text dimColor wrap="truncate-end">
        {"   "} {fit(label, width)} {LAYERS.join(" ")}
      </Text>
    );

    if (tab === "plugins") {
      const width = nameWidth(snapshot.plugins.map((p) => p.id));

      return (
        <Box flexDirection="column">
          {header}
          {aboveNote(snapshot.plugins)}
          {columns("plugin", width)}
          {snapshot.plugins.map((p) =>
            row({
              key: `p:${p.id}`,
              name: p.id,
              width,
              section: "enabledPlugins",
              file: p,
              mark: pluginMark,
              fallback: null,
              next: nextPluginValue,
              // Installed for this project alone: a user value would reach no
              // other project, so the user cell is not offered.
              isPointless: (layer) =>
                layer === "user" &&
                p.installed === "project" &&
                p.user === null,
            }),
          )}
        </Box>
      );
    }

    const width = nameWidth(snapshot.skills.map((s) => s.name));

    return (
      <Box flexDirection="column">
        {header}
        {aboveNote(snapshot.skills)}
        {columns("skill", width)}
        {snapshot.skills.map((s) =>
          row({
            key: `s:${s.name}`,
            name: s.name,
            width,
            section: "skillOverrides",
            file: s,
            mark: skillMark,
            fallback: "on",
            next: (_, current) => nextSkillValue(current),
            nameColor: s.origin === "project" ? PROJECT_COLOR : undefined,
          }),
        )}
      </Box>
    );
  });
};

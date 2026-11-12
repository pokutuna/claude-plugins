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
  section,
  shortPath,
  shown,
} from "./logic";
import type { Json } from "./logic";

const PANE = "toggle";
const COMMAND = "toggle";

const tabAtom = atom(
  { plugin: "toggle-plugin", key: "tab" } as const,
  "plugins" as Tab,
);
const messageAtom = atom(
  { plugin: "toggle-plugin", key: "message" } as const,
  null as string | null,
);
// Change the tag when Snapshot's fields change: it declines what an earlier
// version stored, which outlives a reload.
const snapshotAtom = atom(
  { plugin: "toggle-plugin", key: "snapshot" } as const,
  null,
  { shape: "snapshot-4" },
);

// Changes pressed and not yet saved; the tag guards the stored shape as above.
const pendingAtom = atom(
  { plugin: "toggle-plugin", key: "pending" } as const,
  [] as Edit[],
  { shape: "pending-2" },
);
const reviewingAtom = atom(
  { plugin: "toggle-plugin", key: "isReviewing" } as const,
  false,
);
const closeWarnedAtom = atom(
  { plugin: "toggle-plugin", key: "isCloseWarned" } as const,
  false,
);

/** The name color of a skill that lives in this project's .claude/skills. */
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

function settingsFiles(config: string, cwd: string): Record<Layer, string> {
  return {
    user: `${config}/settings.json`,
    // Absolute: `$.fs` resolves a relative path against the process, which
    // need not be the session's folder.
    project: `${cwd}/.claude/settings.json`,
    local: `${cwd}/.claude/settings.local.json`,
  };
}

async function loadSnapshot($: $, cwd: string): Promise<Snapshot> {
  const config = await configDir($);
  const files = settingsFiles(config, cwd);
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

  // Plugins: installed for the user or for this project, plus any id a layer names.
  const pluginIds = new Set<string>();
  const installScope = new Map<string, PluginRow["installed"]>();
  const installed = await readJson(
    $,
    `${config}/plugins/installed_plugins.json`,
  );
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

  const pluginValue = (layer: Layer, id: string): boolean | null => {
    const v = section(layers[layer], "enabledPlugins")[id];

    return typeof v === "boolean" ? v : null;
  };
  const plugins: PluginRow[] = [...pluginIds].sort().map((id) => ({
    id,
    installed: installScope.get(id) ?? null,
    user: pluginValue("user", id),
    project: pluginValue("project", id),
    local: pluginValue("local", id),
  }));

  // Skills: the user and project skills folders, plus any name a layer overrides
  // (bundled skills only show up this way).
  const origins = new Map<string, SkillRow["origin"]>();
  for (const name of await skillDirs($, `${config}/skills`))
    origins.set(name, "user");
  for (const name of await skillDirs($, `${cwd}/.claude/skills`))
    origins.set(name, "project");
  for (const layer of LAYERS) {
    for (const name of Object.keys(section(layers[layer], "skillOverrides"))) {
      if (!origins.has(name)) origins.set(name, "override");
    }
  }

  const skillValue = (layer: Layer, name: string): SkillMode | null => {
    const v = section(layers[layer], "skillOverrides")[name];

    return SKILL_MODES.includes(v as SkillMode) ? (v as SkillMode) : null;
  };
  const skills: SkillRow[] = [...origins.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, origin]) => ({
      name,
      origin,
      user: skillValue("user", name),
      project: skillValue("project", name),
      local: skillValue("local", name),
    }));

  return { cwd, files, plugins, skills, broken };
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
  let snapshot: Snapshot;
  try {
    snapshot = await loadSnapshot($, cwd);
  } catch (error) {
    // No rows rather than the last folder's, which a press would save there.
    snapshot = {
      cwd,
      files: settingsFiles(await configDir($), cwd),
      plugins: [],
      skills: [],
      broken: {},
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

/** Writes one file's staged changes, or throws why it did not. */
async function saveFile($: $, path: string, edits: Edit[]) {
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

  const written = await readText($, target);
  if (written !== plan.text) {
    // `$.fs` cannot delete, so a file this save created is left as `{}`.
    if (existed) {
      await $.fs.write(target, original);
      throw new Error("the file read back differently; restored the old text");
    }
    await $.fs.write(target, "{}\n");
    throw new Error("the new file read back differently; left it as {}");
  }
}

async function saveAll($: $) {
  const snapshot = await read($, snapshotAtom);
  const pending = await read($, pendingAtom);
  if (snapshot === null || pending.length === 0) return;

  const home = (await $.env.get("HOME")) ?? "";
  const saved: Layer[] = [];
  let failure: string | null = null;
  for (const layer of LAYERS) {
    const path = snapshot.files[layer];
    // An edit for another folder's file is left for refresh() to drop.
    const edits = pending.filter((p) => p.layer === layer && p.file === path);
    if (edits.length === 0) continue;
    try {
      await saveFile($, path, edits);
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
      ? `Saved ${saved.map((l) => shortPath(home, snapshot.cwd, snapshot.files[l])).join(", ")}`
      : null;
  const needsReload = pending.some(
    (p) => p.section === "enabledPlugins" && saved.includes(p.layer),
  );
  const hint = needsReload ? "  (/reload-plugins to apply)" : "";
  await update($, reviewingAtom, () => false);
  await update($, closeWarnedAtom, () => false);
  await update($, messageAtom, () =>
    failure
      ? [done, failure].filter(Boolean).join(". ")
      : `${done ?? ""}${hint}`,
  );
  await refresh($);
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
  title: "Toggle",
  focus: true,
  closeOnEscape: true,
  holdToasts: true,
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

    const messageLine = message !== null && (
      <Text color="suggestion" wrap="truncate-end">
        {message}
      </Text>
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
            key="reload"
            hotkey="r"
            label="Reload"
            onPress={async () => {
              await update($, messageAtom, () => null);
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
        <Text wrap="truncate-end">
          <Text color="success">[+]</Text> on <Text color="error">[-]</Text> off{" "}
          <Text dimColor>[ ]</Text> inherit <Text color="warning">*</Text>{" "}
          unsaved
          {tab === "skills" && (
            <Text>
              {"  "}
              <Text color="warning">[n]</Text> name-only{" "}
              <Text color="warning">[u]</Text> user-invocable-only{"  "}
              <Text color={PROJECT_COLOR}>name</Text> .claude/skills
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
    const row = <T extends CellValue>(
      key: string,
      name: string,
      width: number,
      sectionKey: SectionKey,
      file: Record<Layer, T | null>,
      mark: (v: T | null) => Mark,
      fallback: T | null,
      nextValue: (layer: Layer, current: T | null) => T | null,
      isLocked: (layer: Layer) => boolean = () => false,
      nameColor?: string,
    ) => {
      const { values, changed } = staged(sectionKey, name, file);

      return (
        <Box key={key} flexDirection="row" gap={1}>
          {markText(mark(effective(values) ?? fallback), true)}
          {nameCells(name, width, nameColor)}
          {LAYERS.map((layer) => (
            <Box key={`${key}:${layer}:cell`} width={layer.length}>
              {layer in snapshot.broken || isLocked(layer) ? (
                <Text dimColor> - </Text>
              ) : (
                <Button
                  key={`${key}:${layer}`}
                  plain
                  onPress={() =>
                    stage(
                      $,
                      layer,
                      snapshot.files[layer],
                      sectionKey,
                      name,
                      file[layer],
                      nextValue(layer, values[layer]),
                    )
                  }
                >
                  {markText(mark(values[layer]))}
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
          {columns("plugin", width)}
          {snapshot.plugins.map((p) =>
            row(
              `p:${p.id}`,
              p.id,
              width,
              "enabledPlugins",
              p,
              pluginMark,
              null,
              nextPluginValue,
              // Installed for this project alone: a user value would reach no
              // other project, so the user cell is not offered.
              (layer) =>
                layer === "user" &&
                p.installed === "project" &&
                p.user === null,
            ),
          )}
        </Box>
      );
    }

    const width = nameWidth(snapshot.skills.map((s) => s.name));

    return (
      <Box flexDirection="column">
        {header}
        {columns("skill", width)}
        {snapshot.skills.map((s) =>
          row(
            `s:${s.name}`,
            s.name,
            width,
            "skillOverrides",
            s,
            skillMark,
            "on",
            (_, current) => nextSkillValue(current),
            undefined,
            // A skill of this project's .claude/skills, not a user one.
            s.origin === "project" ? PROJECT_COLOR : undefined,
          ),
        )}
      </Box>
    );
  });
};

import { expect, test } from "claude-code/testing";
import type { TestBody } from "claude-code/testing";

import { planFile } from "../src/logic";

const PANE = {
  plugin: "toggle-plugins",
  component: "Pane",
  requestId: "toggle",
  props: {
    title: "Toggle",
    isFocused: true,
    bodyColumns: 100,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

const SNAPSHOT = {
  cwd: "/repo",
  files: {
    user: "/home/.claude/settings.json",
    project: "/repo/.claude/settings.json",
    local: "/repo/.claude/settings.local.json",
  },
  plugins: [
    {
      id: "runpod@pokutuna-plugins",
      installed: "project",
      user: null,
      project: true,
      local: null,
      odd: [],
      above: null,
    },
  ],
  skills: [
    {
      name: "commit",
      origin: "user",
      user: null,
      project: "off",
      local: null,
      odd: [],
      above: null,
    },
  ],
  broken: {},
  warnings: [],
};

test("the skills tab draws a button per layer on terminal and desktop", async ($, on) => {
  on("state.get", (_, e) => {
    if (e.key === "snapshot")
      return {
        value: { value: { shape: "snapshot-5", value: SNAPSHOT }, version: 1 },
      };
    if (e.key === "tab") return { value: { value: "skills", version: 1 } };
    return { value: { value: undefined, version: 0 } };
  });
  on("env.get", () => ({ value: "/home" }));

  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Text", text: /commit/ })).toBeDefined();
    expect(
      await ui.find({ type: "Text", text: /~\/\.claude\/settings\.json/ }),
    ).toBeDefined();
    expect(await ui.find({ key: "s:commit:project" })).toBeDefined();
    await ui.unmount();
  }
});

test("a plugin installed for this project alone offers no user cell", async ($, on) => {
  on("state.get", (_, e) => {
    if (e.key === "snapshot")
      return {
        value: { value: { shape: "snapshot-5", value: SNAPSHOT }, version: 1 },
      };
    if (e.key === "tab") return { value: { value: "plugins", version: 1 } };
    return { value: { value: undefined, version: 0 } };
  });
  on("env.get", () => ({ value: "/home" }));

  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    const id = "p:runpod@pokutuna-plugins";
    expect(await ui.find({ key: `${id}:project` })).toBeDefined();
    expect(await ui.find({ key: `${id}:user` })).toBeUndefined();
    await ui.unmount();
  }
});

const USER_FILE = "/home/.claude/settings.json";
const PROJECT_FILE = "/repo/.claude/settings.json";

type Fake = {
  files: Map<string, string>;
  writes?: { path: string; text: string }[];
  /** Symlinks: a path and the file it leads to. */
  links?: Map<string, string>;
  /** A disk that keeps only part of the next write. */
  corrupt?: { next: boolean };
  root?: { path: string };
  /** The repository's root, when the session is in one. */
  repo?: string;
  /** The slash commands the build has, and the ones a save ran. */
  commands?: { name: string; source: "builtin" | "user" | "plugin" }[];
  ran?: string[];
  /** Makes the engine refuse to name its commands, so no reload can run. */
  runFails?: boolean;
  /** What --settings or managed settings hold. */
  policy?: Record<string, unknown>;
};

const BUILTIN = ["status", "reload-plugins", "reload-skills"].map((name) => ({
  name,
  source: "builtin" as const,
}));

/** Stands in for the engine: a session at /repo over an in-memory disk. */
async function fakeSession(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  {
    files,
    writes = [],
    links = new Map(),
    corrupt = { next: false },
    root = { path: "/repo" },
    repo,
    commands = BUILTIN,
    ran = [],
    runFails = false,
    policy = {},
  }: Fake,
) {
  on("command.list", () =>
    runFails
      ? { deny: "the session is busy" }
      : { value: commands.map((c) => ({ ...c, description: "" })) },
  );
  on("command.run", (_, e) => {
    ran.push(e.command);

    return {};
  });
  on("session.repo", () => ({
    value:
      repo === undefined
        ? null
        : { root: repo, remote: null, internal: false, name: null },
  }));
  on("settings.read", (_, e) => ({
    value: e.source === "policy" ? policy : {},
  }));
  on("command.register", () => ({ value: { command: "toggle-plugins" } }));
  on("session.root", () => ({ value: root.path }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("env.get", (_, e) =>
    e.name === "HOME" ? { value: "/home" } : { value: undefined },
  );
  on("fs.exists", (_, e) => ({ value: files.has(e.path) }));
  on("fs.read", (_, e) => ({ value: files.get(e.path) ?? "" }));
  on("fs.list", () => ({ value: [] }));
  on("fs.stat", (_, e) => ({
    value: {
      kind: "file",
      size: (files.get(e.path) ?? "").length,
      mtimeMs: 0,
      isLink: links.has(e.path),
      realPath: links.get(e.path) ?? e.path,
    },
  }));
  on("fs.write", (_, e) => {
    writes.push({ path: e.path, text: e.text });
    // A disk that keeps only part of the next write.
    files.set(e.path, corrupt.next ? e.text.slice(0, 5) : e.text);
    corrupt.next = false;

    return { value: undefined };
  });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
}

test("a press stages a change; only Save writes, and only that key", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  const ran: string[] = [];
  await fakeSession($, on, { files, writes, ran });

  for (const surface of ["terminal", "desktop"] as const) {
    files.clear();
    writes.length = 0;
    ran.length = 0;
    files.set(
      USER_FILE,
      '{\n  "model": "opus",\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n',
    );
    files.set(PROJECT_FILE, '{\n  "permissions": {\n    "allow": []\n  }\n}\n');

    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: "tab-skills" });
    await ui.press({ key: "refresh" });
    await ui.press({ key: "s:commit:project" });

    expect(writes).toEqual([]);
    expect(await ui.find({ type: "Text", text: /1 unsaved/ })).toBeDefined();

    await ui.press({ key: "save" });
    expect(await ui.find({ type: "Text", text: /Save these changes/ })).toBeDefined();
    expect(writes).toEqual([]);
    expect(ran).toEqual([]);

    await ui.press({ key: "confirm" });
    expect(writes).toEqual([
      {
        path: PROJECT_FILE,
        text: '{\n  "permissions": {\n    "allow": []\n  },\n  "skillOverrides": {\n    "commit": "on"\n  }\n}\n',
      },
    ]);
    expect(await ui.find({ key: "save" })).toBeUndefined();
    expect(ran).toEqual(["reload-plugins", "reload-skills"]);
    expect(await ui.find({ type: "Text", text: /not reloaded/ })).toBeUndefined();
    await ui.unmount();
  }
});

test("a file changed after the press is not written", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  await fakeSession($, on, { files, writes });
  files.set(USER_FILE, "{}\n");

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');
  await ui.press({ key: "refresh" });
  await ui.press({ key: "s:commit:local" });
  // Someone else sets the same key before the save.
  files.set(
    "/repo/.claude/settings.local.json",
    '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n',
  );
  await ui.press({ key: "save" });
  await ui.press({ key: "confirm" });

  expect(writes).toEqual([]);
  expect(await ui.find({ type: "Text", text: /Not saved/ })).toBeDefined();
  await ui.unmount();
});

test("planFile refuses what is not a settings object, and saves any layout", () => {
  const edit = {
    layer: "user",
    file: USER_FILE,
    section: "skillOverrides",
    key: "commit",
    from: null,
    value: "off",
  } as const;

  expect(planFile("[]", [edit])).toEqual({ error: "not a JSON object" });
  // A section that is not an object is not replaced by one.
  expect(
    "error" in planFile('{\n  "skillOverrides": [\n    "x"\n  ]\n}\n', [edit]),
  ).toBe(true);
  expect("error" in planFile("{ broken", [edit])).toBe(true);
  // One-line JSON is saved, and comes back pretty-printed.
  expect(planFile('{"model":"opus"}\n', [edit])).toEqual({
    text: '{\n  "model": "opus",\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n',
    reformatted: true,
  });
  // A missing file becomes the one key.
  expect(planFile("", [edit])).toEqual({
    text: '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n',
    reformatted: false,
  });
  // Tabs and a missing final newline are kept.
  expect(planFile('{\n\t"model": "opus"\n}', [edit])).toEqual({
    text: '{\n\t"model": "opus",\n\t"skillOverrides": {\n\t\t"commit": "off"\n\t}\n}',
    reformatted: false,
  });
});

test("a save keeps the order of hand-written keys and changes spacing alone", () => {
  type Mode = "on" | "off" | null;
  const edit = (key: string, from: Mode, value: Mode) =>
    ({ layer: "user", file: USER_FILE, section: "skillOverrides", key, from, value }) as const;
  const text =
    '{\n  "permissions": { "allow": ["Read"] },\n  "model": "opus",\n' +
    '  "skillOverrides": { "zeta": "off", "commit": "on", "alpha": "off" },\n' +
    '  "env": { "B": "1", "A": "2" }\n}\n';
  const plan = planFile(text, [
    edit("commit", "on", "off"),
    edit("fresh", null, "off"),
    edit("zeta", "off", null),
  ]);
  expect("text" in plan && JSON.stringify(JSON.parse(plan.text))).toBe(
    '{"permissions":{"allow":["Read"]},"model":"opus",' +
      '"skillOverrides":{"commit":"off","alpha":"off","fresh":"off"},' +
      '"env":{"B":"1","A":"2"}}',
  );

  // What printing would change beyond spacing is refused.
  const one = [edit("commit", null, "off")];
  expect("error" in planFile('{"env": {"2": "b", "1": "a"}}', one)).toBe(true);
  expect("error" in planFile('{"model": "a", "model": "b"}', one)).toBe(true);
  expect("error" in planFile('{"n": 1.0}', one)).toBe(true);
  // A quote or a space inside a string is not spacing.
  expect("text" in planFile('{"a": "x \\" y",  "b": 1}', one)).toBe(true);
});

test("a symlinked settings file is written through, not replaced", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  const DOTFILES = "/home/dotfiles/claude/settings.json";
  const links = new Map([[USER_FILE, DOTFILES]]);
  await fakeSession($, on, { files, writes, links });
  files.set(USER_FILE, "{}\n");
  files.set(DOTFILES, "{}\n");

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');
  files.set(DOTFILES, files.get(USER_FILE)!);
  await ui.press({ key: "refresh" });
  await ui.press({ key: "s:commit:user" });
  await ui.press({ key: "save" });
  await ui.press({ key: "confirm" });

  expect(writes.map((w) => w.path)).toEqual([DOTFILES]);
  await ui.unmount();
});

test("a write that reads back wrong is undone", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  const corrupt = { next: false };
  await fakeSession($, on, { files, writes, corrupt });
  const before = '{\n  "permissions": {\n    "allow": []\n  }\n}\n';
  files.set(PROJECT_FILE, before);
  // The user layer names the skill, so it has a row.
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "refresh" });
  await ui.press({ key: "s:commit:project" });
  await ui.press({ key: "save" });
  corrupt.next = true;
  await ui.press({ key: "confirm" });

  expect(files.get(PROJECT_FILE)).toBe(before);
  expect(writes.length).toBe(2);
  expect(await ui.find({ type: "Text", text: /restored the old text/ })).toBeDefined();
  // The review stays open on a failure.
  expect(await ui.find({ key: "confirm" })).toBeDefined();
  await ui.unmount();
});


test("an unreadable file takes out its own layer, not the pane", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  await fakeSession($, on, { files, writes });
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');
  files.set(PROJECT_FILE, "{ broken");

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "refresh" });

  expect(await ui.find({ type: "Text", text: /unreadable/ })).toBeDefined();
  expect(await ui.find({ key: "s:commit:project" })).toBeUndefined();
  await ui.press({ key: "s:commit:local" });
  await ui.press({ key: "save" });
  await ui.press({ key: "confirm" });

  expect(writes.map((w) => w.path)).toEqual(["/repo/.claude/settings.local.json"]);
  await ui.unmount();
});

test("a change staged before the folder moved is not saved to the new one", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  const root = { path: "/repo" };
  await fakeSession($, on, { files, writes, root });
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "refresh" });
  await ui.press({ key: "s:commit:project" });
  // /cd to another project, then the pane refreshes.
  root.path = "/other";
  await ui.press({ key: "refresh" });

  expect(await ui.find({ type: "Text", text: /Dropped 1 change/ })).toBeDefined();
  expect(await ui.find({ key: "save" })).toBeUndefined();
  expect(writes).toEqual([]);
  await ui.unmount();
});

/** Stages `commit` off in the local layer and saves it. */
async function saveOne($: Parameters<TestBody>[0]) {
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "refresh" });
  await ui.press({ key: "s:commit:local" });
  await ui.press({ key: "save" });
  await ui.press({ key: "confirm" });

  return ui;
}

const COMMIT_OFF = '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n';

test("a save runs only the reload commands the build has", async ($, on) => {
  const files = new Map([[USER_FILE, COMMIT_OFF]]);
  const ran: string[] = [];
  await fakeSession($, on, {
    files,
    ran,
    commands: [{ name: "reload-plugins", source: "builtin" }],
  });

  const ui = await saveOne($);
  expect(ran).toEqual(["reload-plugins"]);
  // The value in effect is a word at the left: local "on" over user "off".
  expect(await ui.find({ type: "Text", text: /^on\s+$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^off\s*$/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /not reloaded/ })).toBeUndefined();
  await ui.unmount();
});

test("a reload that fails is said, and the save stands", async ($, on) => {
  const files = new Map([[USER_FILE, COMMIT_OFF]]);
  const writes: { path: string; text: string }[] = [];
  await fakeSession($, on, { files, writes, runFails: true });

  const ui = await saveOne($);
  expect(writes.length).toBe(1);
  expect(
    await ui.find({ type: "Text", text: /Not reloaded: .*the session is busy/ }),
  ).toBeDefined();
  await ui.unmount();
});

test("settings.local.json is the session folder's, in a subfolder too", async ($, on) => {
  const files = new Map([[USER_FILE, COMMIT_OFF]]);
  const writes: { path: string; text: string }[] = [];
  await fakeSession($, on, {
    files,
    writes,
    root: { path: "/repo/apps/web" },
    repo: "/repo",
  });

  const ui = await saveOne($);
  expect(writes.map((w) => w.path)).toEqual([
    "/repo/apps/web/.claude/settings.local.json",
  ]);
  await ui.unmount();
});

test("a worktree edits its own settings.local.json, and the original repository's value shows", async ($, on) => {
  const files = new Map([
    [USER_FILE, COMMIT_OFF],
    [
      "/repo/.claude/settings.local.json",
      '{\n  "skillOverrides": {\n    "commit": "name-only"\n  }\n}\n',
    ],
  ]);
  const writes: { path: string; text: string }[] = [];
  await fakeSession($, on, {
    files,
    writes,
    root: { path: "/elsewhere/wt" },
    repo: "/repo",
  });

  const ui = await saveOne($);
  expect(writes.map((w) => w.path)).toEqual([
    "/elsewhere/wt/.claude/settings.local.json",
  ]);
  expect(
    await ui.find({ type: "Text", text: /repository root's settings\.local\.json/ }),
  ).toBeDefined();
  await ui.unmount();
});

test("command files and what the session loaded elsewhere are listed", async ($, on) => {
  const files = new Map<string, string>();
  await fakeSession($, on, {
    files,
    commands: [
      ...BUILTIN,
      // A parent folder's skill and a command file, as the session names them.
      { name: "deploy", source: "user" },
      { name: "frontend:component", source: "user" },
      // A skill claude.ai synced.
      { name: "anthropic-skills:pdf", source: "user" },
      // A plugin's skill, which skillOverrides does not reach.
      { name: "docgen:html", source: "plugin" },
    ],
  });

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "refresh" });
  expect(await ui.find({ key: "s:deploy:local" })).toBeDefined();
  // Named as the project's, not by a color alone.
  expect(await ui.find({ type: "Text", text: /deploy \(project\)/ })).toBeDefined();
  expect(await ui.find({ key: "s:frontend:component:local" })).toBeDefined();
  expect(await ui.find({ key: "s:anthropic-skills:pdf:local" })).toBeDefined();
  expect(await ui.find({ key: "s:docgen:html:local" })).toBeUndefined();
  expect(await ui.find({ key: "s:status:local" })).toBeUndefined();
  await ui.unmount();
});

test("a value the pane does not know closes its cell", async ($, on) => {
  const files = new Map([
    [USER_FILE, '{\n  "skillOverrides": {\n    "commit": "sometimes"\n  }\n}\n'],
  ]);
  await fakeSession($, on, { files });

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "refresh" });
  expect(await ui.find({ key: "s:commit:user" })).toBeUndefined();
  expect(await ui.find({ key: "s:commit:project" })).toBeDefined();
  await ui.unmount();
});

test("an unreadable installed_plugins.json keeps the rows the settings name", async ($, on) => {
  const files = new Map([
    ["/home/.claude/plugins/installed_plugins.json", "{ broken"],
    [USER_FILE, '{\n  "enabledPlugins": {\n    "difit@pokutuna-plugins": true\n  }\n}\n'],
  ]);
  await fakeSession($, on, { files });

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-plugins" });
  await ui.press({ key: "refresh" });
  expect(
    await ui.find({ type: "Text", text: /installed_plugins\.json unreadable/ }),
  ).toBeDefined();
  expect(await ui.find({ key: "p:difit@pokutuna-plugins:user" })).toBeDefined();
  await ui.unmount();
});

test("a managed value is said above the rows", async ($, on) => {
  const files = new Map([[USER_FILE, COMMIT_OFF]]);
  await fakeSession($, on, {
    files,
    policy: { skillOverrides: { commit: "on" } },
  });

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "refresh" });
  expect(
    await ui.find({ type: "Text", text: /1 row\(s\) are set by --settings/ }),
  ).toBeDefined();
  await ui.unmount();
});

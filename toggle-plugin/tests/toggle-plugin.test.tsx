import { expect, test } from "claude-code/testing";
import type { TestBody } from "claude-code/testing";

import { planFile } from "../src/logic";

const PANE = {
  plugin: "toggle-plugin",
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
    },
  ],
  skills: [
    { name: "commit", origin: "user", user: null, project: "off", local: null },
  ],
  broken: {},
};

test("the skills tab draws a button per layer on terminal and desktop", async ($, on) => {
  on("state.get", (_, e) => {
    if (e.key === "snapshot")
      return {
        value: { value: { shape: "snapshot-4", value: SNAPSHOT }, version: 1 },
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
        value: { value: { shape: "snapshot-4", value: SNAPSHOT }, version: 1 },
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

/** Stands in for the engine: a session at /repo over an in-memory disk. */
async function fakeSession(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  files: Map<string, string>,
  writes: { path: string; text: string }[],
  links: Map<string, string> = new Map(),
  corrupt: { next: boolean } = { next: false },
  root: { path: string } = { path: "/repo" },
) {
  on("command.register", () => ({ value: { command: "toggle" } }));
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
  await fakeSession($, on, files, writes);

  for (const surface of ["terminal", "desktop"] as const) {
    files.clear();
    writes.length = 0;
    files.set(
      USER_FILE,
      '{\n  "model": "opus",\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n',
    );
    files.set(PROJECT_FILE, '{\n  "permissions": {\n    "allow": []\n  }\n}\n');

    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: "tab-skills" });
    await ui.press({ key: "reload" });
    await ui.press({ key: "s:commit:project" });

    expect(writes).toEqual([]);
    expect(await ui.find({ type: "Text", text: /1 unsaved/ })).toBeDefined();

    await ui.press({ key: "save" });
    expect(await ui.find({ type: "Text", text: /Save these changes/ })).toBeDefined();
    expect(writes).toEqual([]);

    await ui.press({ key: "confirm" });
    expect(writes).toEqual([
      {
        path: PROJECT_FILE,
        text: '{\n  "permissions": {\n    "allow": []\n  },\n  "skillOverrides": {\n    "commit": "on"\n  }\n}\n',
      },
    ]);
    expect(await ui.find({ key: "save" })).toBeUndefined();
    await ui.unmount();
  }
});

test("a file changed after the press is not written", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  await fakeSession($, on, files, writes);
  files.set(USER_FILE, "{}\n");

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');
  await ui.press({ key: "reload" });
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

test("planFile refuses what it cannot write back exactly", () => {
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
  // One-line JSON would come back pretty-printed.
  expect("error" in planFile('{"model":"opus"}\n', [edit])).toBe(true);
  // A missing file becomes the one key.
  expect(planFile("", [edit])).toEqual({
    text: '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n',
  });
  // Tabs and a missing final newline are kept.
  expect(planFile('{\n\t"model": "opus"\n}', [edit])).toEqual({
    text: '{\n\t"model": "opus",\n\t"skillOverrides": {\n\t\t"commit": "off"\n\t}\n}',
  });
});

test("a symlinked settings file is written through, not replaced", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  const DOTFILES = "/home/dotfiles/claude/settings.json";
  const links = new Map([[USER_FILE, DOTFILES]]);
  await fakeSession($, on, files, writes, links);
  files.set(USER_FILE, "{}\n");
  files.set(DOTFILES, "{}\n");

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');
  files.set(DOTFILES, files.get(USER_FILE)!);
  await ui.press({ key: "reload" });
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
  await fakeSession($, on, files, writes, new Map(), corrupt);
  const before = '{\n  "permissions": {\n    "allow": []\n  }\n}\n';
  files.set(PROJECT_FILE, before);
  // The user layer names the skill, so it has a row.
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "reload" });
  await ui.press({ key: "s:commit:project" });
  await ui.press({ key: "save" });
  corrupt.next = true;
  await ui.press({ key: "confirm" });

  expect(files.get(PROJECT_FILE)).toBe(before);
  expect(writes.length).toBe(2);
  expect(await ui.find({ type: "Text", text: /restored the old text/ })).toBeDefined();
  await ui.unmount();
});


test("an unreadable file takes out its own layer, not the pane", async ($, on) => {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  await fakeSession($, on, files, writes);
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');
  files.set(PROJECT_FILE, "{ broken");

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "reload" });

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
  await fakeSession($, on, files, writes, new Map(), { next: false }, root);
  files.set(USER_FILE, '{\n  "skillOverrides": {\n    "commit": "off"\n  }\n}\n');

  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-skills" });
  await ui.press({ key: "reload" });
  await ui.press({ key: "s:commit:project" });
  // /cd to another project, then the pane reloads.
  root.path = "/other";
  await ui.press({ key: "reload" });

  expect(await ui.find({ type: "Text", text: /Dropped 1 change/ })).toBeDefined();
  expect(await ui.find({ key: "save" })).toBeUndefined();
  expect(writes).toEqual([]);
  await ui.unmount();
});

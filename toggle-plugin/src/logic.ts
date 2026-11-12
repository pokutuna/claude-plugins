// Pure logic of toggle-plugin: no `$`, so the tests call it directly.

import type { CellValue, Edit, Layer, SkillMode } from "../types";

export type Json = Record<string, unknown>;

/** The settings layers, lowest precedence first. */
export const LAYERS: Layer[] = ["user", "project", "local"];

export const SKILL_MODES: SkillMode[] = [
  "on",
  "name-only",
  "user-invocable-only",
  "off",
];

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function section(settings: Json, key: string): Json {
  const value = settings[key];

  return isObject(value) ? value : {};
}

export const editId = (e: Pick<Edit, "layer" | "section" | "key">) =>
  `${e.layer}|${e.section}|${e.key}`;

/** How a value reads in messages and the review. */
export function shown(value: CellValue): string {
  if (value === null) return "unset";
  if (value === true) return "on";
  if (value === false) return "off";

  return value;
}

// ---- saving --------------------------------------------------------------
//
// Each file is saved on its own, and refused rather than risked. planFile
// checks 1-5 on the text read just before the write; saveFile in
// register.tsx does 6 after it.
//   1. the file must parse as a JSON object (a missing or empty file is {})
//   2. each staged section, when present, must be an object
//   3. every staged key must still hold the value it held when pressed
//   4. the file must print back to its own text, so the write changes no
//      formatting, only the staged keys
//   5. the new object must differ from the old in the staged keys alone
//   6. the written text is read back; on a mismatch the old text is restored

/** What a file becomes after its staged changes, or why it may not. */
export function planFile(
  text: string,
  edits: Edit[],
): { text: string } | { error: string } {
  let before: Json = {};
  if (text.trim()) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      return { error: `not valid JSON (${String(error)})` };
    }
    if (!isObject(value)) return { error: "not a JSON object" };
    before = value;
  }

  for (const e of edits) {
    const held = before[e.section];
    if (held !== undefined && !isObject(held))
      return { error: `${e.section} is not an object; edit it by hand` };
  }

  for (const e of edits) {
    const raw = section(before, e.section)[e.key];
    const now = raw === undefined ? null : raw;
    if (now !== e.from)
      return {
        error: `${e.section}.${e.key} is now ${JSON.stringify(now)}, not ${shown(e.from)}; reload`,
      };
  }

  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  const eol = text === "" || text.endsWith("\n") ? "\n" : "";
  const print = (value: Json) => `${JSON.stringify(value, null, indent)}${eol}`;
  if (text.trim() && print(before) !== text)
    return {
      error: "saving would reformat the file (its layout is not plain JSON.stringify); edit it by hand",
    };

  // A fresh copy, so `before` stays as read for the comparison below.
  const after: Json = text.trim() ? JSON.parse(text) : {};
  for (const e of edits) {
    const next = { ...section(after, e.section) };
    if (e.value === null) delete next[e.key];
    else next[e.key] = e.value;
    if (Object.keys(next).length > 0) after[e.section] = next;
    else delete after[e.section];
  }

  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const touched = new Set(edits.map((e) => e.section as string));
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!touched.has(k)) {
      if (!same(before[k], after[k])) return { error: `would change ${k}` };
      continue;
    }
    const a = section(before, k);
    const b = section(after, k);
    for (const sub of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const edit = edits.find((e) => e.section === k && e.key === sub);
      const want = edit ? (edit.value === null ? undefined : edit.value) : a[sub];
      if (!same(b[sub], want)) return { error: `would change ${k}.${sub}` };
    }
  }

  return { text: print(after) };
}

/** A path as shown: inside this project relative to it, else from `~`. */
export function shortPath(home: string, cwd: string, path: string): string {
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);

  return home && path.startsWith(`${home}/`)
    ? `~${path.slice(home.length)}`
    : path;
}

export function nextPluginValue(
  layer: Layer,
  current: boolean | null,
): boolean | null {
  // user: on ↔ off (installing writes a value there, so unset is never the aim)
  if (layer === "user") return current !== true;
  // project / local: unset → on → off → unset
  if (current === null) return true;
  if (current) return false;

  return null;
}

export function nextSkillValue(current: SkillMode | null): SkillMode | null {
  // unset → on → name-only → user-invocable-only → off → unset
  if (current === null) return "on";
  const i = SKILL_MODES.indexOf(current);

  return SKILL_MODES[i + 1] ?? null;
}

/** The value that wins: local over project over user (null: none is set). */
export function effective<T>(row: Record<Layer, T | null>): T | null {
  return row.local ?? row.project ?? row.user;
}

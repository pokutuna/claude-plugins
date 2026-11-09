/**
 * pi extension loaded by gemini-rewrite.sh. It limits what Gemini's tools can reach:
 *
 * - read, ls, find, grep: only paths under GEMINI_REWRITE_READ_SCOPE (the repository root)
 * - edit, write: only paths under GEMINI_REWRITE_WRITE_SCOPE (the target), never in .git
 * - bash: runs inside srt (sandbox-runtime). The sandbox can read the read scope but not
 *   the rest of the home directory, write only the write scope, and use no network.
 * - any other tool is blocked
 * - after MAX_TOOL_CALLS calls, every further call is blocked, so a model that repeats a
 *   blocked call cannot loop forever (pi has no turn limit)
 *
 * Paths are resolved through symlinks, so a link or "../" cannot reach outside a scope.
 *
 * It also prints "session: <ID>" to stderr when the session starts. pi's print mode does not
 * show the ID, and the caller needs it to resume the session with --session. stdout is left
 * for Gemini's reply.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const READ_TOOLS = new Set(["read", "ls", "find", "grep"]);
const WRITE_TOOLS = new Set(["edit", "write"]);
const MAX_TOOL_CALLS = 100;

// Resolve symlinks through the nearest existing ancestor, so paths that do not exist yet
// (a file the model is about to write) are checked against where they would really land.
function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(realPath(parent), basename(p));
  }
}

function isInside(scope: string, target: string): boolean {
  const rel = relative(scope, target);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Write the srt settings to a private temporary file that is removed when pi exits.
function writeSrtSettings(readScope: string, writeScope: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gemini-rewrite-"));
  const file = join(dir, "srt-settings.json");
  const settings = {
    filesystem: {
      denyRead: ["~"],
      allowRead: [readScope],
      allowWrite: [writeScope],
      denyWrite: [join(writeScope, ".git")],
    },
    network: { allowedDomains: [], deniedDomains: [] },
  };
  writeFileSync(file, JSON.stringify(settings), { mode: 0o600 });
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return file;
}

export default function (pi: ExtensionAPI) {
  const readScopeEnv = requireEnv("GEMINI_REWRITE_READ_SCOPE");
  const writeScopeEnv = requireEnv("GEMINI_REWRITE_WRITE_SCOPE");
  const srt = requireEnv("GEMINI_REWRITE_SRT");
  const readScope = realPath(resolve(readScopeEnv));
  const writeScope = realPath(resolve(writeScopeEnv));
  const srtSettings = writeSrtSettings(readScope, writeScope);
  // Git inside the sandbox cannot read the user's global config; skip it instead of failing.
  const gitEnv = [
    "GIT_CONFIG_GLOBAL=/dev/null",
    "GIT_CONFIG_NOSYSTEM=1",
    "GIT_CONFIG_COUNT=1",
    "GIT_CONFIG_KEY_0=core.excludesFile",
    "GIT_CONFIG_VALUE_0=/dev/null",
  ].join(" ");
  let toolCalls = 0;

  pi.on("session_start", async (_event, ctx) => {
    process.stderr.write(`session: ${ctx.sessionManager.getSessionId()}\n`);
  });

  pi.on("tool_call", async (event, ctx) => {
    toolCalls += 1;
    if (toolCalls > MAX_TOOL_CALLS) {
      return {
        block: true,
        reason: `The tool call limit (${MAX_TOOL_CALLS}) is reached. Stop and summarize your changes.`,
      };
    }

    if (event.toolName === "bash") {
      const command = event.input.command as string;
      event.input.command = `${gitEnv} ${shellQuote(srt)} -s ${shellQuote(srtSettings)} -c ${shellQuote(command)}`;
      return undefined;
    }

    const isWrite = WRITE_TOOLS.has(event.toolName);
    if (!isWrite && !READ_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `The ${event.toolName} tool is not available.`,
      };
    }

    // Match pi's own path handling: an optional "@" prefix, "~" for home, relative to cwd.
    let input = (event.input.path as string | undefined) ?? ".";
    input = input.replace(/^@/, "");
    if (input === "~" || input.startsWith("~/")) {
      input = homedir() + input.slice(1);
    }
    const target = realPath(resolve(ctx.cwd ?? process.cwd(), input));

    if (isWrite) {
      if (!isInside(writeScope, target)) {
        return {
          block: true,
          reason: `${input} is outside ${writeScopeEnv}. Edit only the target.`,
        };
      }
      if (target.split(sep).includes(".git")) {
        return { block: true, reason: `${input} is inside a .git directory.` };
      }
    } else if (!isInside(readScope, target)) {
      return {
        block: true,
        reason: `${input} is outside ${readScopeEnv}. Read only paths under it.`,
      };
    }
    return undefined;
  });
}

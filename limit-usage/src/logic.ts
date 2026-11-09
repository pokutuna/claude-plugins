// Pure logic of limit-usage: argument parsing, threshold resolution and the
// over-limit verdict. No `$` here, so tests can call it directly.
import type { Limits } from "../types";

export type Window = "5h" | "7d";

/** One rate-limit window reading, as `$.session.usage().rateLimits` has it. */
export type Reading = { kind: string; percentUsed: number; resetsAt?: string };

/** The engine's window names, mapped to ours. Other kinds are ignored. */
export const WINDOW_OF: Record<string, Window | undefined> = {
  five_hour: "5h",
  seven_day: "7d",
};

export type Command =
  | { kind: "status" }
  | { kind: "clear" }
  | { kind: "set"; isGlobal: boolean; values: Limits }
  | { kind: "error"; message: string };

const NUM = /^\d+(?:\.\d+)?$/;

/**
 * Parses the command's argument text. Friendly about decoration:
 * `5h=80`, `5h 80%`, `set 7d=90`, `cost=$5`, `$5`, `--global`.
 */
export function parseArgs(args: string): Command {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "");
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "status")) {
    return { kind: "status" };
  }
  if (tokens.length === 1 && /^(clear|off|reset)$/i.test(tokens[0] ?? "")) {
    return { kind: "clear" };
  }

  const values: Limits = {};
  let isGlobal = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = (tokens[i] ?? "").toLowerCase();
    if (token === "set") continue;
    if (token === "--global" || token === "-g") {
      isGlobal = true;
      continue;
    }

    // `5h=80`, `cost=$5`, `cost:5$`; or `5h` followed by `80`
    let match = /^(5h|7d|cost|usd)[=:]?(.*)$/.exec(token);
    let windowWord = match?.[1];
    let raw = match?.[2] ?? "";
    if (match && raw === "" && i + 1 < tokens.length) {
      raw = tokens[++i] ?? "";
    }
    if (!match) {
      // A bare `$5` (or `5$`) is unambiguous: cost.
      match = /^\$(.+)$|^(.+)\$$/.exec(token);
      if (match) {
        windowWord = "cost";
        raw = token;
      }
    }
    if (!windowWord) {
      if (NUM.test(token.replace(/%$/, ""))) {
        return {
          kind: "error",
          message: `Which window is "${token}" for? Use 5h=N, 7d=N or cost=N.`,
        };
      }
      return { kind: "error", message: `Unknown argument: ${token}` };
    }

    const value = raw.replace(/^[=:]/, "").replace(/[$%]/g, "");
    if (!NUM.test(value)) {
      return {
        kind: "error",
        message: `Not a number for ${windowWord}: ${raw}`,
      };
    }
    const n = Number(value);
    if (windowWord === "cost" || windowWord === "usd") {
      if (n <= 0) return { kind: "error", message: "cost must be above 0." };
      values.cost = n;
    } else {
      if (n <= 0 || n > 100) {
        return { kind: "error", message: `${windowWord} must be in (0, 100].` };
      }
      values[windowWord as Window] = n;
    }
  }

  if (Object.keys(values).length === 0) {
    return { kind: "error", message: "Nothing to set." };
  }

  return { kind: "set", isGlobal, values };
}

/** Session thresholds override global ones per window; cost is session-only. */
export function effectiveLimits(session: Limits, global: Limits): Limits {
  const out: Limits = {};
  const five = session["5h"] ?? global["5h"];
  const seven = session["7d"] ?? global["7d"];
  if (five !== undefined) out["5h"] = five;
  if (seven !== undefined) out["7d"] = seven;
  if (session.cost !== undefined) out.cost = session.cost;

  return out;
}

/** Whether the window a reading belongs to is still running at `nowMs`. */
export function isLive(reading: Reading, nowMs: number): boolean {
  if (reading.resetsAt === undefined) return true;
  const resets = Date.parse(reading.resetsAt);

  return Number.isNaN(resets) || resets > nowMs;
}

/**
 * Per window, the highest reading whose window has not reset. Within one
 * window usage only grows, so the highest live reading is the newest.
 */
export function pickRates(
  readings: readonly Reading[],
  nowMs: number,
): Partial<Record<Window, Reading>> {
  const out: Partial<Record<Window, Reading>> = {};
  for (const reading of readings) {
    const window = WINDOW_OF[reading.kind];
    if (!window || !Number.isFinite(reading.percentUsed)) continue;
    if (!isLive(reading, nowMs)) continue;
    const held = out[window];
    if (!held || reading.percentUsed > held.percentUsed) out[window] = reading;
  }

  return out;
}

/** Merges readings into one list: one per window, the highest live one. */
export function mergeReadings(
  readings: readonly Reading[],
  nowMs: number,
): Reading[] {
  return Object.values(pickRates(readings, nowMs)).filter(
    (r): r is Reading => r !== undefined,
  );
}

/** What is over its limit: a rate window or the session cost. */
export type Breach =
  | { kind: "rate"; window: Window; percentUsed: number; limit: number; resetsAt?: string }
  | { kind: "cost"; usd: number; limit: number };

const pad = (n: number) => String(n).padStart(2, "0");

function formatReset(resetsAt: string | undefined): string {
  if (resetsAt === undefined) return "";
  const ms = Date.parse(resetsAt);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);

  return ` Resets at ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}.`;
}

/** `HH:MM` when the reset falls on today's date, `MM-DD HH:MM` otherwise. */
function shortReset(resetsAt: string | undefined, nowMs: number): string {
  if (resetsAt === undefined) return "";
  const ms = Date.parse(resetsAt);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const now = new Date(nowMs);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay ? time : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/**
 * What to stop for, or undefined to let the request through. Checked in
 * order 5h, 7d, cost; the first one over its limit wins.
 */
export function breach(
  limits: Limits,
  rates: Partial<Record<Window, Reading>>,
  costUsd: number | undefined,
): Breach | undefined {
  for (const window of ["5h", "7d"] as const) {
    const limit = limits[window];
    const rate = rates[window];
    if (limit === undefined || rate === undefined) continue;
    if (rate.percentUsed >= limit) {
      return {
        kind: "rate",
        window,
        percentUsed: rate.percentUsed,
        limit,
        ...(rate.resetsAt === undefined ? {} : { resetsAt: rate.resetsAt }),
      };
    }
  }
  if (
    limits.cost !== undefined &&
    costUsd !== undefined &&
    costUsd >= limits.cost
  ) {
    return { kind: "cost", usd: costUsd, limit: limits.cost };
  }

  return undefined;
}

/** The full reason, for the transcript log and `status`. */
export function describeBreach(b: Breach): string {
  return b.kind === "rate"
    ? `${b.window} usage ${b.percentUsed.toFixed(1)}% >= limit ${b.limit}%. Stopped by limit-usage.${formatReset(b.resetsAt)}`
    : `Session cost ~$${b.usd.toFixed(2)} >= limit $${b.limit.toFixed(2)}. Stopped by limit-usage.`;
}

/** One short line for the plugin's status line while it blocks. */
export function statusText(b: Breach, command: string, nowMs: number): string {
  const what =
    b.kind === "rate"
      ? `${b.window} ${b.percentUsed.toFixed(1)}% >= ${b.limit}%`
      : `cost ~$${b.usd.toFixed(2)} >= $${b.limit.toFixed(2)}`;
  const reset = b.kind === "rate" ? shortReset(b.resetsAt, nowMs) : "";

  return `Blocked: ${what}${reset ? ` · resets ${reset}` : ""} · /${command} clear`;
}

/** The reason to stop, or undefined to let the request through. */
export function verdict(
  limits: Limits,
  rates: Partial<Record<Window, Reading>>,
  costUsd: number | undefined,
): string | undefined {
  const b = breach(limits, rates, costUsd);

  return b === undefined ? undefined : describeBreach(b);
}

export function describeLimit(
  session: number | undefined,
  global: number | undefined,
  unit: "%" | "$",
): string {
  const fmt = (n: number) => (unit === "$" ? `$${n}` : `${n}%`);
  if (session !== undefined && global !== undefined) {
    return `${fmt(session)} (session; overrides global ${fmt(global)})`;
  }
  if (session !== undefined) return `${fmt(session)} (session)`;
  if (global !== undefined) return `${fmt(global)} (global)`;

  return "not set";
}

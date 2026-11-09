import type { EngineInterface, Register } from "claude-code";

import type { Limits } from "../types";
import {
  type Breach,
  type Reading,
  breach,
  describeBreach,
  describeLimit,
  effectiveLimits,
  mergeReadings,
  parseArgs,
  pickRates,
  statusText,
  verdict,
} from "./logic";

type Dollar = EngineInterface;

const COMMAND = "limit-usage";
const LIMITS = { plugin: "limit-usage", key: "limits" } as const;
/** `$.store` keys: thresholds set with --global, and the latest rate readings. */
const GLOBAL_LIMITS = "global-limits";
const SHARED_RATES = "shared-rates";
const SNAPSHOT_SCHEMA = 1;

type SharedRates = { readings: Reading[]; at: number };

function asLimits(value: unknown): Limits {
  if (typeof value !== "object" || value === null) return {};
  const out: Limits = {};
  for (const key of ["5h", "7d", "cost"] as const) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isFinite(n)) out[key] = n;
  }

  return out;
}

function asReadings(value: unknown): Reading[] {
  const list = (value as SharedRates | undefined)?.readings;
  if (!Array.isArray(list)) return [];

  return list.filter(
    (r): r is Reading =>
      typeof r === "object" &&
      r !== null &&
      typeof r.kind === "string" &&
      typeof r.percentUsed === "number",
  );
}

async function sessionLimits($: Dollar): Promise<Limits> {
  const { value } = await $.state.get(LIMITS);

  return asLimits(value);
}

async function globalLimits($: Dollar): Promise<Limits> {
  return asLimits(await $.store.get(GLOBAL_LIMITS));
}

/** This session's readings and the ones other sessions shared, merged. */
async function currentRates($: Dollar, own: readonly Reading[], nowMs: number) {
  const shared = asReadings(
    await $.store.get(SHARED_RATES).catch(() => undefined),
  );

  return pickRates([...own, ...shared], nowMs);
}

type Found = { breach: Breach; nowMs: number };

async function overLimit($: Dollar): Promise<Found | undefined> {
  const [session, global] = await Promise.all([
    sessionLimits($),
    globalLimits($),
  ]);
  const limits = effectiveLimits(session, global);
  if (Object.keys(limits).length === 0) return undefined;

  const [usage, nowMs] = await Promise.all([$.session.usage(), $.clock.now()]);
  const rates = await currentRates($, usage.rateLimits, nowMs);

  const found = breach(limits, rates, usage.cost?.usd);

  return found === undefined ? undefined : { breach: found, nowMs };
}

/** Pins the block on the plugin's status line while it holds; clears it otherwise. */
function showStatus($: Dollar, found: Found | undefined): void {
  $.ui.status(
    found === undefined
      ? undefined
      : statusText(found.breach, COMMAND, found.nowMs),
  );
}

async function refreshStatus($: Dollar): Promise<void> {
  showStatus($, await overLimit($));
}

async function snapshotPath($: Dollar): Promise<string | undefined> {
  const xdg = await $.env.get("XDG_STATE_HOME");
  if (xdg) return `${xdg}/cc-limit-usage.json`;
  const home = await $.env.get("HOME");

  return home ? `${home}/.local/state/cc-limit-usage.json` : undefined;
}

/** Shares this session's rate readings with other sessions and with display tools. */
async function publishRates($: Dollar, own: readonly Reading[]): Promise<void> {
  const nowMs = await $.clock.now();
  const shared = asReadings(
    await $.store.get(SHARED_RATES).catch(() => undefined),
  );
  const readings = mergeReadings([...own, ...shared], nowMs);
  await $.store.set(SHARED_RATES, {
    readings,
    at: nowMs,
  } satisfies SharedRates);

  const path = await snapshotPath($);
  if (path === undefined) return;
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    epoch: Math.floor(nowMs / 1000),
    rateLimits: readings,
  };
  await $.fs.write(path, `${JSON.stringify(snapshot)}\n`);
}

async function status($: Dollar): Promise<string> {
  const [session, global, usage, nowMs] = await Promise.all([
    sessionLimits($),
    globalLimits($),
    $.session.usage(),
    $.clock.now(),
  ]);
  const rates = await currentRates($, usage.rateLimits, nowMs);
  const pct = (w: "5h" | "7d") =>
    rates[w] === undefined ? "?" : `${rates[w].percentUsed.toFixed(1)}%`;
  const lines = [
    "limit-usage status",
    "",
    "Thresholds:",
    `  5h limit:   ${describeLimit(session["5h"], global["5h"], "%")}`,
    `  7d limit:   ${describeLimit(session["7d"], global["7d"], "%")}`,
    `  cost limit: ${describeLimit(session.cost, undefined, "$")}`,
    "",
    "Current usage:",
    `  5h used:   ${pct("5h")}`,
    `  7d used:   ${pct("7d")}`,
    `  cost:      ${usage.cost ? `~$${usage.cost.usd.toFixed(2)} (approx, this session)` : "?"}`,
  ];
  if (rates["5h"] === undefined && rates["7d"] === undefined) {
    lines.push(
      "",
      "No 5h/7d usage reported yet. On a plan without a usage quota, set a cost limit instead.",
    );
  }
  const reason = verdict(
    effectiveLimits(session, global),
    rates,
    usage.cost?.usd,
  );
  lines.push("", reason ? `Blocking: ${reason}` : "Not blocking.");

  return lines.join("\n");
}

async function setLimits(
  $: Dollar,
  values: Limits,
  isGlobal: boolean,
): Promise<string> {
  const { cost, ...rates } = values;
  const done: string[] = [];
  if (isGlobal && Object.keys(rates).length > 0) {
    const global = await globalLimits($);
    await $.store.set(GLOBAL_LIMITS, { ...global, ...rates });
    done.push(...Object.entries(rates).map(([w, n]) => `${w}=${n}% (global)`));
  }
  const forSession: Limits = isGlobal ? {} : { ...rates };
  if (cost !== undefined) forSession.cost = cost;
  if (Object.keys(forSession).length > 0) {
    const session = await sessionLimits($);
    await $.state.set(LIMITS, { ...session, ...forSession });
    done.push(
      ...Object.entries(forSession).map(([w, n]) =>
        w === "cost" ? `cost=$${n} (session)` : `${w}=${n}% (session)`,
      ),
    );
  }
  const note =
    isGlobal && cost !== undefined
      ? " cost is session-only, so it was set for this session."
      : "";

  return `Set ${done.join(", ")}.${note}`;
}

async function clearLimits($: Dollar): Promise<string> {
  const [session, global] = await Promise.all([
    sessionLimits($),
    globalLimits($),
  ]);
  const cleared = [
    ...Object.entries(session).map(([w, n]) => `${w}=${n} (session)`),
    ...Object.entries(global).map(([w, n]) => `${w}=${n} (global)`),
  ];
  await $.state.set(LIMITS, {});
  await $.store.delete(GLOBAL_LIMITS);

  return cleared.length === 0
    ? "No thresholds were set; nothing to clear."
    : `Cleared ${cleared.length} threshold(s): ${cleared.join(", ")}`;
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        "Stop model requests at a 5h/7d usage-% or session cost threshold",
      argumentHint: "5h=80 7d=90 | cost=$5 | --global | clear | status",
      immediate: true,
    });
    // After a reload or resume, put the line back if it still blocks.
    await refreshStatus($).catch(() => undefined);

    return next(e);
  });

  on("command.run", { command: COMMAND }, async ($, e) => {
    const command = parseArgs(e.args);
    const text = await (async () => {
      switch (command.kind) {
        case "status":
          return status($);
        case "clear":
          return clearLimits($);
        case "set":
          return setLimits($, command.values, command.isGlobal);
        case "error":
          return command.message;
      }
    })();
    // A threshold just changed: the line follows at once, not at the next step.
    await refreshStatus($).catch(() => undefined);

    return { text };
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { text: "limit-usage: the command failed; see the debug log." },
  );

  // Rate readings arrive with responses; share them as they move.
  on("session.measure", async ($, e, next) => {
    if (e.changed.includes("rateLimits") && e.rateLimits.length > 0) {
      await publishRates($, e.rateLimits).catch((err: unknown) =>
        $.ui.log(`limit-usage: could not publish rates: ${String(err)}`, {
          to: "debug",
        }),
      );
    }

    return next(e);
  });

  // The guard: answer the step without `next` so no request is sent.
  // Fails open: any error in the check lets the request through.
  on("turn.step", async function* ($, e, next) {
    const found = await overLimit($).catch(() => undefined);
    showStatus($, found);
    if (found === undefined) return yield* next(e);

    $.ui.log(describeBreach(found.breach));

    return {
      turnId: e.turnId,
      index: e.index,
      answer: "",
      toolUses: [],
      stopReason: null,
      usage: null,
    };
  });
};

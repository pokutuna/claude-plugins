import type { EngineInterface, Register } from "claude-code";

import type { Limits } from "../types";
import {
  type Breach,
  breach,
  describeBreach,
  describeLimit,
  effectiveLimits,
  parseArgs,
  pickRates,
  statusText,
  verdict,
} from "./logic";

type Dollar = EngineInterface;

const COMMAND = "limit-usage";
const LIMITS = { plugin: "limit-usage", key: "limits" } as const;
/** `$.store` key: thresholds set with --global. */
const GLOBAL_LIMITS = "global-limits";
/** `$.store` key 0.5.0 shared rate readings under; removed on session start. */
const LEGACY_SHARED_RATES = "shared-rates";

function asLimits(value: unknown): Limits {
  if (typeof value !== "object" || value === null) return {};
  const out: Limits = {};
  for (const key of ["5h", "7d", "cost"] as const) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isFinite(n)) out[key] = n;
  }

  return out;
}

async function sessionLimits($: Dollar): Promise<Limits> {
  const { value } = await $.state.get(LIMITS);

  return asLimits(value);
}

async function globalLimits($: Dollar): Promise<Limits> {
  return asLimits(await $.store.get(GLOBAL_LIMITS));
}

/** A block: what is over, when, and the command that lifts it. */
type Found = { breach: Breach; nowMs: number; lift: string };

async function overLimit($: Dollar): Promise<Found | undefined> {
  const [session, global] = await Promise.all([
    sessionLimits($),
    globalLimits($),
  ]);
  const limits = effectiveLimits(session, global);
  if (Object.keys(limits).length === 0) return undefined;

  const [usage, nowMs] = await Promise.all([$.session.usage(), $.clock.now()]);
  const rates = pickRates(usage.rateLimits, nowMs);

  const found = breach(limits, rates, usage.cost?.usd);
  if (found === undefined) return undefined;
  // A rate block set only globally is lifted by `clear --global`.
  const isGlobal =
    found.kind === "rate" && session[found.window] === undefined;

  return {
    breach: found,
    nowMs,
    lift: `/${COMMAND} clear${isGlobal ? " --global" : ""}`,
  };
}

/** Pins the block on the plugin's status line while it holds; clears it otherwise. */
function showStatus($: Dollar, found: Found | undefined): void {
  $.ui.status(
    found === undefined
      ? undefined
      : statusText(found.breach, found.lift, found.nowMs),
  );
}

async function refreshStatus($: Dollar): Promise<void> {
  showStatus($, await overLimit($));
}

async function status($: Dollar): Promise<string> {
  const [session, global, usage, nowMs] = await Promise.all([
    sessionLimits($),
    globalLimits($),
    $.session.usage(),
    $.clock.now(),
  ]);
  const rates = pickRates(usage.rateLimits, nowMs);
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

/** Clears this session's thresholds; with `--global`, the global ones too. */
async function clearLimits($: Dollar, isGlobal: boolean): Promise<string> {
  const [session, global] = await Promise.all([
    sessionLimits($),
    globalLimits($),
  ]);
  const describe = (limits: Limits, scope: string) =>
    Object.entries(limits).map(([w, n]) => `${w}=${n} (${scope})`);
  const cleared = [
    ...describe(session, "session"),
    ...(isGlobal ? describe(global, "global") : []),
  ];
  await $.state.set(LIMITS, {});
  if (isGlobal) await $.store.delete(GLOBAL_LIMITS);

  const kept = isGlobal ? [] : describe(global, "global");
  const done =
    cleared.length === 0
      ? "No thresholds were set here; nothing to clear."
      : `Cleared ${cleared.length} threshold(s): ${cleared.join(", ")}`;

  return kept.length === 0
    ? done
    : `${done}\nStill in effect for every session: ${kept.join(", ")}. Remove them with /${COMMAND} clear --global.`;
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        "Stop model requests at a 5h/7d usage-% or session cost threshold",
      argumentHint: "5h=80 7d=90 | cost=$5 | --global | clear [--global] | status",
      immediate: true,
    });
    await $.store.delete(LEGACY_SHARED_RATES).catch(() => undefined);
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
          return clearLimits($, command.isGlobal);
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

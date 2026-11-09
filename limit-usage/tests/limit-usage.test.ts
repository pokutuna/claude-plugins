import { describe, expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On, SessionUsage } from "claude-code";

import {
  breach,
  effectiveLimits,
  parseArgs,
  pickRates,
  statusText,
  verdict,
} from "../src/logic";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const FUTURE = "2026-11-10T15:00:00Z";
const PAST = "2026-11-10T11:00:00Z";

describe("parseArgs", () => {
  test("accepts the forms people type", async () => {
    expect(parseArgs("5h=80 7d=90")).toEqual({
      kind: "set",
      isGlobal: false,
      values: { "5h": 80, "7d": 90 },
    });
    expect(parseArgs("set 5h 80%")).toEqual({
      kind: "set",
      isGlobal: false,
      values: { "5h": 80 },
    });
    expect(parseArgs("cost=$5")).toEqual({
      kind: "set",
      isGlobal: false,
      values: { cost: 5 },
    });
    expect(parseArgs("$1.5")).toEqual({
      kind: "set",
      isGlobal: false,
      values: { cost: 1.5 },
    });
    expect(parseArgs("5h=80 --global")).toEqual({
      kind: "set",
      isGlobal: true,
      values: { "5h": 80 },
    });
    expect(parseArgs("")).toEqual({ kind: "status" });
    expect(parseArgs("status")).toEqual({ kind: "status" });
    expect(parseArgs("clear")).toEqual({ kind: "clear" });
  });

  test("refuses what it cannot place", async () => {
    expect(parseArgs("90").kind).toBe("error");
    expect(parseArgs("5h=120").kind).toBe("error");
    expect(parseArgs("5h=abc").kind).toBe("error");
    expect(parseArgs("cost=0").kind).toBe("error");
  });
});

describe("statusText", () => {
  test("a short line naming the window, the reset and the way out", async () => {
    const soon = new Date(NOW + 60 * 1000).toISOString();
    const later = new Date(NOW + 3 * 86400 * 1000).toISOString();
    const five = breach({ "5h": 80 }, { "5h": { kind: "five_hour", percentUsed: 85, resetsAt: soon } }, undefined);
    const seven = breach({ "7d": 90 }, { "7d": { kind: "seven_day", percentUsed: 91, resetsAt: later } }, undefined);
    const cost = breach({ cost: 5 }, {}, 6.2);
    expect(five && statusText(five, "lu", NOW)).toMatch(
      /^Blocked: 5h 85\.0% >= 80% · resets (\d\d-\d\d )?\d\d:\d\d · \/lu clear$/,
    );
    expect(seven && statusText(seven, "lu", NOW)).toMatch(/resets \d\d-\d\d \d\d:\d\d/);
    expect(cost && statusText(cost, "lu", NOW)).toBe("Blocked: cost ~$6.20 >= $5.00 · /lu clear");
  });
});

describe("verdict", () => {
  test("session overrides global per window; cost is session-only", async () => {
    expect(
      effectiveLimits({ "5h": 95 }, { "5h": 90, "7d": 80, cost: 3 }),
    ).toEqual({
      "5h": 95,
      "7d": 80,
    });
  });

  test("a reading whose window has reset counts as absent", async () => {
    const rates = pickRates(
      [
        { kind: "five_hour", percentUsed: 99, resetsAt: PAST },
        { kind: "five_hour", percentUsed: 10, resetsAt: FUTURE },
      ],
      NOW,
    );
    expect(rates["5h"]?.percentUsed).toBe(10);
    expect(verdict({ "5h": 80 }, rates, undefined)).toBeUndefined();
  });

  test("the first window over its limit is the reason", async () => {
    const rates = pickRates(
      [{ kind: "seven_day", percentUsed: 91, resetsAt: FUTURE }],
      NOW,
    );
    expect(verdict({ "5h": 80, "7d": 90 }, rates, undefined)).toMatch(
      /^7d usage 91\.0% >= limit 90%/,
    );
    expect(verdict({ cost: 5 }, {}, 6.2)).toMatch(
      /^Session cost ~\$6\.20 >= limit \$5\.00/,
    );
  });
});

/** The engine beneath the plugin: usage, store, clock, env and one model step. */
function engine(
  on: On,
  usage: Partial<SessionUsage>,
  store: Record<string, unknown> = {},
) {
  const sent: number[] = [];
  const logged: string[] = [];
  const statuses: (string | undefined)[] = [];
  const written: { path: string; text: string }[] = [];
  mock.clock(on, { now: NOW });
  mock.store(on, store);
  mock.env(on, { HOME: "/home/u", XDG_STATE_HOME: "/state" });
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [],
      ...usage,
    },
  }));
  on("ui.log", (_, e) => {
    logged.push(e.text);
    return { value: undefined };
  });
  on("ui.status", (_, e) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  on("fs.write", (_, e) => {
    written.push({ path: e.path, text: e.text });
    return { value: undefined };
  });
  on("session.measure", (_, e) => ({ changed: e.changed }));
  on("turn.step", async function* (_, e) {
    sent.push(e.index);
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "ok",
      toolUses: [],
      stopReason: "end_turn" as const,
      usage: null,
    };
  });

  return { sent, logged, written, statuses };
}

const STEP = { turnId: "t1", index: 0, model: "opus", messageCount: 1 };

async function step($: Engine) {
  const stream = $.turn.step(STEP);
  let item = await stream.next();
  while (!item.done) item = await stream.next();

  return item.value;
}

async function run($: Engine, args: string) {
  const { text } = await $.command.run({
    command: "limit-usage",
    args,
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 80 },
  });

  return text ?? "";
}

describe("the guard on model steps", () => {
  test("with no threshold every request is sent", async ($, on) => {
    const world = engine(on, {
      rateLimits: [{ kind: "five_hour", percentUsed: 99, resetsAt: FUTURE }],
    });
    await step($);
    expect(world.sent).toEqual([0]);
  });

  test("over a session threshold, no request is sent", async ($, on) => {
    const world = engine(on, {
      rateLimits: [{ kind: "five_hour", percentUsed: 85, resetsAt: FUTURE }],
    });
    expect(await run($, "5h=80")).toMatch(/5h=80% \(session\)/);
    const result = await step($);
    expect(world.sent).toEqual([]);
    expect(result.stopReason).toBeNull();
    expect(world.logged.join("\n")).toMatch(/5h usage 85\.0% >= limit 80%/);
  });

  test("a session threshold overrides the global one", async ($, on) => {
    const world = engine(on, {
      rateLimits: [{ kind: "five_hour", percentUsed: 92, resetsAt: FUTURE }],
    });
    await run($, "5h=90 --global");
    await run($, "5h=95");
    await step($);
    expect(world.sent).toEqual([0]);
  });

  test("a global threshold applies when the session has none", async ($, on) => {
    const world = engine(on, {
      rateLimits: [{ kind: "seven_day", percentUsed: 92, resetsAt: FUTURE }],
    });
    await run($, "7d=90 --global");
    await step($);
    expect(world.sent).toEqual([]);
  });

  test("another session's reading guards a session with none yet", async ($, on) => {
    const world = engine(
      on,
      { rateLimits: [] },
      {
        "shared-rates": {
          readings: [{ kind: "five_hour", percentUsed: 85, resetsAt: FUTURE }],
          at: NOW,
        },
      },
    );
    await run($, "5h=80");
    await step($);
    expect(world.sent).toEqual([]);
  });

  test("cost stops at its limit, and --global still sets it per session", async ($, on) => {
    const world = engine(on, { cost: { usd: 6 } });
    expect(await run($, "cost=$5 --global")).toMatch(/cost is session-only/);
    await step($);
    expect(world.sent).toEqual([]);
  });

  test("clear lets requests through again", async ($, on) => {
    const world = engine(on, {
      rateLimits: [{ kind: "five_hour", percentUsed: 85, resetsAt: FUTURE }],
    });
    await run($, "5h=80 7d=50 --global");
    await run($, "5h=80");
    expect(await run($, "clear")).toMatch(/Cleared 3 threshold/);
    await step($);
    expect(world.sent).toEqual([0]);
  });

  test("the status line shows the block and clears with it", async ($, on) => {
    const world = engine(on, {
      rateLimits: [{ kind: "five_hour", percentUsed: 85, resetsAt: FUTURE }],
    });
    await run($, "5h=80");
    expect(world.statuses.at(-1)).toMatch(/^Blocked: 5h 85\.0% >= 80%/);
    await step($);
    expect(world.statuses.at(-1)).toMatch(/^Blocked: 5h/);
    await run($, "clear");
    expect(world.statuses.at(-1)).toBeUndefined();
    await step($);
    expect(world.sent).toEqual([0]);
    expect(world.statuses.at(-1)).toBeUndefined();
  });

  test("status shows thresholds, usage and whether it blocks", async ($, on) => {
    engine(on, {
      rateLimits: [{ kind: "five_hour", percentUsed: 85, resetsAt: FUTURE }],
      cost: { usd: 1.234 },
    });
    await run($, "5h=80");
    const text = await run($, "status");
    expect(text).toMatch(/5h limit: {3}80% \(session\)/);
    expect(text).toMatch(/5h used: {3}85\.0%/);
    expect(text).toMatch(/~\$1\.23/);
    expect(text).toMatch(/Blocking: 5h usage/);
  });
});

describe("publishing readings", () => {
  test("a measurement is shared in the store and written as a snapshot", async ($, on) => {
    const world = engine(
      on,
      {},
      {
        "shared-rates": {
          readings: [{ kind: "seven_day", percentUsed: 40, resetsAt: FUTURE }],
          at: 0,
        },
      },
    );
    await $.session.measure({
      context: { window: 200000 },
      rateLimits: [{ kind: "five_hour", percentUsed: 30, resetsAt: FUTURE }],
      changed: ["rateLimits"],
    });
    expect(world.written).toHaveLength(1);
    expect(world.written[0]?.path).toBe("/state/cc-limit-usage.json");
    const snapshot = JSON.parse(world.written[0]?.text ?? "{}");
    expect(snapshot.schema).toBe(1);
    expect(snapshot.epoch).toBe(Math.floor(NOW / 1000));
    expect(snapshot.rateLimits).toHaveLength(2);

    // The shared reading now guards this session even with its own empty.
    await run($, "5h=25");
    await step($);
    expect(world.sent).toEqual([]);
  });
});

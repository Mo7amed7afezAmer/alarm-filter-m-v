import { describe, expect, it } from "vitest";
import type { MailSource } from "./gmail.js";
import { planSync } from "./sync.js";

function fakeSource(over: Partial<MailSource> = {}): MailSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    historySince: async (start) => {
      calls.push(`history:${start}`);
      return { ids: ["a", "b", "c"], historyId: "200" };
    },
    currentHistoryId: async () => {
      calls.push("profile");
      return "150";
    },
    listSince: async (after, q) => {
      calls.push(`list:${after.toISOString()}:${q ?? ""}`);
      return ["x", "y"];
    },
    getMeta: async () => null,
    ...over,
  };
}

const none = async () => new Set<string>();
const opts = { maxPerRun: 200, backfillHours: 24, now: new Date("2026-10-11T12:00:00Z") };

describe("planSync", () => {
  it("uses history.list when a lastHistoryId exists and advances it when drained", async () => {
    const src = fakeSource();
    const plan = await planSync(src, "100", none, opts);
    expect(src.calls).toEqual(["history:100"]);
    expect(plan).toMatchObject({
      mode: "history",
      ids: ["a", "b", "c"],
      nextHistoryId: "200",
      backlog: 0,
    });
  });

  it("first run: falls back to messages.list after:(now - backfill), captures historyId first", async () => {
    const src = fakeSource();
    const plan = await planSync(src, null, none, { ...opts, query: "from:alarms@x" });
    expect(src.calls).toEqual(["profile", "list:2026-10-10T12:00:00.000Z:from:alarms@x"]);
    expect(plan).toMatchObject({ mode: "fallback", ids: ["x", "y"], nextHistoryId: "150" });
  });

  it("404 historyId too old: falls back to messages.list", async () => {
    const src = fakeSource({ historySince: async () => "expired" });
    const plan = await planSync(src, "1", none, opts);
    expect(plan.mode).toBe("fallback");
    expect(plan.nextHistoryId).toBe("150");
  });

  it("skips messages already in raw_messages", async () => {
    const plan = await planSync(fakeSource(), "100", async () => new Set(["b"]), opts);
    expect(plan.ids).toEqual(["a", "c"]);
  });

  it("caps at maxPerRun and does NOT advance historyId until the backlog is drained", async () => {
    const plan = await planSync(fakeSource(), "100", none, { ...opts, maxPerRun: 2 });
    // Newest first, so current mail is never stuck behind a backlog.
    expect(plan).toMatchObject({ ids: ["b", "c"], nextHistoryId: null, backlog: 1 });

    // Next run: b and c are now stored → a is fetched and the historyId advances.
    const next = await planSync(fakeSource(), "100", async () => new Set(["b", "c"]), {
      ...opts,
      maxPerRun: 2,
    });
    expect(next).toMatchObject({ ids: ["a"], nextHistoryId: "200", backlog: 0 });
  });
});

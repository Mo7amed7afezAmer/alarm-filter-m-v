import { beforeEach, describe, expect, it } from "vitest";
import { MatchingEngine, type AlarmRecord } from "./engine.js";
import { MemoryAlarmRepository } from "./memory-repo.js";
import type { RuleRecord } from "./classify.js";
import { body } from "./__fixtures__/body.js";
import { parseBody } from "./body.js";

// Fictional sites. Subject times are Africa/Cairo wall-clock (UTC+3 in Oct 2026).
const RULES: RuleRecord[] = [
  { pattern: "LINK FAILURE", category: "DOWN", priority: 10 },
  { pattern: "RECTIFIER", category: "POWER", priority: 130 },
  { pattern: "POWER", category: "POWER", priority: 160 },
];

const LINK = "S_D_N_BTS O&M LINK FAILURE";
const SITE = "0001_S_XX-TEST-ONE_0A01DE";
const KEY = `${LINK}||${SITE}`;

/** Subject in the real HASH format; `cairo` is "DD-MON-YYYY HH:mm:ss". */
function subj(cairo: string, opts: { clear?: boolean; name?: string; site?: string } = {}) {
  const name = opts.name ?? LINK;
  return `${opts.clear ? "CLEARED_" : ""}${name} on #${opts.site ?? SITE}# at |${cairo} |`;
}

const utc = (iso: string) => new Date(iso);

let repo: MemoryAlarmRepository;
let engine: MatchingEngine;
let seq = 0;

/** Store a raw message and return it (receivedAt is the Gmail internalDate). */
function mail(subject: string, receivedAtIso: string) {
  seq++;
  return repo.addRaw({ gmailId: `g${seq}`, subject, receivedAt: utc(receivedAtIso) });
}

function alarmsByKey(key = KEY): AlarmRecord[] {
  return repo.alarms.filter((a) => a.alarmKey === key).sort((a, b) => +a.alarmTime - +b.alarmTime);
}

beforeEach(() => {
  repo = new MemoryAlarmRepository(RULES);
  engine = new MatchingEngine(repo, { timeZone: "Africa/Cairo" });
  seq = 0;
});

describe("required cases (CLAUDE.md §7)", () => {
  it("1. normal alarm → Clear 1 hour later", async () => {
    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:02:00Z"),
      mail(subj("11-OCT-2026 16:00:00", { clear: true }), "2026-10-11T14:00:00Z"),
    ]);
    expect(s).toMatchObject({ created: 1, cleared: 1, total: 2 });
    const [a] = alarmsByKey();
    expect(a).toMatchObject({
      status: "CLEARED",
      clearType: "EMAIL",
      durationMin: 60,
      category: "DOWN",
      alarmName: LINK,
      site: SITE,
    });
    expect(a!.alarmTime.toISOString()).toBe("2026-10-11T13:00:00.000Z");
    // clearTime = Clear email receivedAt, NOT the subject time
    expect(a!.clearTime!.toISOString()).toBe("2026-10-11T14:00:00.000Z");
  });

  it("2. alarm → Clear 1 day later (across two batches)", async () => {
    await engine.processBatch([mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:01:00Z")]);
    expect(alarmsByKey()[0]!.status).toBe("ACTIVE");
    await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00", { clear: true }), "2026-10-12T13:00:00Z"),
    ]);
    expect(alarmsByKey()[0]).toMatchObject({ status: "CLEARED", durationMin: 1440 });
  });

  it("3. alarm → same alarm newer time (AUTO_SUPERSEDED) → Clear for the new one", async () => {
    await engine.processBatch([mail(subj("11-OCT-2026 10:00:00"), "2026-10-11T07:01:00Z")]);
    const s2 = await engine.processBatch([
      mail(subj("11-OCT-2026 12:30:00"), "2026-10-11T09:31:00Z"),
    ]);
    expect(s2.superseded).toBe(1);

    let [old, cur] = alarmsByKey();
    expect(old).toMatchObject({
      status: "CLEARED",
      clearType: "AUTO_SUPERSEDED",
      durationMin: 150,
    });
    expect(old!.clearTime!.toISOString()).toBe("2026-10-11T09:30:00.000Z"); // = new alarmTime
    expect(cur!.status).toBe("ACTIVE");

    await engine.processBatch([
      mail(subj("11-OCT-2026 12:30:00", { clear: true }), "2026-10-11T10:00:00Z"),
    ]);
    [old, cur] = alarmsByKey();
    expect(cur).toMatchObject({ status: "CLEARED", clearType: "EMAIL", durationMin: 30 });
    expect(old!.clearType).toBe("AUTO_SUPERSEDED"); // untouched
  });

  it("4. exact duplicate alarm email is ignored", async () => {
    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:01:00Z"),
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:01:05Z"),
    ]);
    expect(s).toMatchObject({ created: 1, duplicate: 1 });
    expect(alarmsByKey()).toHaveLength(1);
    expect(repo.raw.every((r) => r.processed)).toBe(true);
  });

  it("5. Clear with no matching active alarm → orphan_clears, never dropped", async () => {
    const m = mail(subj("01-OCT-2026 09:00:00", { clear: true }), "2026-10-11T13:00:00Z");
    const s = await engine.processBatch([m]);
    expect(s.orphan).toBe(1);
    expect(repo.alarms).toHaveLength(0);
    expect(repo.orphans).toEqual([
      {
        id: 1,
        alarmKey: KEY,
        subject: m.subject,
        clearTime: utc("2026-10-11T13:00:00Z"),
        rawMessageId: m.id,
        consecNbr: null,
      },
    ]);
  });

  it("6a. out-of-order in one batch: Clear email received before the alarm email", async () => {
    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00", { clear: true }), "2026-10-11T13:20:00Z"),
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:25:00Z"),
    ]);
    expect(s).toMatchObject({ created: 1, cleared: 1, orphan: 0 });
    expect(alarmsByKey()[0]).toMatchObject({
      status: "CLEARED",
      clearType: "EMAIL",
      durationMin: 20,
    });
  });

  it("6b. out-of-order across runs: orphan Clear is consumed when its alarm arrives", async () => {
    await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00", { clear: true }), "2026-10-11T13:20:00Z"),
    ]);
    expect(repo.orphans).toHaveLength(1);

    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:25:00Z"),
    ]);
    expect(s.created_cleared).toBe(1);
    expect(repo.orphans).toHaveLength(0);
    expect(alarmsByKey()[0]).toMatchObject({
      status: "CLEARED",
      clearType: "EMAIL",
      durationMin: 20,
    });
  });

  it("7. subject that does not parse is kept with parse_error, no alarm", async () => {
    const m = mail("Weekly report — please review", "2026-10-11T13:00:00Z");
    const s = await engine.processBatch([m]);
    expect(s.parse_error).toBe(1);
    expect(repo.alarms).toHaveLength(0);
    expect(repo.raw[0]).toMatchObject({
      processed: true,
      parseError: "unrecognised subject format",
    });
  });
});

describe("edge cases", () => {
  it("Huawei-format messages are stored only, never create alarms", async () => {
    const s = await engine.processBatch([
      mail(
        "Huawei Alram Notify New alarm: TEST-RNC27/UMTS Cell Unavailable/Major",
        "2026-10-11T13:00:00Z",
      ),
    ]);
    expect(s.ignored_format).toBe(1);
    expect(repo.alarms).toHaveLength(0);
    expect(repo.raw[0]).toMatchObject({ processed: true, parseError: null });
  });

  it("classifies by rules: DOWN / POWER / OTHER", async () => {
    await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:01:00Z"),
      mail(
        subj("11-OCT-2026 16:00:00", { name: "S_D_N_RECTIFIER MAJOR ALARM" }),
        "2026-10-11T13:01:00Z",
      ),
      mail(subj("11-OCT-2026 16:00:00", { name: "S_D_N_FIRE ALARM" }), "2026-10-11T13:01:00Z"),
    ]);
    const cat = (n: string) => repo.alarms.find((a) => a.alarmName === n)!.category;
    expect(cat(LINK)).toBe("DOWN");
    expect(cat("S_D_N_RECTIFIER MAJOR ALARM")).toBe("POWER");
    expect(cat("S_D_N_FIRE ALARM")).toBe("OTHER");
  });

  it("Clear for an already-superseded alarm does not close the newer active one", async () => {
    await engine.processBatch([
      mail(subj("11-OCT-2026 10:00:00"), "2026-10-11T07:01:00Z"),
      mail(subj("11-OCT-2026 12:00:00"), "2026-10-11T09:01:00Z"),
    ]);
    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 10:00:00", { clear: true }), "2026-10-11T09:30:00Z"),
    ]);
    expect(s.stale_clear).toBe(1);
    expect(alarmsByKey()[1]!.status).toBe("ACTIVE");
  });

  it("duplicate Clear email is a no-op (keeps the first clear time)", async () => {
    await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:01:00Z"),
      mail(subj("11-OCT-2026 16:00:00", { clear: true }), "2026-10-11T14:00:00Z"),
    ]);
    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00", { clear: true }), "2026-10-11T15:00:00Z"),
    ]);
    expect(s.stale_clear).toBe(1);
    expect(alarmsByKey()[0]!.clearTime!.toISOString()).toBe("2026-10-11T14:00:00.000Z");
  });

  it("older alarm delivered after a newer one is created already superseded", async () => {
    await engine.processBatch([mail(subj("11-OCT-2026 12:00:00"), "2026-10-11T09:01:00Z")]);
    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 10:00:00"), "2026-10-11T09:05:00Z"),
    ]);
    expect(s.created_superseded).toBe(1);
    const [old, cur] = alarmsByKey();
    expect(old).toMatchObject({
      status: "CLEARED",
      clearType: "AUTO_SUPERSEDED",
      durationMin: 120,
    });
    expect(cur!.status).toBe("ACTIVE");
  });

  it("late alarm consuming an orphan still supersedes an older active alarm", async () => {
    // Clear(12:00) arrives first → orphan; then alarm 10:00 → ACTIVE; then alarm 12:00.
    await engine.processBatch([
      mail(subj("11-OCT-2026 12:00:00", { clear: true }), "2026-10-11T09:20:00Z"),
    ]);
    await engine.processBatch([mail(subj("11-OCT-2026 10:00:00"), "2026-10-11T09:21:00Z")]);
    const s = await engine.processBatch([
      mail(subj("11-OCT-2026 12:00:00"), "2026-10-11T09:22:00Z"),
    ]);
    expect(s.created_cleared).toBe(1);
    const [old, cur] = alarmsByKey();
    expect(old).toMatchObject({
      status: "CLEARED",
      clearType: "AUTO_SUPERSEDED",
      durationMin: 120,
    });
    expect(cur).toMatchObject({ status: "CLEARED", clearType: "EMAIL", durationMin: 20 });
    expect(repo.orphans).toHaveLength(0);
  });

  it("Clear without an exact-time match falls back to the latest active alarm (§7 B.1)", async () => {
    await engine.processBatch([
      mail(subj("11-OCT-2026 09:00:00", { site: "OTHER-SITE" }), "2026-10-11T06:01:00Z"),
      mail(subj("11-OCT-2026 10:00:00"), "2026-10-11T07:01:00Z"),
    ]);
    await engine.processBatch([
      mail(subj("11-OCT-2026 09:59:00", { clear: true }), "2026-10-11T08:00:00Z"),
    ]);
    expect(alarmsByKey()[0]).toMatchObject({ status: "CLEARED", durationMin: 60 });
    expect(alarmsByKey(`${LINK}||OTHER-SITE`)[0]!.status).toBe("ACTIVE"); // different key untouched
  });

  it("';Default System Time' suffix on the Clear still matches the plain alarm", async () => {
    await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:01:00Z"),
      mail(
        subj("11-OCT-2026 16:00:00", { clear: true, name: `${LINK};Default System Time` }),
        "2026-10-11T13:30:00Z",
      ),
    ]);
    expect(alarmsByKey()[0]).toMatchObject({ status: "CLEARED", durationMin: 30 });
  });

  it("result does not depend on input order within a batch", async () => {
    const msgs = [
      mail(subj("11-OCT-2026 12:00:00", { clear: true }), "2026-10-11T09:40:00Z"),
      mail(subj("11-OCT-2026 12:00:00"), "2026-10-11T09:02:00Z"),
      mail(subj("11-OCT-2026 10:00:00"), "2026-10-11T07:02:00Z"),
    ];
    await engine.processBatch(msgs);
    const forward = snapshot(repo);

    const repo2 = new MemoryAlarmRepository(RULES);
    await new MatchingEngine(repo2, { timeZone: "Africa/Cairo" }).processBatch([...msgs].reverse());
    expect(snapshot(repo2)).toEqual(forward);
  });

  it("negative durations (clock skew) are clamped to 0", async () => {
    await engine.processBatch([
      mail(subj("11-OCT-2026 16:00:00"), "2026-10-11T13:01:00Z"),
      mail(subj("11-OCT-2026 16:00:00", { clear: true }), "2026-10-11T12:59:00Z"),
    ]);
    expect(alarmsByKey()[0]!.durationMin).toBe(0);
  });
});

describe("CONSEC_NBR identity (email body)", () => {
  const WCDMA = "S_D_N_WCDMA CELL OUT OF USE";
  const S = "U_S_XX-TEST_3830DE";
  const at = "11-OCT-2026 21:02:49";
  const bmail = (
    o: { clear?: boolean; cell?: string | null; consec: string; device?: string },
    receivedAtIso: string,
  ) => {
    seq++;
    return repo.addRaw({
      gmailId: `g${seq}`,
      subject: subj(at, { clear: o.clear, name: WCDMA, site: S }),
      body: body({
        kind: o.clear ? "CLEARENCE" : "NEW",
        name: "WCDMA CELL OUT OF USE",
        site: S,
        ...o,
      }),
      receivedAt: utc(receivedAtIso),
    });
  };

  it("same subject+time, different cells = separate alarms (user report, 2026-10-11)", async () => {
    const s = await engine.processBatch([
      bmail({ cell: "A_XX_2_24312_S", consec: "2291816" }, "2026-10-11T18:05:00Z"),
      bmail({ cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:05:01Z"),
      bmail({ cell: "A_XX_4_24314_S", consec: "2291817" }, "2026-10-11T18:05:02Z"),
    ]);
    expect(s).toMatchObject({ created: 3, duplicate: 0, superseded: 0 });
    expect(repo.alarms.map((a) => a.cellName).sort()).toEqual([
      "A_XX_2_24312_S",
      "A_XX_3_24313_S",
      "A_XX_4_24314_S",
    ]);
    expect(repo.alarms.every((a) => a.status === "ACTIVE")).toBe(true);
  });

  it("a Clear closes only the alarm with its CONSEC_NBR", async () => {
    await engine.processBatch([
      bmail({ cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:05:00Z"),
      bmail({ cell: "A_XX_4_24314_S", consec: "2291817" }, "2026-10-11T18:05:01Z"),
    ]);
    const s = await engine.processBatch([
      bmail({ clear: true, cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:25:38Z"),
    ]);
    expect(s.cleared).toBe(1);
    const byConsec = (c: string) => repo.alarms.find((a) => a.consecNbr === c)!;
    expect(byConsec("2291814")).toMatchObject({
      status: "CLEARED",
      clearType: "EMAIL",
      durationMin: 23,
    });
    expect(byConsec("2291817").status).toBe("ACTIVE");
  });

  it("same subject, no cell (MRBTS), different CONSEC_NBR = still separate alarms", async () => {
    const s = await engine.processBatch([
      bmail({ cell: null, device: "MRBTS", consec: "100" }, "2026-10-11T18:05:00Z"),
      bmail({ cell: null, device: "MRBTS", consec: "101" }, "2026-10-11T18:05:01Z"),
    ]);
    expect(s).toMatchObject({ created: 2, duplicate: 0 });
  });

  it("same alarm + site at a NEW time, no cell → independent alarms, no supersede (user report)", async () => {
    // Real case: NE3SWS AGENT … on BH-KANAYES-VLG at 22:47:39 (#2300397) then 22:50:40 (#1113627011).
    const name = "S_D_N_NE3SWS AGENT NOT RESPONDING TO REQUESTS";
    const site = "SRAN_LWG_TDD_S_XX-TEST-VLG_3646DE";
    const m = (t: string, consec: string, clear: boolean, rx: string) => {
      seq++;
      return repo.addRaw({
        gmailId: `g${seq}`,
        subject: subj(t, { name, site, clear }),
        body: body({
          kind: clear ? "CLEARENCE" : "NEW",
          name: name.slice(6),
          start: t,
          site,
          cell: null,
          device: "site",
          consec,
        }),
        receivedAt: utc(rx),
      });
    };
    const s = await engine.processBatch([
      m("11-OCT-2026 22:47:39", "2300397", false, "2026-10-11T19:48:00Z"),
      m("11-OCT-2026 22:50:40", "1113627011", false, "2026-10-11T19:51:00Z"),
    ]);
    expect(s).toMatchObject({ created: 2, superseded: 0 });
    expect(repo.alarms.every((a) => a.status === "ACTIVE")).toBe(true);

    // Each one is closed only by its own Clear.
    await engine.processBatch([
      m("11-OCT-2026 22:50:40", "1113627011", true, "2026-10-11T20:25:08Z"),
    ]);
    const by = (c: string) => repo.alarms.find((a) => a.consecNbr === c)!;
    expect(by("1113627011")).toMatchObject({
      status: "CLEARED",
      clearType: "EMAIL",
      durationMin: 34,
    });
    expect(by("2300397").status).toBe("ACTIVE");
  });

  it("an older alarm arriving late (with CONSEC_NBR) is created ACTIVE, not superseded", async () => {
    await engine.processBatch([
      bmail({ cell: null, device: "site", consec: "200" }, "2026-10-11T18:10:00Z"),
    ]);
    seq++;
    const s = await engine.processBatch([
      repo.addRaw({
        gmailId: `g${seq}`,
        subject: subj("11-OCT-2026 20:00:00", { name: WCDMA, site: S }),
        body: body({
          start: "11-OCT-2026 20:00:00",
          site: S,
          cell: null,
          device: "site",
          consec: "199",
        }),
        receivedAt: utc("2026-10-11T18:11:00Z"),
      }),
    ]);
    expect(s).toMatchObject({ created: 1, created_superseded: 0 });
  });

  it("an empty NE_name line does not swallow the next label", () => {
    const b = body({ cell: null, device: "site" }).replace("\t\tRNC66\r\n", "\r\n");
    expect(parseBody(b)).toMatchObject({ neName: null, alarmNumber: "7771", consecNbr: "2291814" });
  });

  it("the same email twice (same CONSEC_NBR) is a duplicate", async () => {
    const s = await engine.processBatch([
      bmail({ cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:05:00Z"),
      bmail({ cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:05:09Z"),
    ]);
    expect(s).toMatchObject({ created: 1, duplicate: 1 });
  });

  it("a Clear with an unknown CONSEC_NBR is an orphan — never closes another cell's alarm", async () => {
    await engine.processBatch([
      bmail({ cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:05:00Z"),
    ]);
    const s = await engine.processBatch([
      bmail({ clear: true, cell: "A_XX_3_24313_S", consec: "9999999" }, "2026-10-11T18:30:00Z"),
    ]);
    expect(s.orphan).toBe(1);
    expect(repo.alarms[0]!.status).toBe("ACTIVE");
    expect(repo.orphans[0]!.consecNbr).toBe("9999999");
  });

  it("Clear first, alarm later (across runs) → orphan consumed by CONSEC_NBR", async () => {
    await engine.processBatch([
      bmail({ clear: true, cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:25:00Z"),
    ]);
    const s = await engine.processBatch([
      bmail({ cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:26:00Z"),
    ]);
    expect(s.created_cleared).toBe(1);
    expect(repo.orphans).toHaveLength(0);
  });

  it("a duplicate Clear is stale", async () => {
    await engine.processBatch([
      bmail({ cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:05:00Z"),
      bmail({ clear: true, cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:25:00Z"),
    ]);
    const s = await engine.processBatch([
      bmail({ clear: true, cell: "A_XX_3_24313_S", consec: "2291814" }, "2026-10-11T18:26:00Z"),
    ]);
    expect(s.stale_clear).toBe(1);
  });
});

describe("reprocess(days)", () => {
  const NOW = utc("2026-10-11T18:00:00Z");

  function loadScenario() {
    // Before the 1-day window: alarm that is cleared inside the window.
    mail(subj("10-OCT-2026 08:00:00", { site: "OLD" }), "2026-10-10T05:01:00Z");
    mail(subj("10-OCT-2026 08:00:00", { site: "OLD", clear: true }), "2026-10-11T12:00:00Z");
    // Inside the window: supersede + clear, an orphan, a duplicate, garbage, Huawei.
    mail(subj("11-OCT-2026 10:00:00"), "2026-10-11T07:01:00Z");
    mail(subj("11-OCT-2026 12:00:00"), "2026-10-11T09:01:00Z");
    mail(subj("11-OCT-2026 12:00:00"), "2026-10-11T09:01:30Z");
    mail(subj("11-OCT-2026 12:00:00", { clear: true }), "2026-10-11T10:00:00Z");
    mail(subj("01-OCT-2026 09:00:00", { site: "GONE", clear: true }), "2026-10-11T11:00:00Z");
    mail("not an alarm", "2026-10-11T11:30:00Z");
    mail("Huawei Alram Notify New alarm: TEST-RNC/NodeB Unavailable/Major", "2026-10-11T11:31:00Z");
  }

  it("running it twice yields identical results", async () => {
    loadScenario();
    await engine.processBatch(repo.raw); // normal incremental processing
    const incremental = snapshot(repo);

    await engine.reprocess(1, NOW);
    const first = snapshot(repo);
    await engine.reprocess(1, NOW);
    const second = snapshot(repo);

    expect(second).toEqual(first);
    expect(first).toEqual(incremental); // and matches what live processing produced
  });

  it("rebuilds correctly from scratch, including alarms opened before the window", async () => {
    loadScenario();
    await engine.processBatch(repo.raw);
    // Corrupt derived state, then reprocess.
    repo.alarms.forEach((a) => (a.category = "OTHER"));
    repo.orphans = [];

    const s = await engine.reprocess(1, NOW);
    expect(s.orphan).toBe(1);
    const old = alarmsByKey(`${LINK}||OLD`)[0]!;
    expect(old).toMatchObject({ status: "CLEARED", clearType: "EMAIL" }); // reopened, re-closed
    expect(alarmsByKey()).toHaveLength(2);
    expect(alarmsByKey().every((a) => a.category === "DOWN")).toBe(true);
  });
});

/** Comparable state, without auto-increment ids. */
function snapshot(r: MemoryAlarmRepository) {
  return {
    alarms: r.alarms
      .map(({ id: _id, ...a }) => a)
      .sort((a, b) => a.alarmKey.localeCompare(b.alarmKey) || +a.alarmTime - +b.alarmTime),
    orphans: r.orphans
      .map(({ id: _id, ...o }) => o)
      .sort((a, b) => a.rawMessageId - b.rawMessageId),
  };
}

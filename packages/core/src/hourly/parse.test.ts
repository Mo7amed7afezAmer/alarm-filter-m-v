import { beforeAll, describe, expect, it } from "vitest";
import { extractXlsx, unrarJsBackend } from "./extract.js";
import { alarmTimeText, parseReport, type ParsedReport } from "./parse.js";
import { readFixture, REPORT_RAR } from "./test-fixtures.js";

const limits = { maxRarBytes: 25 << 20, maxExtractBytes: 100 << 20, maxEntries: 20 };

describe.skipIf(!REPORT_RAR)("parseReport on the real fixture", () => {
  let report: ParsedReport;
  beforeAll(async () => {
    const { data } = await extractXlsx(readFixture(REPORT_RAR), { limits, backend: unrarJsBackend });
    report = await parseReport(data);
  });

  it("reads the categorized sheets (not All) with their data-row counts", () => {
    // Counts of THIS fixture (13-OCT-2026 ~07:00 report). The task brief listed 743 / 499 /
    // 469 / 3 / 1289 / 45, which belong to a different report — see CLAUDE.md §14 note.
    expect(report.sheets).toEqual({
      "2G_Down": 529,
      "3G_Down": 434,
      "4G_Down": 438,
      "5G_Down": 2,
      Environmental: 1394,
      HW: 35,
    });
    expect(report.rows.some((r) => r.sheet === "All")).toBe(false);
  });

  it("dedupes *_Down rows across sheets on DN + Alarm Text + Alarm Time", () => {
    const down = report.rows.filter((r) => r.sheet.endsWith("_Down"));
    const rawDown = 529 + 434 + 438 + 2;
    expect(down.length).toBe(856);
    expect(down.length).toBeLessThan(rawDown);
    const keys = new Set(down.map((r) => `${r.dn}|${r.alarmText}|${r.alarmTime}`));
    expect(keys.size).toBe(down.length);
    // non-Down sheets are never merged
    expect(report.rows.length).toBe(856 + 1394 + 35);
  });

  it("reduces SYNCHRONIZATION PROBLEM duplicates to unique DN + time with technologies[]", () => {
    const sync = report.rows.filter((r) => r.alarmText === "BASE STATION SYNCHRONIZATION PROBLEM");
    expect(sync.length).toBeGreaterThan(0);
    const keys = new Set(sync.map((r) => `${r.dn}|${r.alarmTime}`));
    expect(keys.size).toBe(sync.length);
    const multi = sync.filter((r) => r.technologies.length > 1);
    expect(multi.length).toBe(181);
    for (const r of multi) {
      expect(r.sheets.length).toBe(r.technologies.length);
      expect(r.technologies).toEqual(r.sheets.map((s) => s.replace("_Down", "")));
    }
  });

  it("takes the Environmental alarm name from Supplementary Information", () => {
    const env = report.rows.filter((r) => r.sheet === "Environmental");
    // §14 says Alarm Text is constant; in reality it is mostly constant (EXTERNAL AL n, FIRE ALARM, …)
    const generic = env.filter((r) => r.alarmText === "BASE STATION EXTERNAL ALARM NOTIFICATION");
    expect(generic.length / env.length).toBeGreaterThan(0.5);
    expect(env.every((r) => r.alarmName === (r.supplementaryInfo || r.alarmText))).toBe(true);
    const rect = env.find((r) => r.supplementaryInfo === "RECTIFIER MINOR ALARM")!;
    expect(rect.alarmName).toBe("RECTIFIER MINOR ALARM");
    // empty Supplementary → falls back to Alarm Text, never an empty name
    expect(env.every((r) => r.alarmName !== "")).toBe(true);
    // Down sheets keep Alarm Text
    const d = report.rows.find((r) => r.sheet === "2G_Down")!;
    expect(d.alarmName).toBe(d.alarmText);
  });

  it("flags clockInvalid (year < 2020) and keeps the row", () => {
    const bad = report.rows.filter((r) => r.clockInvalid);
    expect(bad.length).toBe(2);
    expect(bad.every((r) => r.sheet === "HW" && Number(r.alarmTime.slice(0, 4)) < 2020)).toBe(true);
  });

  it("keeps the wall-clock Alarm Time as shown in Excel", () => {
    expect(report.rows.every((r) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.alarmTime))).toBe(true);
    expect(report.rows.find((r) => r.alarmNumber === "7767")?.alarmTime).toBe("2026-10-13 07:01:57");
  });
});

describe("alarmTimeText", () => {
  it("handles Date, Excel serial and text formats", () => {
    expect(alarmTimeText(new Date(Date.UTC(2026, 9, 13, 7, 1, 57)))).toBe("2026-10-13 07:01:57");
    expect(alarmTimeText(46308.5)).toBe("2026-10-13 12:00:00");
    expect(alarmTimeText("13-OCT-2026 07:01:57")).toBe("2026-10-13 07:01:57");
    expect(alarmTimeText("2026-10-13T07:01")).toBe("2026-10-13 07:01:00");
    expect(alarmTimeText(null)).toBe("");
  });
});

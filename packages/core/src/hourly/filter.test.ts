import { describe, expect, it } from "vitest";
import { diffHourly } from "./diff.js";
import {
  filterHourlyRows,
  formatHourlySort,
  hourlyFacets,
  parseHourlySort,
  sortHourlyRows,
} from "./filter.js";
import { row } from "./test-fixtures.js";
import { officeColor, type HourlyRow } from "./types.js";

const rows = [
  row({ id: 0, alarmTime: "2026-10-13 06:00:00" }),
  row({ id: 1, code: "0002UP", region: "UP", office: "DAMANHOUR", vip: true, sheets: ["2G_Down", "3G_Down"] }),
  row({
    id: 2,
    sheet: "Environmental",
    sheets: ["Environmental"],
    alarmName: "MAIN POWER CUT OFF",
    category: "POWER",
    alarmTime: "2026-10-13 07:30:00",
  }),
  row({ id: 3, code: "9999DE", office: "", vip: null, unmatched: true, name: "S_KS-X_9999DE" }),
];
const ids = (rs: HourlyRow[]) => rs.map((r) => r.id);

describe("filterHourlyRows", () => {
  it("filters by sheet membership (deduped rows count in every sheet)", () => {
    expect(ids(filterHourlyRows(rows, { sheet: "3G_Down" }))).toEqual([1]);
    expect(ids(filterHourlyRows(rows, { sheet: "Environmental" }))).toEqual([2]);
  });

  it("multi-value filters are OR within, AND across, case-insensitive", () => {
    expect(ids(filterHourlyRows(rows, { office: ["kafr el dawar", "DAMANHOUR"] }))).toEqual([0, 1, 2]);
    expect(ids(filterHourlyRows(rows, { office: ["KAFR EL DAWAR"], alarm: ["MAIN POWER CUT OFF"] }))).toEqual([2]);
    expect(ids(filterHourlyRows(rows, { region: ["UP"] }))).toEqual([1]);
    expect(ids(filterHourlyRows(rows, { category: ["POWER"] }))).toEqual([2]);
  });

  it("VIP, time range and free text", () => {
    expect(ids(filterHourlyRows(rows, { vip: true }))).toEqual([1]);
    expect(ids(filterHourlyRows(rows, { vip: false }))).toEqual([0, 2, 3]);
    expect(ids(filterHourlyRows(rows, { from: "2026-10-13T07:00", to: "2026-10-13 07:15" }))).toEqual([1, 3]);
    expect(ids(filterHourlyRows(rows, { to: "2026-10-13" }))).toEqual([0, 1, 2, 3]);
    expect(ids(filterHourlyRows(rows, { q: "ks-x" }))).toEqual([3]);
    expect(ids(filterHourlyRows(rows, { q: "0002" }))).toEqual([1]);
  });
});

describe("sorting", () => {
  it("default = office asc (empty last), then alarmTime desc", () => {
    expect(ids(sortHourlyRows(rows, parseHourlySort(null)))).toEqual([1, 2, 0, 3]);
  });
  it("parses / formats sort strings and drops unknown keys", () => {
    const s = parseHourlySort("-code,bogus,alarmTime");
    expect(s).toEqual([
      { key: "code", desc: true },
      { key: "alarmTime", desc: false },
    ]);
    expect(formatHourlySort(s)).toBe("-code,alarmTime");
    expect(ids(sortHourlyRows(rows, s))).toEqual([3, 1, 0, 2]);
  });
});

describe("facets, diff, colors", () => {
  it("facets list distinct values with counts", () => {
    const f = hourlyFacets(rows);
    expect(f.office).toEqual([
      { value: "DAMANHOUR", count: 1 },
      { value: "KAFR EL DAWAR", count: 2 },
    ]);
    expect(f.sheet.find((s) => s.value === "2G_Down")?.count).toBe(3);
  });

  it("diff by code + alarmName + DN ignores time", () => {
    const a = [rows[0]!, rows[2]!];
    const b = [{ ...rows[0]!, alarmTime: "2026-10-13 08:00:00" }, rows[1]!];
    const d = diffHourly(a, b);
    expect(ids(d.new)).toEqual([1]);
    expect(ids(d.disappeared)).toEqual([2]);
  });

  it("office colors are fixed per office and empty for unknown office", () => {
    expect(officeColor("KAFR EL DAWAR")).toBe(officeColor("Kafr ElDawar"));
    expect(officeColor("KAFR EL DAWAR")).not.toBe(officeColor("DAMANHOUR"));
    expect(officeColor("SOME NEW OFFICE")).toMatch(/^[0-9A-F]{6}$/);
    expect(officeColor("")).toBeNull();
  });
});

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildHourlyXlsx } from "./exportXlsx.js";
import { row } from "./test-fixtures.js";
import { officeColor } from "./types.js";

describe("buildHourlyXlsx", () => {
  it("writes only the requested columns, in order, with office fills, frozen header and autofilter", async () => {
    const rows = [
      row({ office: "KAFR EL DAWAR", code: "0001DE", technologies: ["2G", "3G"] }),
      row({ office: "", code: "9999DE", vip: null }),
    ];
    const buf = await buildHourlyXlsx(rows, ["code", "office", "vip", "technologies", "alarmTime"]);
    expect(buf.subarray(0, 2).toString()).toBe("PK");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Site Code",
      "Office",
      "VIP",
      "Technologies",
      "Alarm Time",
    ]);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual([
      "0001DE",
      "KAFR EL DAWAR",
      "NO",
      "2G, 3G",
      "2026-10-13 07:00:00",
    ]);
    expect(ws.rowCount).toBe(3);

    const fill = ws.getRow(2).getCell(1).fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe(`FF${officeColor("KAFR EL DAWAR")}`);
    expect(ws.getRow(3).getCell(1).fill).toBeUndefined(); // no office → no fill
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getColumn(1).width).toBe(10);
  });

  it("rejects an empty column list", async () => {
    await expect(buildHourlyXlsx([], [])).rejects.toThrow(/columns/);
  });
});

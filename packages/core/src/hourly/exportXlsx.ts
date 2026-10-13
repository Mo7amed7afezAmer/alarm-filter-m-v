// Excel export reproducing the visible table (§14): chosen columns in order, bold header,
// rows filled by office color, frozen header, autofilter, column widths. Server-only.

import ExcelJS from "exceljs";
import {
  HOURLY_COLUMNS,
  HOURLY_DEFAULT_COLUMNS,
  hourlyCellText,
  officeColor,
  type HourlyColumnKey,
  type HourlyRow,
} from "./types.js";

export async function buildHourlyXlsx(
  rows: readonly HourlyRow[],
  columns: readonly HourlyColumnKey[] = HOURLY_DEFAULT_COLUMNS,
  sheetName = "Hourly alarms",
): Promise<Buffer> {
  const cols = columns
    .map((k) => HOURLY_COLUMNS.find((c) => c.key === k))
    .filter((c): c is (typeof HOURLY_COLUMNS)[number] => !!c);
  if (!cols.length) throw new Error("No valid columns to export");

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  for (const r of rows) {
    const row = ws.addRow(Object.fromEntries(cols.map((c) => [c.key, hourlyCellText(r, c.key)])));
    const color = officeColor(r.office);
    if (color)
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
      });
  }

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: cols.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

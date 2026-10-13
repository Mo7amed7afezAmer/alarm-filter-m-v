// NSN Update_Output.xlsx → raw rows (§14 file format). Server-only (exceljs).

import ExcelJS from "exceljs";
import { HOURLY_SHEETS, isDownSheet, technologyOf } from "./types.js";
import { HourlyReportError } from "./validate.js";

/** A report row before SiteMaster enrichment and normalization. */
export interface RawHourlyRow {
  alarmNumber: string;
  alarmType: string;
  alarmTime: string;
  alarmText: string;
  /** Alarm Text, or Supplementary Information on Environmental (falls back to Alarm Text). */
  alarmName: string;
  dn: string;
  objectClass: string;
  name: string;
  siteName: string;
  code: string;
  supplementaryInfo: string;
  technologies: string[];
  sheet: string;
  sheets: string[];
  clockInvalid: boolean;
}

export interface ParsedReport {
  rows: RawHourlyRow[];
  /** Data rows per sheet as read (before dedupe); 0 for a missing sheet. */
  sheets: Record<string, number>;
}

/** Column headers (row 1), matched case/space-insensitively. */
const COLUMNS = {
  alarmNumber: "Alarm Number",
  alarmType: "Alarm Type",
  alarmTime: "Alarm Time",
  alarmText: "Alarm Text",
  dn: "Distinguished Name",
  objectClass: "Object Class",
  name: "Name",
  siteName: "Site Name",
  code: "Site Code",
  supplementaryInfo: "Supplementary Information",
} as const;
type ColKey = keyof typeof COLUMNS;
const REQUIRED: ColKey[] = ["alarmTime", "alarmText", "dn", "code"];

const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Plain text of any exceljs cell value (rich text, hyperlink, formula result, …). */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return wallClock(v);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
  }
  return String(v).trim();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** exceljs returns Excel wall-clock times as UTC Dates → "YYYY-MM-DD HH:mm:ss". */
function wallClock(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

const MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");

/** Alarm Time cell → wall-clock string. Unknown text formats are kept verbatim. */
export function alarmTimeText(v: ExcelJS.CellValue): string {
  if (v instanceof Date) return wallClock(v);
  if (typeof v === "number") return wallClock(new Date(Math.round((v - 25569) * 86_400_000)));
  const s = cellText(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6] ?? "00"}`;
  const nsn = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (nsn) {
    const m = MONTHS.indexOf(nsn[2]!.toUpperCase());
    if (m >= 0)
      return `${nsn[3]}-${pad(m + 1)}-${pad(Number(nsn[1]))} ${pad(Number(nsn[4]))}:${nsn[5]}:${nsn[6] ?? "00"}`;
  }
  return s;
}

const yearOf = (t: string) => Number(/^(\d{4})-/.exec(t)?.[1] ?? NaN);

function readSheet(ws: ExcelJS.Worksheet): Omit<RawHourlyRow, "technologies" | "sheets">[] {
  const header = ws.getRow(1);
  const idx: Partial<Record<ColKey, number>> = {};
  header.eachCell((cell, col) => {
    const k = headerKey(cellText(cell.value));
    for (const [key, label] of Object.entries(COLUMNS) as [ColKey, string][])
      if (headerKey(label) === k && idx[key] === undefined) idx[key] = col;
  });
  const missing = REQUIRED.filter((k) => idx[k] === undefined);
  if (missing.length)
    throw new HourlyReportError(
      "BAD_WORKBOOK",
      `Sheet ${ws.name} is missing column(s): ${missing.map((k) => COLUMNS[k]).join(", ")}`,
    );

  const out: Omit<RawHourlyRow, "technologies" | "sheets">[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    if (rowNo === 1) return;
    const get = (k: ColKey) => (idx[k] ? cellText(row.getCell(idx[k]!).value) : "");
    const alarmTime = alarmTimeText(row.getCell(idx.alarmTime!).value);
    const alarmText = get("alarmText");
    const dn = get("dn");
    if (!alarmText && !dn && !alarmTime) return; // blank line
    const supplementaryInfo = get("supplementaryInfo");
    const year = yearOf(alarmTime);
    out.push({
      alarmNumber: get("alarmNumber"),
      alarmType: get("alarmType"),
      alarmTime,
      alarmText,
      alarmName: ws.name === "Environmental" ? supplementaryInfo || alarmText : alarmText,
      dn,
      objectClass: get("objectClass"),
      name: get("name"),
      siteName: get("siteName"),
      code: get("code").toUpperCase(),
      supplementaryInfo,
      sheet: ws.name,
      clockInvalid: Number.isFinite(year) && year < 2020,
    });
  });
  return out;
}

/**
 * Reads the categorized sheets (never `All`). Rows that appear in several *_Down sheets
 * (same DN + Alarm Text + Alarm Time) are merged into one, collecting `technologies`.
 */
export async function parseReport(xlsx: Buffer): Promise<ParsedReport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  } catch (err) {
    throw new HourlyReportError("BAD_WORKBOOK", `Cannot read the Excel file: ${(err as Error).message}`);
  }
  const found = HOURLY_SHEETS.filter((s) => wb.getWorksheet(s));
  if (!found.length)
    throw new HourlyReportError("BAD_WORKBOOK", `None of the sheets ${HOURLY_SHEETS.join(", ")} found`);

  const sheets: Record<string, number> = {};
  const rows: RawHourlyRow[] = [];
  const downByKey = new Map<string, RawHourlyRow>();
  for (const name of HOURLY_SHEETS) {
    const ws = wb.getWorksheet(name);
    const sheetRows = ws ? readSheet(ws) : [];
    sheets[name] = sheetRows.length;
    for (const r of sheetRows) {
      if (!isDownSheet(name)) {
        rows.push({ ...r, technologies: [], sheets: [name] });
        continue;
      }
      const key = `${r.dn}\u0000${r.alarmText}\u0000${r.alarmTime}`;
      const prev = downByKey.get(key);
      const tech = technologyOf(name);
      if (prev) {
        if (!prev.sheets.includes(name)) prev.sheets.push(name);
        if (!prev.technologies.includes(tech)) prev.technologies.push(tech);
        continue;
      }
      const row: RawHourlyRow = { ...r, technologies: [tech], sheets: [name] };
      downByKey.set(key, row);
      rows.push(row);
    }
  }
  return { rows, sheets };
}

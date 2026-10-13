// SiteMaster import file (§14): sheet "SiteMaster", columns Code, Site Name, Office,
// Nodality, VIP, Site type, Power Source, Battery (+ optional Notes). Server-only.
// Other columns in the template (Guard Number, Owner Code, Nodality (raw)) are ignored.

import ExcelJS from "exceljs";
import { baseNormalize } from "./normalize.js";
import { regionOf } from "./types.js";
import { HourlyReportError } from "./validate.js";

export interface SiteMasterInput {
  code: string;
  siteName: string | null;
  office: string;
  nodality: string | null;
  vip: boolean;
  siteType: string | null;
  powerSource: string | null;
  battery: string | null;
  region: string | null;
  notes: string | null;
}

export interface SiteMasterParse {
  rows: SiteMasterInput[];
  skipped: { row: number; code: string; reason: string }[];
}

const COLS = {
  code: "Code",
  siteName: "Site Name",
  office: "Office",
  nodality: "Nodality",
  vip: "VIP",
  siteType: "Site type",
  powerSource: "Power Source",
  battery: "Battery",
  notes: "Notes",
} as const;
type Key = keyof typeof COLS;
const hk = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function text(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return text(v.result as ExcelJS.CellValue);
    return "";
  }
  return String(v).replace(/\s+/g, " ").trim();
}

/** Site codes look like "3273DE": 4 alphanumerics + 2-letter region. */
const CODE_RE = /^[0-9A-Z]{3,6}[A-Z]{2}$/;

export async function parseSiteMasterXlsx(data: Buffer): Promise<SiteMasterParse> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch (err) {
    throw new HourlyReportError("BAD_WORKBOOK", `Cannot read the Excel file: ${(err as Error).message}`);
  }
  const ws =
    wb.getWorksheet("SiteMaster") ??
    wb.worksheets.find((w) => hk(w.name) === "sitemaster") ??
    wb.worksheets[0];
  if (!ws) throw new HourlyReportError("BAD_WORKBOOK", "Workbook has no sheets");

  const idx: Partial<Record<Key, number>> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = hk(text(cell.value));
    for (const [k, label] of Object.entries(COLS) as [Key, string][])
      if (hk(label) === h && idx[k] === undefined) idx[k] = col;
  });
  if (!idx.code || !idx.office)
    throw new HourlyReportError(
      "BAD_WORKBOOK",
      `Sheet "${ws.name}" needs at least the columns Code and Office`,
    );

  const rows: SiteMasterInput[] = [];
  const skipped: SiteMasterParse["skipped"] = [];
  const seen = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    if (rowNo === 1) return;
    const get = (k: Key) => (idx[k] ? text(row.getCell(idx[k]!).value) : "");
    const opt = (k: Key) => get(k) || null;
    const code = get("code").toUpperCase();
    if (!code) return; // blank line
    if (!CODE_RE.test(code)) return void skipped.push({ row: rowNo, code, reason: "invalid code" });
    if (seen.has(code)) return void skipped.push({ row: rowNo, code, reason: "duplicate code in file" });
    const office = baseNormalize(get("office"));
    if (!office) return void skipped.push({ row: rowNo, code, reason: "office is empty" });
    seen.add(code);
    rows.push({
      code,
      siteName: opt("siteName"),
      office,
      nodality: opt("nodality"),
      vip: /^(y|yes|true|1|vip)$/i.test(get("vip")),
      siteType: opt("siteType"),
      powerSource: opt("powerSource"),
      battery: opt("battery"),
      region: regionOf(code) || null,
      notes: opt("notes"),
    });
  });
  return { rows, skipped };
}

// SiteMaster import file (§14): sheet "SiteMaster", columns Code, Site Name, Office,
// Nodality, VIP, Site type, Power Source, Battery, Guard Number (= phone; also accepted as
// Phone / Phone Number / Mobile) (+ optional Notes). Server-only.
// Other columns in the template (Owner Code, Nodality (raw)) are ignored.

import ExcelJS from "exceljs";
import { baseNormalize } from "./normalize.js";
import { regionOf, SITE_CODE_RE } from "./types.js";
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
  phone: string | null;
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
  phone: ["Guard Number", "Guard Phone", "Phone", "Phone Number", "Mobile", "Contact"],
  notes: "Notes",
} as const;
type Key = keyof typeof COLS;
const labels = (k: Key): readonly string[] => {
  const l = COLS[k];
  return typeof l === "string" ? [l] : l;
};
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

const CODE_RE = SITE_CODE_RE;

/**
 * Phone cell → text. Excel often stores mobile numbers as numbers and drops the leading 0
 * (1012345678 → "01012345678"). Several numbers stay separated by " / ".
 */
export function phoneText(raw: string): string | null {
  const parts = raw
    .split(/[/,;|\n]+/)
    // "0101234567 0109876543" = two numbers; "010 123 4567" = one
    .flatMap((p) => {
      const tokens = p.trim().split(/\s+/);
      return tokens.length > 1 && tokens.every((t) => t.replace(/\D/g, "").length >= 8) ? tokens : [p];
    })
    .map((p) => p.replace(/[^\d+]/g, ""))
    .filter((p) => p.length >= 6)
    .map((p) => (/^1\d{9}$/.test(p) ? `0${p}` : p));
  return parts.length ? [...new Set(parts)].join(" / ") : null;
}

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
    for (const k of Object.keys(COLS) as Key[])
      if (labels(k).some((l) => hk(l) === h) && idx[k] === undefined) idx[k] = col;
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
      phone: phoneText(get("phone")),
      region: regionOf(code) || null,
      notes: opt("notes"),
    });
  });
  return { rows, skipped };
}

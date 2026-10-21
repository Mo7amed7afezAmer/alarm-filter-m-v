// Hourly reports (CLAUDE.md §14): row shape, columns, category, region, office colors.
// Browser-safe — re-exported from "@alarm/core" for the UI.

import type { Category } from "../index.js";

/** Sheets read from `NSN Update_Output.xlsx` (`All` is skipped on purpose, §14). */
export const HOURLY_SHEETS = [
  "2G_Down",
  "3G_Down",
  "4G_Down",
  "5G_Down",
  "Environmental",
  "HW",
] as const;
export type HourlySheet = (typeof HOURLY_SHEETS)[number];

export const isDownSheet = (sheet: string): boolean => sheet.endsWith("_Down");

/** One output row (§14 "Output row"). */
export interface HourlyRow {
  /** Stable within a report: index after dedupe. */
  id: number;
  /** "YYYY-MM-DD HH:mm:ss" — wall clock exactly as in the Excel (no timezone conversion). */
  alarmTime: string;
  alarmNumber: string;
  alarmText: string;
  /** Alarm Text, except Environmental → Supplementary Information. Used by the alarm filter. */
  alarmName: string;
  dn: string;
  objectClass: string;
  name: string;
  siteName: string;
  code: string;
  office: string;
  nodality: string;
  /** null when the code is not in SiteMaster. */
  vip: boolean | null;
  siteType: string;
  powerSource: string;
  battery: string;
  /** Site contact (Guard Number in the SiteMaster file); "" when unknown. */
  phone: string;
  supplementaryInfo: string;
  region: string;
  /** "2G", "3G", … collected across the *_Down sheets the row appeared in. */
  technologies: string[];
  /** First sheet the row was seen in. */
  sheet: string;
  /** Every sheet the row appeared in (after dedupe across *_Down). */
  sheets: string[];
  category: Category;
  /** Alarm Time year < 2020 (NE clock not set). Row is kept. */
  clockInvalid: boolean;
  /** Code is empty or has no SiteMaster entry. */
  unmatched: boolean;
}

export interface HourlyMeta {
  rowCount: number;
  /** Data rows per sheet as read (before dedupe). */
  sheets: Record<string, number>;
  /** Distinct non-empty site codes missing from SiteMaster. */
  unmatchedCodes: number;
  /** Rows with an empty Site Code (e.g. TEST NEs). */
  emptyCodes: number;
  processedAt: string;
  durationMs: number;
}

/** Columns the UI / export can show, in default order (§14 Output row + a few opt-ins). */
export const HOURLY_COLUMNS = [
  { key: "alarmTime", header: "Alarm Time", width: 20 },
  { key: "alarmText", header: "Alarm Text", width: 36 },
  { key: "name", header: "Name", width: 34 },
  { key: "siteName", header: "Site Name", width: 34 },
  { key: "code", header: "Site Code", width: 10 },
  { key: "office", header: "Office", width: 18 },
  { key: "nodality", header: "Nodality", width: 10 },
  { key: "vip", header: "VIP", width: 6 },
  { key: "siteType", header: "Site Type", width: 12 },
  { key: "powerSource", header: "Power Source", width: 12 },
  { key: "battery", header: "Battery", width: 9 },
  { key: "phone", header: "Phone", width: 14 },
  { key: "supplementaryInfo", header: "Supplementary Information", width: 34 },
  { key: "region", header: "Region", width: 8 },
  { key: "technologies", header: "Technologies", width: 14 },
  { key: "sheet", header: "Sheet", width: 14 },
  { key: "alarmName", header: "Alarm", width: 34 },
  { key: "dn", header: "Distinguished Name", width: 44 },
  { key: "category", header: "Category", width: 10 },
] as const satisfies readonly { key: keyof HourlyRow; header: string; width: number }[];
export type HourlyColumnKey = (typeof HOURLY_COLUMNS)[number]["key"];
export const HOURLY_COLUMN_KEYS = HOURLY_COLUMNS.map((c) => c.key) as HourlyColumnKey[];
/** Shown by default (the user's Excel); the rest are opt-in in the column chooser. */
export const HOURLY_DEFAULT_COLUMNS: HourlyColumnKey[] = HOURLY_COLUMN_KEYS.filter(
  (k) => k !== "alarmName" && k !== "dn" && k !== "category",
);

/** Cell text for a column (export, copy-as-table, sorting). */
export function hourlyCellText(row: HourlyRow, key: HourlyColumnKey): string {
  const v = row[key];
  if (key === "vip") return v === null ? "" : v ? "YES" : "NO";
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

// ---- category (filter only, never stored) ----

const POWER_RE = /RECTIFIER|MAIN POWER|BATTERY|GENERATOR|SURGE/;

export function hourlyCategory(sheet: string, alarmName: string): Category {
  if (isDownSheet(sheet)) return "DOWN";
  if (sheet === "Environmental" && POWER_RE.test(alarmName.toUpperCase())) return "POWER";
  return "OTHER";
}

/** Site codes look like "3273DE" / "0H31DE": 3–6 alphanumerics + 2-letter region. */
export const SITE_CODE_RE = /^[0-9A-Z]{3,6}[A-Z]{2}$/;

/**
 * Site code of an alarm-mail site name — its last "_" segment:
 * "SRAN_LWG_TDD_S_BH-QMB-LOQIN_0H31DE" → "0H31DE", "U_S_BH-MHLT-KYL_3830DE" → "3830DE".
 * null when the last segment is not a code.
 */
export function siteCodeOf(site: string | null | undefined): string | null {
  const last = (site ?? "").trim().split("_").pop()?.toUpperCase() ?? "";
  return SITE_CODE_RE.test(last) ? last : null;
}

/** "3273DE" → "DE". */
export const regionOf = (code: string): string => (code.length >= 2 ? code.slice(-2) : "");

/** "2G_Down" → "2G". */
export const technologyOf = (sheet: string): string => sheet.replace(/_Down$/, "");

// ---- office colors (UI and export use the same palette) ----

/** Light fills readable with dark text. Hex without '#'. */
export const OFFICE_PALETTE = [
  "DBEAFE", // blue
  "DCFCE7", // green
  "FEF3C7", // amber
  "FCE7F3", // pink
  "E0E7FF", // indigo
  "CCFBF1", // teal
  "FFEDD5", // orange
  "EDE9FE", // violet
  "FEE2E2", // red
  "ECFCCB", // lime
  "CFFAFE", // cyan
  "F5F5F4", // stone
] as const;

/**
 * Comparable office name: last "/" segment, letters only, upper-case. Links the Gmail office
 * label to the Site Master office column: "DN/Kafr ElDawar" and "KAFR EL DAWAR" → "KAFRELDAWAR".
 */
export const officeMatchKey = (office: string): string =>
  (office.split("/").pop() ?? "").toUpperCase().replace(/[^A-Z]/g, "");

const officeKey = officeMatchKey;

/** Fixed slots for the known offices (CLAUDE.md §12 office list) so colors never shuffle. */
const FIXED: Record<string, number> = {
  KAFRELDAWAR: 0,
  DAMANHOUR: 1,
  DUMIAT: 2,
  KAFRELSHEIKH: 3,
  MANSOURA: 4,
  PORTSAID: 5,
  TANTA: 6,
  BENHA: 7,
  DYRBNEGM: 8,
  FAQOUS: 9,
  SADAT: 10,
  SHEBIN: 11,
  ZAGAZIG: 2,
  HUAWEI: 4,
};

/** Fill color (hex, no '#') for an office; null for empty office (unmatched code). */
export function officeColor(office: string | null | undefined): string | null {
  if (!office) return null;
  const k = officeKey(office);
  if (!k) return null;
  let idx = FIXED[k];
  if (idx === undefined) {
    let h = 0;
    for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    idx = h % OFFICE_PALETTE.length;
  }
  return OFFICE_PALETTE[idx]!;
}

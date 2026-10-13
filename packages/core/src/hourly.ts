// Hourly reports (CLAUDE.md §14): row shape, normalization, category, office colors.
// Pure — shared by apps/api (processing, export) and apps/web (table, filters).

import type { Category } from "./index.js";

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

/** One output row (§14 "Output row"). Times are wall-clock strings as shown in the report. */
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
  /** Code had no SiteMaster entry. */
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

/** Columns the UI / export can show, in default order (§14 Output row). */
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

/** Cell text for a column (export, copy-as-table, search). */
export function hourlyCellText(row: HourlyRow, key: HourlyColumnKey): string {
  const v = row[key];
  if (key === "vip") return v === null ? "" : v ? "YES" : "NO";
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

// ---- normalization ----

export interface NormalizationRule {
  /** Row field, or "*" for every normalized field. */
  field: string;
  from: string;
  to: string;
}

/** Fields that get trim/collapse/upper-case + rules. DN / code / times are left as-is. */
export const NORMALIZED_FIELDS = [
  "alarmText",
  "alarmName",
  "supplementaryInfo",
  "office",
  "siteType",
  "nodality",
  "powerSource",
  "battery",
] as const;

/** Seed for table HourlyNormalization (§14). */
export const DEFAULT_HOURLY_NORMALIZATIONS: NormalizationRule[] = [
  { field: "alarmName", from: "MAIN POWER CUTTOFF", to: "MAIN POWER CUT OFF" },
  { field: "alarmName", from: "SHELTER DOO", to: "SHELTER DOOR" },
  { field: "alarmName", from: "TEMPRATURE", to: "TEMPERATURE" },
  { field: "*", from: "DAMNHOUR", to: "DAMANHOUR" },
];

/** Trim, collapse runs of whitespace, upper-case. */
export function baseNormalize(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compiles rules into a function (field, value) → normalized value. A rule replaces `from`
 * only as a whole token sequence — "SHELTER DOO" fixes "SHELTER DOO" but leaves
 * "SHELTER DOOR" alone, "TEMPRATURE" fixes "SHELTER HIGH TEMPRATURE".
 */
export function compileNormalizer(rules: readonly NormalizationRule[]) {
  const compiled = rules
    .map((r) => ({ field: r.field.trim(), from: baseNormalize(r.from), to: baseNormalize(r.to) }))
    .filter((r) => r.from)
    // longer patterns first so "MAIN POWER CUTTOFF" wins over a hypothetical "CUTTOFF"
    .sort((a, b) => b.from.length - a.from.length)
    .map((r) => ({
      ...r,
      re: new RegExp(`(?<![A-Z0-9])${escapeRe(r.from)}(?![A-Z0-9])`, "g"),
    }));
  return (field: string, value: string | null | undefined): string => {
    let v = baseNormalize(value);
    if (!v) return v;
    for (const r of compiled) {
      if (r.field !== "*" && r.field !== field) continue;
      v = v.replace(r.re, r.to);
    }
    return v;
  };
}

// ---- category (filter only, never stored) ----

const POWER_RE = /RECTIFIER|MAIN POWER|BATTERY|GENERATOR|SURGE/;

export function hourlyCategory(sheet: string, alarmName: string): Category {
  if (isDownSheet(sheet)) return "DOWN";
  if (sheet === "Environmental" && POWER_RE.test(alarmName.toUpperCase())) return "POWER";
  return "OTHER";
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

const officeKey = (office: string) => office.toUpperCase().replace(/[^A-Z]/g, "");

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

// ---- filtering / sorting (API rows + export; web reuses for client-side work) ----

export interface HourlyFilters {
  sheet?: string;
  region?: string[];
  office?: string[];
  alarm?: string[];
  siteType?: string[];
  category?: Category[];
  vip?: boolean;
  /** Wall-clock "YYYY-MM-DD HH:mm[:ss]" bounds, inclusive. */
  from?: string;
  to?: string;
  /** Free text on code / name / siteName. */
  q?: string;
}

/** "2026-10-13T07:00" or "2026-10-13 07:00" → "2026-10-13 07:00:00" for string comparison. */
export function normalizeWallClock(s: string): string {
  const t = s.trim().replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t.slice(0, 19);
}

export function filterHourlyRows(rows: readonly HourlyRow[], f: HourlyFilters): HourlyRow[] {
  const set = (xs?: string[]) =>
    xs && xs.length ? new Set(xs.map((x) => x.toUpperCase())) : null;
  const region = set(f.region);
  const office = set(f.office);
  const alarm = set(f.alarm);
  const siteType = set(f.siteType);
  const category = f.category?.length ? new Set<string>(f.category) : null;
  const from = f.from ? normalizeWallClock(f.from) : null;
  const to = f.to ? normalizeWallClock(f.to) : null;
  const q = f.q?.trim().toUpperCase() || null;
  return rows.filter(
    (r) =>
      (!f.sheet || r.sheets.includes(f.sheet)) &&
      (!region || region.has(r.region.toUpperCase())) &&
      (!office || office.has(r.office.toUpperCase())) &&
      (!alarm || alarm.has(r.alarmName.toUpperCase())) &&
      (!siteType || siteType.has(r.siteType.toUpperCase())) &&
      (!category || category.has(r.category)) &&
      (f.vip === undefined || (r.vip ?? false) === f.vip) &&
      (!from || r.alarmTime >= from) &&
      (!to || r.alarmTime <= to) &&
      (!q ||
        r.code.toUpperCase().includes(q) ||
        r.name.toUpperCase().includes(q) ||
        r.siteName.toUpperCase().includes(q)),
  );
}

export type HourlySort = { key: HourlyColumnKey; desc: boolean }[];

/** Default: office asc (unknown last), then alarmTime desc (§14). */
export const HOURLY_DEFAULT_SORT: HourlySort = [
  { key: "office", desc: false },
  { key: "alarmTime", desc: true },
];

/** "office,-alarmTime" ⇄ sort spec. Unknown keys are dropped. */
export function parseHourlySort(s: string | undefined | null): HourlySort {
  if (!s) return HOURLY_DEFAULT_SORT;
  const out: HourlySort = [];
  for (const part of s.split(",")) {
    const desc = part.startsWith("-");
    const key = part.replace(/^[-+]/, "") as HourlyColumnKey;
    if ((HOURLY_COLUMN_KEYS as string[]).includes(key)) out.push({ key, desc });
  }
  return out.length ? out : HOURLY_DEFAULT_SORT;
}

export function sortHourlyRows(rows: readonly HourlyRow[], sort: HourlySort): HourlyRow[] {
  return [...rows].sort((a, b) => {
    for (const { key, desc } of sort) {
      const av = hourlyCellText(a, key);
      const bv = hourlyCellText(b, key);
      if (av === bv) continue;
      // empty values (e.g. office of an unmatched code) always sort last
      if (!av) return 1;
      if (!bv) return -1;
      const c = av < bv ? -1 : 1;
      return desc ? -c : c;
    }
    return a.id - b.id;
  });
}

/** Diff key (§14): site code + alarm + DN. */
export const hourlyDiffKey = (r: HourlyRow): string => `${r.code}|${r.alarmName}|${r.dn}`;

export function diffHourly(a: readonly HourlyRow[], b: readonly HourlyRow[]) {
  const aKeys = new Set(a.map(hourlyDiffKey));
  const bKeys = new Set(b.map(hourlyDiffKey));
  return {
    /** In b (newer) but not in a. */
    new: b.filter((r) => !aKeys.has(hourlyDiffKey(r))),
    /** In a but gone from b. */
    disappeared: a.filter((r) => !bKeys.has(hourlyDiffKey(r))),
  };
}

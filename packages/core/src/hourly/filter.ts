// Filtering and sorting of processed hourly rows. Browser-safe (the UI reuses it).

import type { Category } from "../index.js";
import {
  HOURLY_COLUMN_KEYS,
  hourlyCellText,
  type HourlyColumnKey,
  type HourlyRow,
} from "./types.js";

export interface HourlyFilters {
  /** Matches rows that appeared in this sheet (a deduped row can be in several). */
  sheet?: string;
  region?: string[];
  office?: string[];
  /** Exact alarmName values (case-insensitive). */
  alarm?: string[];
  siteType?: string[];
  category?: Category[];
  vip?: boolean;
  /** Wall-clock bounds "YYYY-MM-DD[ HH:mm[:ss]]", inclusive. */
  from?: string;
  to?: string;
  /** Free text on code / name / siteName. */
  q?: string;
}

/** "2026-10-13T07:00" / "2026-10-13 07:00" / "2026-10-13" → "YYYY-MM-DD HH:mm:ss". */
export function normalizeWallClock(s: string, end = false): string {
  const t = s.trim().replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} ${end ? "23:59:59" : "00:00:00"}`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return `${t}:${end ? "59" : "00"}`;
  return t.slice(0, 19);
}

export function filterHourlyRows(rows: readonly HourlyRow[], f: HourlyFilters): HourlyRow[] {
  const set = (xs?: string[]) =>
    xs && xs.length ? new Set(xs.map((x) => x.trim().toUpperCase())) : null;
  const region = set(f.region);
  const office = set(f.office);
  const alarm = set(f.alarm);
  const siteType = set(f.siteType);
  const category = f.category?.length ? new Set<string>(f.category) : null;
  const from = f.from ? normalizeWallClock(f.from) : null;
  const to = f.to ? normalizeWallClock(f.to, true) : null;
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

/** "office,-alarmTime" → sort spec. Unknown keys are dropped; empty → default. */
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

export const formatHourlySort = (sort: HourlySort): string =>
  sort.map((s) => (s.desc ? "-" : "") + s.key).join(",");

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

/** Distinct non-empty values per filterable field — feeds the filter dropdowns. */
export function hourlyFacets(rows: readonly HourlyRow[]) {
  const acc = {
    region: new Map<string, number>(),
    office: new Map<string, number>(),
    alarm: new Map<string, number>(),
    siteType: new Map<string, number>(),
    sheet: new Map<string, number>(),
  };
  const bump = (m: Map<string, number>, v: string) => v && m.set(v, (m.get(v) ?? 0) + 1);
  for (const r of rows) {
    bump(acc.region, r.region);
    bump(acc.office, r.office);
    bump(acc.alarm, r.alarmName);
    bump(acc.siteType, r.siteType);
    for (const s of r.sheets) bump(acc.sheet, s);
  }
  const list = (m: Map<string, number>) =>
    [...m].map(([value, count]) => ({ value, count })).sort((a, b) => (a.value < b.value ? -1 : 1));
  return {
    region: list(acc.region),
    office: list(acc.office),
    alarm: list(acc.alarm),
    siteType: list(acc.siteType),
    sheet: list(acc.sheet),
  };
}
export type HourlyFacets = ReturnType<typeof hourlyFacets>;

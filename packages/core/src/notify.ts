// Per-user notification preferences: which NEW alarms count as "important" for a user.
// Within a dimension any value matches (OR); across dimensions all must match (AND);
// an empty dimension means "any".
import type { Category } from "./index.js";

export interface NotifyPrefs {
  enabled: boolean;
  sound: boolean;
  /** Empty = any category. */
  categories: Category[];
  /** Exact alarm names (as stored, e.g. "S_D_N_BCCH MISSING"), case-insensitive. Empty = any. */
  alarmNames: string[];
  /** Case-insensitive substrings of the site id. Empty = any site. */
  sites: string[];
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: true,
  sound: true,
  categories: ["DOWN"],
  alarmNames: [],
  sites: [],
};

const CATS = new Set<Category>(["DOWN", "POWER", "OTHER"]);

function strings(v: unknown, max = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x === "string" && x.trim()) out.add(x.trim().slice(0, 200));
    if (out.size >= max) break;
  }
  return [...out];
}

/** Turns whatever is stored (possibly null / older shape) into valid prefs. */
export function normalizePrefs(raw: unknown): NotifyPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_NOTIFY_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_NOTIFY_PREFS.enabled,
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_NOTIFY_PREFS.sound,
    categories: strings(r.categories).filter((c): c is Category => CATS.has(c as Category)),
    alarmNames: strings(r.alarmNames, 500),
    sites: strings(r.sites, 100),
  };
}

export function matchesPrefs(
  alarm: { category: Category | string; alarmName: string; site: string },
  prefs: NotifyPrefs,
): boolean {
  if (!prefs.enabled) return false;
  if (prefs.categories.length && !prefs.categories.includes(alarm.category as Category))
    return false;
  if (prefs.alarmNames.length) {
    const name = alarm.alarmName.toUpperCase();
    if (!prefs.alarmNames.some((n) => n.toUpperCase() === name)) return false;
  }
  if (prefs.sites.length) {
    const site = alarm.site.toUpperCase();
    if (!prefs.sites.some((s) => site.includes(s.toUpperCase()))) return false;
  }
  return true;
}

// Value normalization for hourly report fields (§14): trim, collapse spaces, upper-case,
// then the HourlyNormalization rules. Browser-safe.

export interface NormalizationRule {
  /** Row field ("alarmName", "office", …) or "*" for every normalized field. */
  field: string;
  from: string;
  to: string;
}

/** Fields that get normalized. DN / code / times are left as-is. */
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
export type NormalizedField = (typeof NORMALIZED_FIELDS)[number];

/**
 * A rule for "alarmName" also fixes the columns the alarm name comes from, so the table
 * never shows "SHELTER DOO" in Supplementary Information next to "SHELTER DOOR" in Alarm.
 */
const FIELD_ALIASES: Record<string, string> = {
  alarmText: "alarmName",
  supplementaryInfo: "alarmName",
};

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

export type Normalizer = (field: string, value: string | null | undefined) => string;

/**
 * Compiles rules into (field, value) → normalized value. A rule replaces `from` only as a
 * whole-token sequence: "SHELTER DOO" fixes "SHELTER DOO" but leaves "SHELTER DOOR"
 * alone; "TEMPRATURE" fixes "SHELTER HIGH TEMPRATURE". `from` is base-normalized too, so
 * "MAIN POWER  CUTTOFF" (double space) matches the "MAIN POWER CUTTOFF" rule.
 */
export function compileNormalizer(rules: readonly NormalizationRule[]): Normalizer {
  const compiled = rules
    .map((r) => ({ field: r.field.trim(), from: baseNormalize(r.from), to: baseNormalize(r.to) }))
    .filter((r) => r.from)
    // longer patterns first so a specific rule wins over a shorter overlapping one
    .sort((a, b) => b.from.length - a.from.length)
    .map((r) => ({
      ...r,
      re: new RegExp(`(?<![A-Z0-9])${escapeRe(r.from)}(?![A-Z0-9])`, "g"),
    }));
  return (field, value) => {
    let v = baseNormalize(value);
    if (!v) return v;
    const alias = FIELD_ALIASES[field];
    for (const r of compiled) {
      if (r.field !== "*" && r.field !== field && r.field !== alias) continue;
      v = v.replace(r.re, r.to);
    }
    return v;
  };
}

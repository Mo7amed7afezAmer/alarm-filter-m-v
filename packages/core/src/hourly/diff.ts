// Compare two processed reports (§14 diff). Browser-safe.

import type { HourlyRow } from "./types.js";

/** Diff key: site code + alarm + DN (time is ignored — the same alarm still active). */
export const hourlyDiffKey = (r: HourlyRow): string => `${r.code}|${r.alarmName}|${r.dn}`;

/** `a` = older report, `b` = newer. */
export function diffHourly(a: readonly HourlyRow[], b: readonly HourlyRow[]) {
  const aKeys = new Set(a.map(hourlyDiffKey));
  const bKeys = new Set(b.map(hourlyDiffKey));
  return {
    /** In b but not in a. */
    new: b.filter((r) => !aKeys.has(hourlyDiffKey(r))),
    /** In a but gone from b. */
    disappeared: a.filter((r) => !bKeys.has(hourlyDiffKey(r))),
  };
}

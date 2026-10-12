// Alarm types hidden from display (admin setting). Combined with the office scope, this is the
// single filter every page, stat, export and notification uses — hidden alarms stay stored.
import type { Category } from "@alarm/core";
import type { Prisma } from "@alarm/db";
import { prisma } from "./db";
import { getOffice } from "./office";

export interface DisplayFilter {
  hiddenCategories: Category[];
  hiddenAlarmNames: string[];
}

const CATS = new Set(["DOWN", "POWER", "OTHER"]);

export function normalizeDisplayFilter(raw: unknown): DisplayFilter {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()))]
      : [];
  return {
    hiddenCategories: list(r.hiddenCategories).filter((c): c is Category => CATS.has(c)),
    hiddenAlarmNames: list(r.hiddenAlarmNames).slice(0, 1000),
  };
}

export async function getDisplayFilter(): Promise<DisplayFilter> {
  const s = await prisma.systemStatus.findUnique({
    where: { id: 1 },
    select: { displayFilter: true },
  });
  return normalizeDisplayFilter(s?.displayFilter);
}

/** Types the given user hides from their own pages (empty when none / no user). */
export async function getUserDisplayFilter(userId?: number): Promise<DisplayFilter> {
  if (!userId) return { hiddenCategories: [], hiddenAlarmNames: [] };
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { displayPrefs: true } });
  return normalizeDisplayFilter(u?.displayPrefs);
}

/** Admin (everyone) + personal (this user) hidden types, merged. */
export async function effectiveDisplayFilter(userId?: number): Promise<DisplayFilter> {
  const [admin, mine] = await Promise.all([getDisplayFilter(), getUserDisplayFilter(userId)]);
  return {
    hiddenCategories: [...new Set([...admin.hiddenCategories, ...mine.hiddenCategories])],
    hiddenAlarmNames: [...new Set([...admin.hiddenAlarmNames, ...mine.hiddenAlarmNames])],
  };
}

/** Prisma condition: current office AND not hidden (by the admin or by this user).
 *  Combine with other conditions via AND. */
export async function alarmScope(userId?: number): Promise<Prisma.AlarmWhereInput> {
  const [office, f] = await Promise.all([getOffice(), effectiveDisplayFilter(userId)]);
  const and: Prisma.AlarmWhereInput[] = [];
  if (office) and.push({ office });
  if (f.hiddenCategories.length) and.push({ category: { notIn: f.hiddenCategories } });
  if (f.hiddenAlarmNames.length) and.push({ alarmName: { notIn: f.hiddenAlarmNames } });
  return { AND: and };
}

/** Same scope as raw-SQL fragments for $queryRaw (alarms table). */
export async function alarmScopeSql(userId?: number) {
  const [office, f] = await Promise.all([getOffice(), effectiveDisplayFilter(userId)]);
  return { office, hiddenCategories: f.hiddenCategories, hiddenAlarmNames: f.hiddenAlarmNames };
}

export function hiddenCount(f: DisplayFilter): number {
  return f.hiddenCategories.length + f.hiddenAlarmNames.length;
}

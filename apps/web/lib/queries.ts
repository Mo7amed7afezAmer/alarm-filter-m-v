// Alarm list queries shared by /api/alarms/* and /api/export.
import type { Prisma } from "@alarm/db";
import { z } from "zod";
import { category, dateParam, pagination } from "./api";
import { prisma } from "./db";

export const activeQuery = z.object({
  category: category.optional(),
  site: z.string().trim().min(1).max(200).optional(),
  region: z.string().trim().min(1).max(100).optional(),
  minHours: z.coerce
    .number()
    .min(0)
    .max(24 * 365)
    .optional(),
  ...pagination,
});

export const clearedQuery = z.object({
  from: dateParam.optional(),
  to: dateParam.optional(),
  category: category.optional(),
  site: z.string().trim().min(1).max(200).optional(),
  region: z.string().trim().min(1).max(100).optional(),
  ...pagination,
});

async function sitesInRegion(region: string): Promise<string[]> {
  const rows = await prisma.site.findMany({
    where: { region: { equals: region, mode: "insensitive" } },
    select: { site: true },
  });
  return rows.map((r) => r.site);
}

export async function activeWhere(q: z.infer<typeof activeQuery>, now = new Date()) {
  const where: Prisma.AlarmWhereInput = { status: "ACTIVE" };
  if (q.category) where.category = q.category;
  if (q.site) where.site = { contains: q.site, mode: "insensitive" };
  if (q.region) where.AND = [{ site: { in: await sitesInRegion(q.region) } }];
  if (q.minHours !== undefined)
    where.alarmTime = { lte: new Date(now.getTime() - q.minHours * 3_600_000) };
  return where;
}

/** Default window: last 24h by clearTime. */
export async function clearedWhere(q: z.infer<typeof clearedQuery>, now = new Date()) {
  const from = q.from ?? new Date(now.getTime() - 24 * 3_600_000);
  const to = q.to ?? now;
  const where: Prisma.AlarmWhereInput = { status: "CLEARED", clearTime: { gte: from, lte: to } };
  if (q.category) where.category = q.category;
  if (q.site) where.site = { contains: q.site, mode: "insensitive" };
  if (q.region) where.AND = [{ site: { in: await sitesInRegion(q.region) } }];
  return { where, from, to };
}

export const alarmSelect = {
  id: true,
  alarmName: true,
  site: true,
  category: true,
  alarmTime: true,
  status: true,
  clearTime: true,
  durationMin: true,
  clearType: true,
} as const;

/** Adds `region` / `owner` from the sites table. */
export async function withSiteInfo<T extends { site: string }>(rows: T[]) {
  const sites = await prisma.site.findMany({
    where: { site: { in: [...new Set(rows.map((r) => r.site))] } },
  });
  const bySite = new Map(sites.map((s) => [s.site, s]));
  return rows.map((r) => ({
    ...r,
    region: bySite.get(r.site)?.region ?? null,
    owner: bySite.get(r.site)?.owner ?? null,
  }));
}

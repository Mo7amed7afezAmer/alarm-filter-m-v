import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { officeFilter } from "@/lib/office";
import { alarmScope } from "@/lib/visibility";

export const dynamic = "force-dynamic";

const CATEGORIES = ["DOWN", "POWER", "OTHER"] as const;

const query = z.object({
  /** MTTR window in days. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const GET = handler(async (req: Request) => {
  await requireUser();
  const { days } = parseQuery(req, query);
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const day = new Date(now.getTime() - 86_400_000);
  const alertHours = Number(process.env.ALERT_HOURS) || 4;
  const office = await officeFilter(); // orphan/raw counts (not alarm types)
  const scope = await alarmScope(); // alarms: office + hidden types

  const [active, mttr, overdue, status, orphans24h, parseErrors24h, cleared24h] = await Promise.all(
    [
      prisma.alarm.groupBy({
        by: ["category"],
        where: { AND: [scope, { status: "ACTIVE" }] },
        _count: { _all: true },
      }),
      // MTTR: EMAIL clears only — AUTO_SUPERSEDED is not a repair.
      prisma.alarm.groupBy({
        by: ["category"],
        where: {
          AND: [scope, { status: "CLEARED", clearType: "EMAIL", clearTime: { gte: since } }],
        },
        _avg: { durationMin: true },
        _count: { _all: true },
      }),
      prisma.alarm.count({
        where: {
          AND: [
            scope,
            {
              status: "ACTIVE",
              alarmTime: { lte: new Date(now.getTime() - alertHours * 3_600_000) },
            },
          ],
        },
      }),
      prisma.systemStatus.findUnique({ where: { id: 1 } }),
      prisma.orphanClear.count({ where: { clearTime: { gte: day }, ...office } }),
      prisma.rawMessage.count({
        where: { receivedAt: { gte: day }, parseError: { not: null }, ...office },
      }),
      prisma.alarm.count({
        where: { AND: [scope, { status: "CLEARED", clearTime: { gte: day } }] },
      }),
    ],
  );

  const activeBy = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<string, number>;
  for (const r of active) activeBy[r.category] = r._count._all;

  const mttrBy = Object.fromEntries(
    CATEGORIES.map((c) => {
      const r = mttr.find((m) => m.category === c);
      return [
        c,
        {
          avgMin: r?._avg.durationMin != null ? Math.round(r._avg.durationMin) : null,
          count: r?._count._all ?? 0,
        },
      ];
    }),
  );

  const lastRunAt = status?.lastRunAt ?? null;
  return NextResponse.json({
    active: { ...activeBy, total: Object.values(activeBy).reduce((a, b) => a + b, 0) },
    overdue: { count: overdue, alertHours },
    mttr: { days, byCategory: mttrBy },
    last24h: { cleared: cleared24h, orphanClears: orphans24h, parseErrors: parseErrors24h },
    office: office.office ?? null,
    lastRun: {
      at: lastRunAt,
      ageSec: lastRunAt ? Math.round((now.getTime() - lastRunAt.getTime()) / 1000) : null,
      messages: status?.lastRunMessages ?? 0,
      error: status?.lastError ?? null,
      reprocessPending: status?.reprocessDays ?? null,
    },
  });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** Sites with the most alarms raised in the last `days`, with their current active count. */
export const GET = handler(async (req: Request) => {
  await requireUser();
  const { limit, days } = parseQuery(req, query);
  const since = new Date(Date.now() - days * 86_400_000);

  const top = await prisma.alarm.groupBy({
    by: ["site"],
    where: { alarmTime: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { site: "desc" } },
    take: limit,
  });
  const sites = top.map((t) => t.site);
  const [active, info] = await Promise.all([
    prisma.alarm.groupBy({
      by: ["site"],
      where: { status: "ACTIVE", site: { in: sites } },
      _count: { _all: true },
    }),
    prisma.site.findMany({ where: { site: { in: sites } } }),
  ]);
  const activeBy = new Map(active.map((a) => [a.site, a._count._all]));
  const infoBy = new Map(info.map((s) => [s.site, s]));

  return NextResponse.json({
    days,
    items: top.map((t) => ({
      site: t.site,
      total: t._count._all,
      active: activeBy.get(t.site) ?? 0,
      region: infoBy.get(t.site)?.region ?? null,
    })),
  });
});

import { NextResponse } from "next/server";
import { handler, paged, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { activeQuery, activeWhere, alarmSelect, withSiteInfo } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const q = parseQuery(req, activeQuery);
  const where = await activeWhere(q, Number(session.user.id));
  const [total, rows] = await Promise.all([
    prisma.alarm.count({ where }),
    prisma.alarm.findMany({
      where,
      select: alarmSelect,
      orderBy: [{ alarmTime: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return NextResponse.json(paged(await withSiteInfo(rows), total, q.page, q.pageSize));
});

import { NextResponse } from "next/server";
import { handler, paged, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { alarmSelect, clearedQuery, clearedWhere, withSiteInfo } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const q = parseQuery(req, clearedQuery);
  const { where, from, to } = await clearedWhere(q, Number(session.user.id));
  const [total, rows] = await Promise.all([
    prisma.alarm.count({ where }),
    prisma.alarm.findMany({
      where,
      select: alarmSelect,
      orderBy: [{ clearTime: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return NextResponse.json({
    ...paged(await withSiteInfo(rows), total, q.page, q.pageSize),
    from,
    to,
  });
});

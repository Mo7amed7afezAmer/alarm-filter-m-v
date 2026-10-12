import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { officeFilter } from "@/lib/office";
import { getDisplayFilter } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** Distinct alarm names seen in the current office (last 30 days), most frequent first.
 *  Hidden types are left out unless `?all=1` (the admin display settings need them). */
export const GET = handler(async (req: Request) => {
  await requireUser();
  const all = new URL(req.url).searchParams.get("all") === "1";
  const [rows, hidden] = await Promise.all([
    prisma.alarm.groupBy({
      by: ["alarmName", "category"],
      where: {
        alarmTime: { gte: new Date(Date.now() - 30 * 86_400_000) },
        ...(await officeFilter()),
      },
      _count: { _all: true },
      orderBy: { _count: { alarmName: "desc" } },
      take: 300,
    }),
    getDisplayFilter(),
  ]);
  const names = rows
    .map((r) => ({
      name: r.alarmName,
      category: r.category,
      count: r._count._all,
      hidden:
        hidden.hiddenCategories.includes(r.category) ||
        hidden.hiddenAlarmNames.includes(r.alarmName),
    }))
    .filter((n) => all || !n.hidden);
  return NextResponse.json({ names });
});

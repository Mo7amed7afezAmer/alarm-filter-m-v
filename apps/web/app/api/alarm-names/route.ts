import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { officeFilter } from "@/lib/office";
import { getDisplayFilter, getUserDisplayFilter } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** Distinct alarm names seen in the current office (last 30 days), most frequent first.
 *  Hidden types (by the admin or by this user) are left out unless `?all=1` — the hide/show
 *  editors need the full list, each row flagged `hiddenByAdmin` / `hiddenByMe`. */
export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const all = new URL(req.url).searchParams.get("all") === "1";
  const [rows, admin, mine] = await Promise.all([
    prisma.alarm.groupBy({
      by: ["alarmName", "category"],
      where: {
        alarmTime: { gte: new Date(Date.now() - 30 * 86_400_000) },
        ...(await officeFilter(Number(session.user.id))),
      },
      _count: { _all: true },
      orderBy: { _count: { alarmName: "desc" } },
      take: 300,
    }),
    getDisplayFilter(),
    getUserDisplayFilter(Number(session.user.id)),
  ]);
  const names = rows
    .map((r) => {
      const hiddenByAdmin =
        admin.hiddenCategories.includes(r.category) || admin.hiddenAlarmNames.includes(r.alarmName);
      const hiddenByMe =
        mine.hiddenCategories.includes(r.category) || mine.hiddenAlarmNames.includes(r.alarmName);
      return {
        name: r.alarmName,
        category: r.category,
        count: r._count._all,
        hidden: hiddenByAdmin || hiddenByMe,
        hiddenByAdmin,
        hiddenByMe,
      };
    })
    .filter((n) => all || !n.hidden);
  return NextResponse.json({ names });
});

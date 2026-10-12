import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { officeFilter } from "@/lib/office";

export const dynamic = "force-dynamic";

/** Distinct alarm names seen in the current office (last 30 days), most frequent first. */
export const GET = handler(async () => {
  await requireUser();
  const rows = await prisma.alarm.groupBy({
    by: ["alarmName", "category"],
    where: {
      alarmTime: { gte: new Date(Date.now() - 30 * 86_400_000) },
      ...(await officeFilter()),
    },
    _count: { _all: true },
    orderBy: { _count: { alarmName: "desc" } },
    take: 300,
  });
  return NextResponse.json({
    names: rows.map((r) => ({ name: r.alarmName, category: r.category, count: r._count._all })),
  });
});

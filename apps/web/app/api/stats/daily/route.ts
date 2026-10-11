import { NextResponse } from "next/server";
import { z } from "zod";
import { ALARM_TZ, handler, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** YYYY-MM-DD of `d` in the alarm timezone. */
function localDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ALARM_TZ }).format(d);
}

/** Alarms raised per local day and category (by alarmTime). */
export const GET = handler(async (req: Request) => {
  await requireUser();
  const { days } = parseQuery(req, query);
  const now = new Date();
  const dayList = Array.from({ length: days }, (_, i) =>
    localDay(new Date(now.getTime() - (days - 1 - i) * 86_400_000)),
  );
  const since = new Date(now.getTime() - (days + 1) * 86_400_000); // over-fetch, trimmed below

  // alarmTime is stored as UTC timestamp without zone.
  const rows = await prisma.$queryRaw<{ day: string; category: string; count: number }[]>`
    SELECT to_char(("alarmTime" AT TIME ZONE 'UTC') AT TIME ZONE ${ALARM_TZ}, 'YYYY-MM-DD') AS day,
           category::text AS category,
           count(*)::int AS count
    FROM alarms
    WHERE "alarmTime" >= ${since}
    GROUP BY 1, 2`;

  const byDay = new Map(dayList.map((d) => [d, { day: d, DOWN: 0, POWER: 0, OTHER: 0 }]));
  for (const r of rows) {
    const bucket = byDay.get(r.day);
    if (bucket && (r.category === "DOWN" || r.category === "POWER" || r.category === "OTHER")) {
      bucket[r.category] = r.count;
    }
  }
  return NextResponse.json({ days, timeZone: ALARM_TZ, series: [...byDay.values()] });
});

import ExcelJS from "exceljs";
import { z } from "zod";
import { ALARM_TZ, handler, HttpError, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  activeQuery,
  activeWhere,
  alarmSelect,
  clearedQuery,
  clearedWhere,
  withSiteInfo,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const MAX_ROWS = 50_000;

/** Wall-clock string in ALARM_TZ so Excel shows local times (Excel has no timezones). */
function local(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: ALARM_TZ,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(d);
}

export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const status = new URL(req.url).searchParams.get("status");
  if (status !== "active" && status !== "cleared")
    throw new HttpError(400, "status must be active or cleared");

  const where =
    status === "active"
      ? await activeWhere(
          parseQuery(req, activeQuery.extend({ status: z.string() })),
          Number(session.user.id),
        )
      : (
          await clearedWhere(
            parseQuery(req, clearedQuery.extend({ status: z.string() })),
            Number(session.user.id),
          )
        ).where;

  const count = await prisma.alarm.count({ where });
  if (count > MAX_ROWS)
    throw new HttpError(413, `Too many rows (${count}); narrow the filters (max ${MAX_ROWS})`);

  const rows = await withSiteInfo(
    await prisma.alarm.findMany({
      where,
      select: alarmSelect,
      orderBy: status === "active" ? { alarmTime: "desc" } : { clearTime: "desc" },
    }),
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(status === "active" ? "Active alarms" : "Cleared alarms");
  ws.columns = [
    { header: "Alarm", key: "alarmName", width: 42 },
    { header: "Site", key: "site", width: 36 },
    { header: "Cell", key: "cellName", width: 26 },
    { header: "Device", key: "device", width: 10 },
    { header: "CONSEC_NBR", key: "consecNbr", width: 12 },
    { header: "Region", key: "region", width: 14 },
    { header: "Category", key: "category", width: 10 },
    { header: `Alarm time (${ALARM_TZ})`, key: "alarmTime", width: 22 },
    ...(status === "cleared"
      ? [
          { header: `Clear time (${ALARM_TZ})`, key: "clearTime", width: 22 },
          { header: "Duration (min)", key: "durationMin", width: 14 },
          { header: "Clear type", key: "clearType", width: 18 },
        ]
      : [{ header: "Age (hours)", key: "ageHours", width: 12 }]),
  ];
  const now = Date.now();
  for (const r of rows) {
    ws.addRow({
      ...r,
      alarmTime: local(r.alarmTime),
      clearTime: local(r.clearTime),
      ageHours: Math.round(((now - r.alarmTime.getTime()) / 3_600_000) * 10) / 10,
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="alarms-${status}-${stamp}.xlsx"`,
    },
  });
});

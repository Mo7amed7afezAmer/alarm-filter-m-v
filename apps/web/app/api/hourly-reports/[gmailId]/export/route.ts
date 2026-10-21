// GET /api/hourly-reports/{gmailId}/export?<same filters>&sort&columns=a,b,c → .xlsx of the
// visible table: chosen columns in order, office row colors, frozen header, autofilter.
import { filterHourlyRows, parseHourlySort, sortHourlyRows } from "@alarm/core";
import { buildHourlyXlsx } from "@alarm/core/hourly";
import { handler, requireUser } from "@/lib/api";
import { hourlySource } from "@/lib/gmail";
import { checkGmailId, getReport, parseColumns, parseFilters, scopeRows } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, ctx: { params: { gmailId: string } }) => {
  const session = await requireUser();
  const id = checkGmailId(ctx.params.gmailId);
  const sp = new URL(req.url).searchParams;
  const filters = parseFilters(sp);
  const columns = parseColumns(sp);
  const sort = parseHourlySort(sp.get("sort"));

  const report = await getReport(id, session.user.role);
  const visible = await scopeRows(report.rows, Number(session.user.id));
  const rows = sortHourlyRows(filterHourlyRows(visible, filters), sort);
  const buf = await buildHourlyXlsx(rows, columns);

  const info = await hourlySource()
    .get(id)
    .catch(() => null);
  const stamp = (info?.receivedAt ?? new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="hourly-alarms-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
});

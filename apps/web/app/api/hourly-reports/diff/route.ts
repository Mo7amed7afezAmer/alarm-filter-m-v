// GET /api/hourly-reports/diff?a=<older>&b=<newer>[&<filters>] → rows new in b / gone from a,
// keyed on site code + alarm + DN.
import { diffHourly, filterHourlyRows, parseHourlySort, sortHourlyRows } from "@alarm/core";
import { NextResponse } from "next/server";
import { handler, HttpError, requireUser } from "@/lib/api";
import { checkGmailId, getReport, parseFilters } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const sp = new URL(req.url).searchParams;
  const a = sp.get("a");
  const b = sp.get("b");
  if (!a || !b) throw new HttpError(400, "Invalid query", { a: ["required"], b: ["required"] });
  if (a === b) throw new HttpError(400, "Pick two different reports");
  const filters = parseFilters(sp);
  const sort = parseHourlySort(sp.get("sort"));

  const [ra, rb] = await Promise.all([
    getReport(checkGmailId(a), session.user.role),
    getReport(checkGmailId(b), session.user.role),
  ]);
  const d = diffHourly(filterHourlyRows(ra.rows, filters), filterHourlyRows(rb.rows, filters));
  return NextResponse.json({
    data: { new: sortHourlyRows(d.new, sort), disappeared: sortHourlyRows(d.disappeared, sort) },
    meta: { a: ra.meta, b: rb.meta, new: d.new.length, disappeared: d.disappeared.length },
  });
});

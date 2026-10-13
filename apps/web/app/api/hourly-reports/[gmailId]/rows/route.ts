// GET /api/hourly-reports/{gmailId}/rows?sheet&region&office&alarm&siteType&category&vip&
//     from&to&q&sort&page&limit(≤500)[&facets=1]
// Served from the cache; re-processed transparently when cold (§14).
import { filterHourlyRows, hourlyFacets, parseHourlySort, sortHourlyRows } from "@alarm/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, requireUser } from "@/lib/api";
import { checkGmailId, getReport, parseFilters } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const GET = handler(async (req: Request, ctx: { params: { gmailId: string } }) => {
  const session = await requireUser();
  const id = checkGmailId(ctx.params.gmailId);
  const sp = new URL(req.url).searchParams;
  const p = paging.safeParse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  if (!p.success) throw new HttpError(400, "Invalid query", p.error.flatten().fieldErrors);
  const filters = parseFilters(sp);
  const sort = parseHourlySort(sp.get("sort"));

  const report = await getReport(id, session.user.role);
  const rows = sortHourlyRows(filterHourlyRows(report.rows, filters), sort);
  const { page, limit } = p.data;
  return NextResponse.json({
    data: rows.slice((page - 1) * limit, page * limit),
    meta: {
      total: rows.length,
      page,
      limit,
      pages: Math.max(1, Math.ceil(rows.length / limit)),
      report: report.meta,
      ...(sp.get("facets") === "1" ? { facets: hourlyFacets(report.rows) } : {}),
    },
  });
});

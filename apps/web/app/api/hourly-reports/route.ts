// GET /api/hourly-reports?from&to&page — "Hourly Update" mails from Gmail (no download),
// each with its processing status from the in-process cache.
import { NextResponse } from "next/server";
import { z } from "zod";
import { dateParam, handler, parseQuery, requireUser } from "@/lib/api";
import { hourlySource } from "@/lib/gmail";
import { hourlyCache } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const DAY = 86_400_000;

const query = z.object({
  from: dateParam.optional(),
  /** A date-only `to` includes that whole day. */
  to: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")
    .transform((s) => new Date(Date.parse(s) + (/^\d{4}-\d{2}-\d{2}$/.test(s) ? DAY : 0)))
    .optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
});

export const GET = handler(async (req: Request) => {
  await requireUser();
  const { from, to, page } = parseQuery(req, query);
  const { reports, hasMore } = await hourlySource().list({ from, to, page, pageSize: PAGE_SIZE });
  return NextResponse.json({
    data: reports.map((r) => ({ ...r, ...hourlyCache.status(r.gmailId) })),
    meta: { page, pageSize: PAGE_SIZE, hasMore, cached: hourlyCache.size },
  });
});

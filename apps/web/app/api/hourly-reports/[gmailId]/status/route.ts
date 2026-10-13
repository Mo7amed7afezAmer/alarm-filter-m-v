// GET /api/hourly-reports/{gmailId}/status → pending | processing | done (+meta) | failed (+error)
import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { checkGmailId, hourlyCache } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: { params: { gmailId: string } }) => {
  await requireUser();
  return NextResponse.json({ data: hourlyCache.status(checkGmailId(ctx.params.gmailId)) });
});

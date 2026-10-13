// POST /api/hourly-reports/{gmailId}/process[?force=true] — operator.
// 202 {status:"processing"} and the work continues in the background; poll .../status.
// Already processed (and cached) → 200 {status:"done"} unless force.
import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { checkGmailId, hourlyCache, startProcessing } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request, ctx: { params: { gmailId: string } }) => {
  await requireUser("OPERATOR");
  const id = checkGmailId(ctx.params.gmailId);
  const force = new URL(req.url).searchParams.get("force") === "true";
  const current = hourlyCache.status(id);
  if (current.status === "done" && !force) return NextResponse.json({ data: current });
  startProcessing(id, force);
  return NextResponse.json({ data: { status: "processing" } }, { status: 202 });
});

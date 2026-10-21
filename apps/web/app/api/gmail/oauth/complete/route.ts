// POST /api/gmail/oauth/complete (super admin) {url} — finish the flow from the address Google
// redirected to (used when the app is opened over the LAN, not on the host).
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseBody, requireUser } from "@/lib/api";
import { FLOW_COOKIE, finishFlow, parseReturnedUrl, readFlow } from "@/lib/gmailConnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const session = await requireUser("SUPER_ADMIN");
  const { url } = await parseBody(req, z.object({ url: z.string().trim().min(10).max(4000) }));
  const flow = readFlow(cookies().get(FLOW_COOKIE)?.value);
  const result = await finishFlow(flow, parseReturnedUrl(url), session.user.email ?? "");
  const res = NextResponse.json({ data: result });
  res.cookies.delete({ name: FLOW_COOKIE, path: "/api/gmail/oauth" });
  return res;
});

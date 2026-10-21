// GET /api/gmail/oauth/callback — Google redirects here when the page is opened on the host
// (loopback). Finishes the flow and returns to /settings/gmail with the result.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/api";
import { FLOW_COOKIE, finishFlow, parseReturnedUrl, readFlow } from "@/lib/gmailConnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const back = new URL("/settings/gmail", req.url);
  try {
    const session = await requireUser("SUPER_ADMIN");
    const flow = readFlow(cookies().get(FLOW_COOKIE)?.value);
    const { email } = await finishFlow(flow, parseReturnedUrl(req.url), session.user.email ?? "");
    back.searchParams.set("connected", email);
  } catch (err) {
    back.searchParams.set(
      "error",
      err instanceof HttpError ? err.message : "Could not finish the Gmail sign-in",
    );
    if (!(err instanceof HttpError)) console.error("gmail oauth callback:", err);
  }
  const res = NextResponse.redirect(back);
  res.cookies.delete({ name: FLOW_COOKIE, path: "/api/gmail/oauth" });
  return res;
}

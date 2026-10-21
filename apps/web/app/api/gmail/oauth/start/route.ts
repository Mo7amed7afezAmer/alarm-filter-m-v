// POST /api/gmail/oauth/start (super admin) {loginHint?} → { authUrl, redirectUri, loopback }.
// The PKCE verifier + state live in an httpOnly cookie for 10 minutes.
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseBody, requireUser } from "@/lib/api";
import { cookieOptions, FLOW_COOKIE, startFlow } from "@/lib/gmailConnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ loginHint: z.string().trim().email().max(200).optional().or(z.literal("")) });

export const POST = handler(async (req: Request) => {
  await requireUser("SUPER_ADMIN");
  const { loginHint } = await parseBody(req, body);
  const { authUrl, redirectUri, loopback, flow } = await startFlow(req.url, loginHint || undefined);
  const res = NextResponse.json({ data: { authUrl, redirectUri, loopback } });
  res.cookies.set(FLOW_COOKIE, JSON.stringify(flow), cookieOptions);
  return res;
});

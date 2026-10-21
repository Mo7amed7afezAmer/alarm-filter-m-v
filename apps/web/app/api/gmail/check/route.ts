// POST /api/gmail/check (super admin) — test the connection with users.getProfile.
import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { checkConnection } from "@/lib/gmailConnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async () => {
  await requireUser("SUPER_ADMIN");
  return NextResponse.json({ data: await checkConnection() });
});

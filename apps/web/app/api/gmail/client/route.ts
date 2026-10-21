// POST /api/gmail/client (super admin) — upload the Google "Desktop app" client (credentials.json
// content as JSON). DELETE — go back to credentials.json on disk.
import { NextResponse } from "next/server";
import { handler, HttpError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { saveClient } from "@/lib/gmailConnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20_000;

export const POST = handler(async (req: Request) => {
  await requireUser("SUPER_ADMIN");
  const text = await req.text();
  if (text.length > MAX_BYTES) throw new HttpError(413, "File too large for a credentials.json");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Not a JSON file");
  }
  return NextResponse.json({ data: await saveClient(json) });
});

export const DELETE = handler(async () => {
  await requireUser("SUPER_ADMIN");
  await prisma.gmailAccount.updateMany({
    where: { id: 1 },
    data: { clientId: null, clientSecret: null },
  });
  return NextResponse.json({ data: { removed: true } });
});

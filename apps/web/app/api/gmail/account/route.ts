// GET /api/gmail/account (super admin) — connection status; never returns the token or the secret.
// DELETE (super admin) — forget the UI-connected token (the worker falls back to token.json if any).
import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { gmailFiles } from "@/lib/gmail";
import { maskClientId, redirectFor } from "@/lib/gmailConnect";
import { loadGmailClient } from "@alarm/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  await requireUser("SUPER_ADMIN");
  const files = gmailFiles();
  const [row, status, client] = await Promise.all([
    prisma.gmailAccount.findUnique({ where: { id: 1 } }),
    prisma.systemStatus.findUnique({ where: { id: 1 } }),
    loadGmailClient(prisma, files.credentialsPath).catch(() => null),
  ]);
  const tokenFile = !!files.tokenPath && existsSync(files.tokenPath);
  return NextResponse.json({
    data: {
      client: client
        ? { source: client.source, clientId: maskClientId(client.clientId) }
        : { source: "none" as const, clientId: null },
      token: row?.refreshToken
        ? {
            source: "db" as const,
            email: row.email,
            scope: row.scope,
            connectedAt: row.connectedAt,
            connectedBy: row.connectedBy,
          }
        : { source: tokenFile ? ("file" as const) : ("none" as const), email: null, scope: null, connectedAt: null, connectedBy: null },
      lastCheck: row?.lastCheckAt
        ? { at: row.lastCheckAt, ok: row.lastCheckOk, message: row.lastCheckMsg }
        : null,
      worker: { lastRunAt: status?.lastRunAt ?? null, lastError: status?.lastError ?? null },
      redirect: redirectFor(req.url),
    },
  });
});

export const DELETE = handler(async () => {
  await requireUser("SUPER_ADMIN");
  await prisma.gmailAccount.updateMany({
    where: { id: 1 },
    data: { refreshToken: null, email: null, scope: null, connectedAt: null, connectedBy: null },
  });
  return NextResponse.json({ data: { disconnected: true } });
});

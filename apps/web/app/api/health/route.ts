// Public. 200 when the DB answers (used by the Docker healthcheck); worker staleness is
// reported in the body but does not fail the web container.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const WORKER_STALE_SEC = 300;

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
  const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
  const ageSec = s?.lastRunAt ? Math.round((Date.now() - s.lastRunAt.getTime()) / 1000) : null;
  const workerOk = ageSec !== null && ageSec <= WORKER_STALE_SEC && !s?.lastError;
  return NextResponse.json({
    ok: true,
    db: "ok",
    worker: {
      ok: workerOk,
      lastRunAt: s?.lastRunAt ?? null,
      lastRunAgeSec: ageSec,
      lastError: s?.lastError ?? null,
    },
  });
}

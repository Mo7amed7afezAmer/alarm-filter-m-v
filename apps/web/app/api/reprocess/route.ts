import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

/** Queues a rebuild; the worker runs it on its next tick and clears reprocessDays. */
export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const { days } = parseQuery(req, query);
  await prisma.systemStatus.upsert({
    where: { id: 1 },
    update: { reprocessDays: days },
    create: { id: 1, reprocessDays: days },
  });
  return NextResponse.json({ queued: true, days }, { status: 202 });
});

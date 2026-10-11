import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { availableOffices } from "@/lib/office";

export const dynamic = "force-dynamic";

/** Current office, the offices to choose from, and whether the worker has finished syncing it. */
export const GET = handler(async () => {
  await requireUser();
  const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
  return NextResponse.json({
    office: s?.officeLabel ?? null,
    syncedOffice: s?.syncedLabel ?? null,
    offices: await availableOffices(),
  });
});

/** Switch office (admin). The worker notices on its next run and backfills the new label. */
export const PUT = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const { office } = await parseBody(req, z.object({ office: z.string().trim().min(1).max(200) }));
  const offices = await availableOffices();
  if (offices.length && !offices.includes(office)) {
    throw new HttpError(400, `Unknown office label "${office}"`);
  }
  await prisma.systemStatus.upsert({
    where: { id: 1 },
    update: { officeLabel: office },
    create: { id: 1, officeLabel: office },
  });
  return NextResponse.json({ office });
});

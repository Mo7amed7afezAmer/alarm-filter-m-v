import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { availableOffices, getOffice } from "@/lib/office";

export const dynamic = "force-dynamic";

/** Office the user is looking at (null = all offices), the offices to choose from, and the
 *  worker's sync state (it reads the whole mailbox; "*" once the backfill is done). */
export const GET = handler(async () => {
  const session = await requireUser();
  const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
  return NextResponse.json({
    office: await getOffice(Number(session.user.id)),
    synced: s?.syncedLabel === "*",
    offices: await availableOffices(),
  });
});

/** Super admin: switch the office being viewed (their account only); null/"" = all offices.
 *  Office users are fixed to their own office. */
export const PUT = handler(async (req: Request) => {
  const session = await requireUser("SUPER_ADMIN");
  const { office } = await parseBody(
    req,
    z.object({ office: z.string().trim().max(200).nullable() }),
  );
  const offices = await availableOffices();
  if (office && offices.length && !offices.includes(office)) {
    throw new HttpError(400, `Unknown office label "${office}"`);
  }
  await prisma.user.update({
    where: { id: Number(session.user.id) },
    data: { office: office || null },
  });
  return NextResponse.json({ office: office || null });
});

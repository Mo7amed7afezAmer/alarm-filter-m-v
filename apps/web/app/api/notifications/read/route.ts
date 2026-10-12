import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Mark everything up to now as read. */
export const POST = handler(async () => {
  const session = await requireUser();
  const seenAt = new Date();
  await prisma.user.update({
    where: { id: Number(session.user.id) },
    data: { notificationsSeenAt: seenAt },
  });
  return NextResponse.json({ seenAt });
});

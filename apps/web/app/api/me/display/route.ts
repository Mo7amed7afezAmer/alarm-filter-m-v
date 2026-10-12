import type { Prisma } from "@alarm/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { category, handler, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getDisplayFilter, getUserDisplayFilter, normalizeDisplayFilter } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** The signed-in user's personal hidden types, plus what the admin hides for everyone. */
export const GET = handler(async () => {
  const session = await requireUser();
  const [mine, admin] = await Promise.all([
    getUserDisplayFilter(Number(session.user.id)),
    getDisplayFilter(),
  ]);
  return NextResponse.json({ ...mine, admin });
});

/** Replace the user's own hidden types (any role). Affects only this user's pages. */
export const PUT = handler(async (req: Request) => {
  const session = await requireUser();
  const body = await parseBody(
    req,
    z.object({
      hiddenCategories: z.array(category).max(3),
      hiddenAlarmNames: z.array(z.string().trim().min(1).max(200)).max(1000),
    }),
  );
  const filter = normalizeDisplayFilter(body);
  await prisma.user.update({
    where: { id: Number(session.user.id) },
    data: { displayPrefs: filter as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json(filter);
});

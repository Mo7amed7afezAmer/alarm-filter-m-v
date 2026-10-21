import type { Prisma } from "@alarm/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { category, handler, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getDisplayFilter, normalizeDisplayFilter } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** Alarm types hidden from display (any signed-in user may read it). */
export const GET = handler(async () => {
  await requireUser();
  return NextResponse.json(await getDisplayFilter());
});

/** Replace the hidden lists (super admin). Hidden alarms are still stored and matched. */
export const PUT = handler(async (req: Request) => {
  await requireUser("SUPER_ADMIN");
  const body = await parseBody(
    req,
    z.object({
      hiddenCategories: z.array(category).max(3),
      hiddenAlarmNames: z.array(z.string().trim().min(1).max(200)).max(1000),
    }),
  );
  const filter = normalizeDisplayFilter(body);
  await prisma.systemStatus.upsert({
    where: { id: 1 },
    update: { displayFilter: filter as unknown as Prisma.InputJsonValue },
    create: { id: 1, displayFilter: filter as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json(filter);
});

import { normalizePrefs } from "@alarm/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { category, handler, parseBody, requireUser } from "@/lib/api";
import type { Prisma } from "@alarm/db";
import { prisma } from "@/lib/db";
import { loadUserPrefs } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const body = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  categories: z.array(category).max(3),
  alarmNames: z.array(z.string().trim().min(1).max(200)).max(500),
  sites: z.array(z.string().trim().min(1).max(200)).max(100),
});

/** Every user (viewer or admin) manages their own preferences. */
export const GET = handler(async () => {
  const session = await requireUser();
  const { prefs } = await loadUserPrefs(Number(session.user.id));
  return NextResponse.json({ prefs });
});

export const PUT = handler(async (req: Request) => {
  const session = await requireUser();
  const prefs = normalizePrefs(await parseBody(req, body));
  await prisma.user.update({
    where: { id: Number(session.user.id) },
    // NotifyPrefs is plain JSON (booleans + string arrays).
    data: { notifyPrefs: prefs as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ prefs });
});

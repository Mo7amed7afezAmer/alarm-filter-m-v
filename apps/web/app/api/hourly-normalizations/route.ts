// GET|PUT /api/hourly-normalizations (admin) — value fixes applied to hourly reports (§14).
// PUT replaces the whole list and clears the hourly cache.
import { NORMALIZED_FIELDS } from "@alarm/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hourlyCache } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rule = z.object({
  field: z.enum(["*", ...NORMALIZED_FIELDS]),
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().max(200),
});

export const GET = handler(async () => {
  await requireUser("ADMIN");
  const data = await prisma.hourlyNormalization.findMany({ orderBy: [{ field: "asc" }, { from: "asc" }] });
  return NextResponse.json({ data, meta: { fields: ["*", ...NORMALIZED_FIELDS] } });
});

export const PUT = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const rules = await parseBody(req, z.array(rule).max(500));
  // (field, from) is unique — keep the last occurrence
  const unique = [...new Map(rules.map((r) => [`${r.field}\u0000${r.from.toUpperCase()}`, r])).values()];
  await prisma.$transaction([
    prisma.hourlyNormalization.deleteMany(),
    prisma.hourlyNormalization.createMany({ data: unique }),
  ]);
  hourlyCache.clear();
  const data = await prisma.hourlyNormalization.findMany({ orderBy: [{ field: "asc" }, { from: "asc" }] });
  return NextResponse.json({ data });
});

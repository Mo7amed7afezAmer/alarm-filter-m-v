// PUT /api/site-master/{code} (admin) — inline edit of one site.
import { baseNormalize } from "@alarm/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hourlyCache } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = z
  .string()
  .trim()
  .max(200)
  .transform((s) => s || null)
  .nullable();

const body = z
  .object({
    siteName: text,
    office: z.string().trim().min(1, "office is required").max(100).transform(baseNormalize),
    nodality: text,
    vip: z.boolean(),
    siteType: text,
    powerSource: text,
    battery: text,
    notes: z.string().trim().max(1000).transform((s) => s || null).nullable(),
  })
  .partial()
  .strict();

export const PUT = handler(async (req: Request, ctx: { params: { code: string } }) => {
  await requireUser("ADMIN");
  const code = ctx.params.code.trim().toUpperCase();
  const data = await parseBody(req, body);
  if (!(await prisma.siteMaster.findUnique({ where: { code } })))
    throw new HttpError(404, `Site ${code} not found`);
  const site = await prisma.siteMaster.update({ where: { code }, data });
  hourlyCache.clear();
  return NextResponse.json({ data: site });
});

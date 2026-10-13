// POST /api/site-master/import (admin, multipart form field "file": .xlsx) → upsert by Code.
// Returns { inserted, updated, skipped[] }. Clears the hourly cache (enrichment changed).
import { HourlyReportError, parseSiteMasterXlsx } from "@alarm/core/hourly";
import { NextResponse } from "next/server";
import { handler, HttpError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hourlyCache } from "@/lib/hourly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Send multipart/form-data with a 'file' field");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Missing 'file'");
  if (!/\.xlsx$/i.test(file.name)) throw new HttpError(400, "Upload an .xlsx file");
  if (file.size > MAX_BYTES) throw new HttpError(413, "File too large (max 5 MB)");

  let parsed;
  try {
    parsed = await parseSiteMasterXlsx(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof HourlyReportError) throw new HttpError(422, err.message);
    throw err;
  }

  const existing = new Set(
    (
      await prisma.siteMaster.findMany({
        where: { code: { in: parsed.rows.map((r) => r.code) } },
        select: { code: true },
      })
    ).map((r) => r.code),
  );
  await prisma.$transaction(
    parsed.rows.map(({ code, ...rest }) =>
      prisma.siteMaster.upsert({ where: { code }, create: { code, ...rest }, update: rest }),
    ),
  );
  hourlyCache.clear();

  const updated = parsed.rows.filter((r) => existing.has(r.code)).length;
  return NextResponse.json({
    data: { inserted: parsed.rows.length - updated, updated, skipped: parsed.skipped },
    meta: { fileName: file.name },
  });
});

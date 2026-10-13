// GET /api/site-master?office&q&page&pageSize — any signed-in user (read-only reference data).
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@alarm/db";
import { handler, pagination, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  office: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
  ...pagination,
});

export const GET = handler(async (req: Request) => {
  await requireUser();
  const { office, q, page, pageSize } = parseQuery(req, query);
  const where: Prisma.SiteMasterWhereInput = {
    ...(office ? { office } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { siteName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total, offices] = await Promise.all([
    prisma.siteMaster.findMany({
      where,
      orderBy: [{ office: "asc" }, { code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.siteMaster.count({ where }),
    prisma.siteMaster.groupBy({ by: ["office"], _count: { _all: true }, orderBy: { office: "asc" } }),
  ]);
  return NextResponse.json({
    data: items,
    meta: {
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      offices: offices.map((o) => ({ office: o.office, count: o._count._all })),
    },
  });
});

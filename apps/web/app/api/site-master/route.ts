// GET /api/site-master?office&q&page&pageSize — any signed-in user (read-only reference data).
// Office users see only the sites of their own office (Site Master office ↔ office label by name).
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@alarm/db";
import { handler, pagination, parseQuery, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getOffice, sameOffice } from "@/lib/office";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  office: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
  ...pagination,
});

export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const { office, q, page, pageSize } = parseQuery(req, query);
  const scope = await getOffice(Number(session.user.id));
  const allOffices = await prisma.siteMaster.groupBy({
    by: ["office"],
    _count: { _all: true },
    orderBy: { office: "asc" },
  });
  const offices =
    scope === null ? allOffices : allOffices.filter((o) => sameOffice(o.office, scope));
  const where: Prisma.SiteMasterWhereInput = {
    AND: [
      scope === null ? {} : { office: { in: offices.map((o) => o.office) } },
      office ? { office } : {},
    ],
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { siteName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.siteMaster.findMany({
      where,
      orderBy: [{ office: "asc" }, { code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.siteMaster.count({ where }),
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

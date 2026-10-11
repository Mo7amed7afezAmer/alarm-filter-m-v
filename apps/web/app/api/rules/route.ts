import { NextResponse } from "next/server";
import { classify } from "@alarm/core";
import { z } from "zod";
import { category, handler, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const rulesBody = z.object({
  rules: z
    .array(
      z.object({
        pattern: z.string().trim().min(1).max(100),
        category,
        priority: z.coerce.number().int().min(0).max(100_000),
      }),
    )
    .max(500),
});

async function listRules() {
  return prisma.rule.findMany({ orderBy: [{ priority: "asc" }, { id: "asc" }] });
}

export const GET = handler(async () => {
  await requireUser("ADMIN");
  return NextResponse.json({ rules: await listRules() });
});

/** Replace all rules, then re-classify existing alarms (one UPDATE per distinct alarm name). */
export const PUT = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const { rules } = await parseBody(req, rulesBody);

  const reclassified = await prisma.$transaction(async (tx) => {
    await tx.rule.deleteMany();
    if (rules.length) await tx.rule.createMany({ data: rules });

    const names = await tx.alarm.groupBy({ by: ["alarmName", "category"] });
    let changed = 0;
    for (const n of names) {
      const next = classify(n.alarmName, rules);
      if (next !== n.category) {
        const r = await tx.alarm.updateMany({
          where: { alarmName: n.alarmName, category: n.category },
          data: { category: next },
        });
        changed += r.count;
      }
    }
    return changed;
  });

  return NextResponse.json({ rules: await listRules(), reclassified });
});

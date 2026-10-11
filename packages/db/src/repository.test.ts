// Integration test: engine + PrismaAlarmRepository against a real Postgres.
// Runs only when TEST_DATABASE_URL is set; everything happens in a transaction that is rolled back.
//   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
//   TEST_DATABASE_URL=postgresql://alarm:<pw>@127.0.0.1:5432/alarms corepack pnpm test
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MatchingEngine } from "@alarm/core";
import { PrismaAlarmRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(!url)("PrismaAlarmRepository (integration)", () => {
  it("runs the engine end-to-end and reprocess is idempotent", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const SITE = "ZZ-INTEGRATION-TEST";
    const subj = (t: string, clear = false) =>
      `${clear ? "CLEARED_" : ""}S_D_N_BTS O&M LINK FAILURE on #${SITE}# at |${t} |`;
    try {
      await prisma.$transaction(
        async (tx) => {
          const raw = await Promise.all(
            [
              [subj("11-OCT-2026 10:00:00"), "2026-10-11T07:01:00Z"],
              [subj("11-OCT-2026 12:00:00"), "2026-10-11T09:01:00Z"],
              [subj("11-OCT-2026 12:00:00", true), "2026-10-11T10:00:00Z"],
              [
                subj("01-OCT-2026 09:00:00", true).replace(SITE, `${SITE}-2`),
                "2026-10-11T10:05:00Z",
              ],
            ].map(([subject, at], i) =>
              tx.rawMessage.create({
                data: { gmailId: `itest-${i}`, subject: subject!, receivedAt: new Date(at!) },
              }),
            ),
          );

          const engine = new MatchingEngine(new PrismaAlarmRepository(tx), {
            timeZone: "Africa/Cairo",
          });
          const s = await engine.processBatch(raw);
          expect(s).toMatchObject({ created: 1, superseded: 1, cleared: 1, orphan: 1 });

          const snap = async () => ({
            alarms: await tx.alarm.findMany({
              where: { site: SITE },
              orderBy: { alarmTime: "asc" },
              select: {
                alarmTime: true,
                status: true,
                clearType: true,
                clearTime: true,
                durationMin: true,
                category: true,
              },
            }),
            orphans: await tx.orphanClear.count({ where: { alarmKey: { contains: SITE } } }),
          });
          const before = await snap();
          expect(before.alarms.map((a) => a.clearType)).toEqual(["AUTO_SUPERSEDED", "EMAIL"]);
          expect(before.alarms[1]).toMatchObject({ durationMin: 60, category: "DOWN" });
          expect(before.orphans).toBe(1);

          const now = new Date("2026-10-11T18:00:00Z");
          await engine.reprocess(1, now);
          const r1 = await snap();
          await engine.reprocess(1, now);
          expect(await snap()).toEqual(r1);
          expect(r1).toEqual(before);

          throw new Rollback();
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      await prisma.$disconnect();
    }
  });
});

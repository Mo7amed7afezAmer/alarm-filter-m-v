// officeLabelMap: unit. resolveOffices: integration (TEST_DATABASE_URL, alarms_test), inside a
// transaction that is rolled back.
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { officeLabelMap, resolveOffices } from "./offices.js";

const url = process.env.TEST_DATABASE_URL;

class Rollback extends Error {}

describe("officeLabelMap", () => {
  it("keys Gmail office labels by their comparable name", () => {
    const m = officeLabelMap(["DN/Kafr ElDawar", "DS/Benha", "DN/Kafr ElDawar"]);
    expect(m.get("KAFRELDAWAR")).toBe("DN/Kafr ElDawar");
    expect(m.get("BENHA")).toBe("DS/Benha");
    expect(m.size).toBe(2);
  });
});

describe.skipIf(!url)("resolveOffices (integration)", () => {
  it("uses the Site Master office of the site code, else the mail label", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const base = {
      alarmName: "S_D_N_ZZ OFFICE TEST",
      category: "OTHER" as const,
      alarmTime: new Date(),
      status: "ACTIVE" as const,
      mailOffice: "ZZ/Mail Office",
      office: "ZZ/Mail Office",
    };
    try {
      await prisma.$transaction(async (tx) => {
        await tx.systemStatus.upsert({
          where: { id: 1 },
          update: { availableLabels: [{ name: "ZZ/Mail Office" }, { name: "ZZ/Site Office" }] },
          create: { id: 1, availableLabels: [{ name: "ZZ/Mail Office" }, { name: "ZZ/Site Office" }] },
        });
        await tx.siteMaster.create({ data: { code: "9Z97ZZ", office: "SITE OFFICE" } });
        await tx.siteMaster.create({ data: { code: "9Z96ZZ", office: "NO SUCH LABEL" } });
        const inMaster = await tx.alarm.create({
          data: { ...base, alarmKey: "a", site: "X_S_ZZ-A_9Z97ZZ", siteCode: "9Z97ZZ" },
        });
        const unmapped = await tx.alarm.create({
          data: { ...base, alarmKey: "b", site: "X_S_ZZ-B_9Z96ZZ", siteCode: "9Z96ZZ" },
        });
        const unknown = await tx.alarm.create({
          data: { ...base, alarmKey: "c", site: "X_S_ZZ-C_9Z95ZZ", siteCode: "9Z95ZZ" },
        });
        const raw = await tx.rawMessage.create({
          data: { gmailId: "zz-office-test", subject: "s", receivedAt: new Date() },
        });
        const orphan = await tx.orphanClear.create({
          data: {
            alarmKey: "S_D_N_ZZ||X_S_ZZ-A_9Z97ZZ",
            subject: "s",
            clearTime: new Date(),
            rawMessageId: raw.id,
            mailOffice: "ZZ/Mail Office",
          },
        });

        const r = await resolveOffices(tx, { minAlarmId: inMaster.id, minOrphanId: orphan.id });
        expect(r).toEqual({ alarms: 1, orphans: 1 });
        const office = async (id: number) =>
          (await tx.alarm.findUniqueOrThrow({ where: { id } })).office;
        expect(await office(inMaster.id)).toBe("ZZ/Site Office");
        expect(await office(unmapped.id)).toBe("ZZ/Mail Office"); // Site Master office has no label
        expect(await office(unknown.id)).toBe("ZZ/Mail Office"); // code not in Site Master
        expect((await tx.orphanClear.findUniqueOrThrow({ where: { id: orphan.id } })).office).toBe(
          "ZZ/Site Office",
        );

        // Site Master moves the site → re-resolving moves the alarm; nothing else is rewritten.
        await tx.siteMaster.update({ where: { code: "9Z97ZZ" }, data: { office: "MAIL OFFICE" } });
        expect((await resolveOffices(tx, { minAlarmId: inMaster.id })).alarms).toBe(1);
        expect(await office(inMaster.id)).toBe("ZZ/Mail Office");
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      await prisma.$disconnect();
    }
  });
});

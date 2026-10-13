import { readFileSync, rmSync } from "node:fs";
import { E2E_EMAIL, PASSWORD_FILE, SITE_MASTER, testDbUrl } from "./shared";

export default async function globalTeardown() {
  process.env.DATABASE_URL = testDbUrl();
  const { PrismaClient } = await import("@prisma/client");
  const { parseSiteMasterXlsx } = await import("@alarm/core/hourly");
  const prisma = new PrismaClient();
  try {
    await prisma.user.deleteMany({ where: { email: E2E_EMAIL } });
    const { rows } = await parseSiteMasterXlsx(readFileSync(SITE_MASTER));
    await prisma.siteMaster.deleteMany({ where: { code: { in: rows.map((r) => r.code) } } });
  } finally {
    await prisma.$disconnect();
    rmSync(PASSWORD_FILE, { force: true });
  }
}

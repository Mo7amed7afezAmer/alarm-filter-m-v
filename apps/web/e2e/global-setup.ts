// Creates a throwaway admin (random password, alarms_test only) and loads the fixture
// SiteMaster so the office filter has data.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { E2E_EMAIL, PASSWORD_FILE, SITE_MASTER, testDbUrl } from "./shared";

export default async function globalSetup() {
  process.env.DATABASE_URL = testDbUrl();
  const { PrismaClient } = await import("@prisma/client");
  const { parseSiteMasterXlsx } = await import("@alarm/core/hourly");
  const prisma = new PrismaClient();
  try {
    const password = randomBytes(18).toString("base64url");
    mkdirSync(path.dirname(PASSWORD_FILE), { recursive: true });
    writeFileSync(PASSWORD_FILE, password, { mode: 0o600 });
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.upsert({
      where: { email: E2E_EMAIL },
      create: { email: E2E_EMAIL, passwordHash, role: "ADMIN" },
      update: { passwordHash, role: "ADMIN" },
    });
    const { rows } = await parseSiteMasterXlsx(readFileSync(SITE_MASTER));
    for (const { code, ...rest } of rows)
      await prisma.siteMaster.upsert({ where: { code }, create: { code, ...rest }, update: rest });
  } finally {
    await prisma.$disconnect();
  }
}

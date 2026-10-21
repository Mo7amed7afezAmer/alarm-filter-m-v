// e2e DB fixture, run as a plain node child process by global-setup / global-teardown.
// (Importing the ESM @alarm/core/hourly through Playwright's TS loader hangs, so the DB work
// lives here.) Usage: node e2e/db.mjs setup|teardown <passwordFile>. Only touches alarms_test.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { parseSiteMasterXlsx } from "@alarm/core/hourly";

const [mode, passwordFile] = process.argv.slice(2);
const E2E_EMAIL = "e2e-admin@local.test";
const here = path.dirname(fileURLToPath(import.meta.url));
const SITE_MASTER = path.resolve(here, "../../../tests/fixtures/SiteMaster_KafrElDawar.xlsx");

const url = process.env.TEST_DATABASE_URL;
if (!url || !/\/alarms_test(\?|$)/.test(url)) {
  console.error("TEST_DATABASE_URL must point at the alarms_test database");
  process.exit(1);
}
process.env.DATABASE_URL = url;

const prisma = new PrismaClient();
try {
  const { rows } = await parseSiteMasterXlsx(readFileSync(SITE_MASTER));
  if (mode === "setup") {
    const password = randomBytes(18).toString("base64url");
    mkdirSync(path.dirname(passwordFile), { recursive: true });
    writeFileSync(passwordFile, password, { mode: 0o600 });
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.upsert({
      where: { email: E2E_EMAIL },
      create: { email: E2E_EMAIL, passwordHash, role: "SUPER_ADMIN", office: null },
      update: { passwordHash, role: "SUPER_ADMIN", office: null },
    });
    await prisma.$transaction(
      rows.map(({ code, ...rest }) =>
        prisma.siteMaster.upsert({ where: { code }, create: { code, ...rest }, update: rest }),
      ),
    );
    console.log(`[e2e db] user + ${rows.length} sites ready`);
  } else if (mode === "teardown") {
    await prisma.user.deleteMany({ where: { email: E2E_EMAIL } });
    await prisma.siteMaster.deleteMany({ where: { code: { in: rows.map((r) => r.code) } } });
    rmSync(passwordFile, { force: true });
    console.log("[e2e db] cleaned up");
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
} finally {
  await prisma.$disconnect();
}

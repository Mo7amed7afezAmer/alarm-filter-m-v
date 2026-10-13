/**
 * Idempotent seed (runs after every `prisma migrate deploy`):
 * - classification rules from CLAUDE.md §6 — only when the rules table is empty,
 *   so edits made in the UI survive re-runs
 * - SystemStatus row id=1
 * - hourly report normalizations (§14) — only when that table is empty
 * - admin user from ADMIN_EMAIL / ADMIN_PASSWORD — created once, never overwritten,
 *   password never printed
 */
import { PrismaClient, type Category } from "@prisma/client";
// Source import (tsx): the migrate image ships packages/core/src but never builds it.
import { DEFAULT_HOURLY_NORMALIZATIONS } from "../../core/src/hourly/normalize.js";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Lower priority number = checked first.
const RULES: Record<Exclude<Category, "OTHER">, string[]> = {
  DOWN: ["LINK FAILURE", "BTS DOWN", "CELL UNAVAILABLE", "SITE DOWN", "UNREACHABLE", "NODE DOWN"],
  POWER: ["MAINS", "AC FAIL", "BATTERY", "RECTIFIER", "DC LOW", "GENERATOR", "POWER"],
};

async function seedRules() {
  if ((await prisma.rule.count()) > 0) {
    console.log("rules: table not empty, leaving as-is");
    return;
  }
  const data = [
    ...RULES.DOWN.map((pattern, i) => ({
      pattern,
      category: "DOWN" as const,
      priority: 10 + i * 10,
    })),
    ...RULES.POWER.map((pattern, i) => ({
      pattern,
      category: "POWER" as const,
      priority: 100 + i * 10,
    })),
  ];
  await prisma.rule.createMany({ data });
  console.log(`rules: inserted ${data.length}`);
}

async function seedSystemStatus() {
  await prisma.systemStatus.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  console.log("system_status: ok");
}

async function seedHourlyNormalizations() {
  if ((await prisma.hourlyNormalization.count()) > 0) {
    console.log("hourly_normalizations: table not empty, leaving as-is");
    return;
  }
  await prisma.hourlyNormalization.createMany({ data: DEFAULT_HOURLY_NORMALIZATIONS });
  console.log(`hourly_normalizations: inserted ${DEFAULT_HOURLY_NORMALIZATIONS.length}`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email) {
    console.log("admin: ADMIN_EMAIL not set, skipping");
    return;
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`admin: ${email} already exists, leaving as-is`);
    return;
  }
  if (password.length < 8) {
    console.log(
      "admin: ADMIN_PASSWORD missing or shorter than 8 chars — set it in .env and re-run migrate",
    );
    return;
  }
  await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN" },
  });
  console.log(`admin: created ${email}`);
}

async function main() {
  await seedRules();
  await seedSystemStatus();
  await seedHourlyNormalizations();
  await seedAdmin();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

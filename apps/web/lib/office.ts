// The selected office (Gmail label) — every page and stat is scoped to it.
import { prisma } from "./db";

export async function getOffice(): Promise<string | null> {
  const s = await prisma.systemStatus.findUnique({
    where: { id: 1 },
    select: { officeLabel: true },
  });
  return s?.officeLabel ?? null;
}

/** Prisma filter for the current office; no filter when none is chosen yet. */
export async function officeFilter(): Promise<{ office?: string }> {
  const office = await getOffice();
  return office ? { office } : {};
}

export async function availableOffices(): Promise<string[]> {
  const s = await prisma.systemStatus.findUnique({
    where: { id: 1 },
    select: { availableLabels: true },
  });
  const list = Array.isArray(s?.availableLabels) ? (s.availableLabels as { name?: unknown }[]) : [];
  return list.map((l) => l?.name).filter((n): n is string => typeof n === "string");
}

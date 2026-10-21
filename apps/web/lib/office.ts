// Office scope of the signed-in user — every page and stat is filtered to it (lib/roles.ts):
// office users see their own office; the super admin sees the office they picked, or all.
// Alarms carry their resolved office (Site Master first, then the mail label — @alarm/db
// resolveOffices), so the scope is a plain `office = …` filter.
import { officeMatchKey } from "@alarm/core";
import { prisma } from "./db";
import { scopeOfficeOf } from "./roles";

/** null = all offices; "" = none (user without an office); else the office label. */
export async function getOffice(userId: number | undefined): Promise<string | null> {
  const u = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true, office: true } })
    : null;
  return u ? scopeOfficeOf(u) : "";
}

/** Prisma filter (alarms, orphan clears, raw messages) for the user's office scope. */
export async function officeFilter(userId: number | undefined): Promise<{ office?: string }> {
  const office = await getOffice(userId);
  return office === null ? {} : { office };
}

/** Office labels to choose from (the worker refreshes them from Gmail every 10 min). */
export async function availableOffices(): Promise<string[]> {
  const s = await prisma.systemStatus.findUnique({
    where: { id: 1 },
    select: { availableLabels: true },
  });
  const list = Array.isArray(s?.availableLabels) ? (s.availableLabels as { name?: unknown }[]) : [];
  return list.map((l) => l?.name).filter((n): n is string => typeof n === "string");
}

/** Does a Site Master / hourly-report office name ("KAFR EL DAWAR") belong to `office`? */
export function sameOffice(siteMasterOffice: string | null | undefined, office: string): boolean {
  const k = officeMatchKey(office);
  return !!k && !!siteMasterOffice && officeMatchKey(siteMasterOffice) === k;
}

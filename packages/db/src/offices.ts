// Office of every alarm / orphan clear (what each page filters on):
//   1. Site Master: site code → site_master.office, mapped to its Gmail office label by name
//      ("KAFR EL DAWAR" ↔ "DN/Kafr ElDawar", see officeMatchKey);
//   2. otherwise the office label of the mail itself (mailOffice).
// Stored on the row so every query stays a plain `office = …` filter. Re-run after a Site Master
// import/edit (whole table) and after each worker batch (new rows only).
import { officeMatchKey } from "@alarm/core";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Office label for each match key: "KAFRELDAWAR" → "DN/Kafr ElDawar". First label wins. */
export function officeLabelMap(labels: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of labels) {
    const k = officeMatchKey(l);
    if (k && !map.has(k)) map.set(k, l);
  }
  return map;
}

/** Office labels known to the system: the worker's label list + every mail office seen. */
export async function knownOfficeLabels(db: Db): Promise<string[]> {
  const [status, mail] = await Promise.all([
    db.systemStatus.findUnique({ where: { id: 1 }, select: { availableLabels: true } }),
    db.rawMessage.findMany({
      where: { office: { not: null } },
      distinct: ["office"],
      select: { office: true },
    }),
  ]);
  const list = Array.isArray(status?.availableLabels)
    ? (status.availableLabels as { name?: unknown }[])
    : [];
  const names = list.map((l) => l?.name).filter((n): n is string => typeof n === "string");
  return [...new Set([...names, ...mail.map((m) => m.office!)])].sort((a, b) =>
    a.localeCompare(b),
  );
}

export interface ResolveOptions {
  /** Only rows with id ≥ these (new rows of a worker batch). Default: every row. */
  minAlarmId?: number;
  minOrphanId?: number;
}

/** Recomputes alarms.office / orphan_clears.office; writes only rows that change. */
export async function resolveOffices(
  db: Db,
  opts: ResolveOptions = {},
): Promise<{ alarms: number; orphans: number }> {
  const map = officeLabelMap(await knownOfficeLabels(db));
  const keys = [...map.keys()];
  const labels = [...map.values()];
  // Same normalization as officeMatchKey(): letters only, upper-case (site_master has no "/").
  const alarms = await db.$executeRaw`
    WITH map(key, label) AS (SELECT * FROM unnest(${keys}::text[], ${labels}::text[])),
    resolved AS (
      SELECT a.id, COALESCE(map.label, a."mailOffice") AS office
      FROM alarms a
      LEFT JOIN site_master m ON m.code = a."siteCode"
      LEFT JOIN map ON map.key = regexp_replace(upper(m.office), '[^A-Z]', '', 'g')
      WHERE a.id >= ${opts.minAlarmId ?? 0}
    )
    UPDATE alarms a SET office = r.office
    FROM resolved r
    WHERE a.id = r.id AND a.office IS DISTINCT FROM r.office`;
  // Orphans have no site column: the site is the 2nd part of alarmKey (name||site[||cell]).
  const orphans = await db.$executeRaw`
    WITH map(key, label) AS (SELECT * FROM unnest(${keys}::text[], ${labels}::text[])),
    resolved AS (
      SELECT o.id, COALESCE(map.label, o."mailOffice") AS office
      FROM orphan_clears o
      LEFT JOIN site_master m
        ON m.code = upper(regexp_replace(trim(split_part(o."alarmKey", '||', 2)), '^.*_', ''))
      LEFT JOIN map ON map.key = regexp_replace(upper(m.office), '[^A-Z]', '', 'g')
      WHERE o.id >= ${opts.minOrphanId ?? 0}
    )
    UPDATE orphan_clears o SET office = r.office
    FROM resolved r
    WHERE o.id = r.id AND o.office IS DISTINCT FROM r.office`;
  return { alarms, orphans };
}

/** Site Master office names that match no office label (shown as a warning in the UI). */
export async function unmappedSiteMasterOffices(db: Db): Promise<string[]> {
  const map = officeLabelMap(await knownOfficeLabels(db));
  const offices = await db.siteMaster.groupBy({ by: ["office"] });
  return offices.map((o) => o.office).filter((o) => !map.has(officeMatchKey(o)));
}

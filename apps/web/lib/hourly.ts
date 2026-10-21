// Hourly reports service (§14, stateless): Gmail attachment → @alarm/core/hourly pipeline →
// in-process cache. Route Handlers call these; nothing about alarm rows is persisted.

import {
  CATEGORIES,
  HOURLY_COLUMN_KEYS,
  HOURLY_DEFAULT_COLUMNS,
  type Category,
  type HourlyColumnKey,
  type HourlyFilters,
  type HourlyMeta,
  type HourlyRow,
} from "@alarm/core";
import { HourlyReportError, limitsFromEnv, processReport, type ProcessedReport } from "@alarm/core/hourly";
import { HttpError } from "./api";
import { hasRole, type Role } from "./auth";
import { prisma } from "./db";
import { hourlySource, NotFoundError } from "./gmail";
import { getOffice, sameOffice } from "./office";
import { ReportCache, type CacheStatus } from "./hourlyCache";

const ttlMin = Number(process.env.HOURLY_CACHE_MIN) > 0 ? Number(process.env.HOURLY_CACHE_MIN) : 30;

const g = globalThis as unknown as { hourlyCache?: ReportCache<ProcessedReport> };
/** One cache per Next.js server instance (see lib/hourlyCache.ts). */
export const hourlyCache = (g.hourlyCache ??= new ReportCache<ProcessedReport>(ttlMin * 60_000, 20));

export type ReportStatus = CacheStatus<HourlyMeta>;

/** Download → validate → extract → parse → enrich/normalize. Temp files never outlive this. */
async function processNow(gmailId: string): Promise<ProcessedReport> {
  let attachment: { fileName: string; data: Buffer };
  try {
    attachment = await hourlySource().getAttachment(gmailId);
  } catch (err) {
    if (err instanceof NotFoundError) throw new HttpError(404, err.message);
    throw err;
  }
  const [sites, normalizations] = await Promise.all([
    prisma.siteMaster.findMany(),
    prisma.hourlyNormalization.findMany(),
  ]);
  return processReport({
    fileName: attachment.fileName,
    data: attachment.data,
    sites,
    normalizations,
    limits: limitsFromEnv(),
  });
}

/** Starts processing in the background (202 flow). Errors land in the status. */
export function startProcessing(gmailId: string, force = false): ReportStatus {
  hourlyCache.run(gmailId, () => processNow(gmailId), force).catch((err) => {
    if (!(err instanceof HourlyReportError) && !(err instanceof HttpError))
      console.error(`hourly ${gmailId}:`, err);
  });
  return hourlyCache.status(gmailId);
}

/**
 * Processed report for reading (rows / export / diff). Served from cache; a cold report
 * that was processed before is re-processed transparently. A report nobody processed yet
 * needs an operator (viewers get 409 and see the Process button state instead).
 */
export async function getReport(gmailId: string, role: string | undefined): Promise<ProcessedReport> {
  const cached = hourlyCache.get(gmailId);
  if (cached) return cached;
  if (!hourlyCache.wasProcessed(gmailId) && !hasRole(role, "OPERATOR" satisfies Role))
    throw new HttpError(409, "This report has not been processed yet — ask an operator to process it");
  try {
    return await hourlyCache.run(gmailId, () => processNow(gmailId));
  } catch (err) {
    if (err instanceof HourlyReportError) throw new HttpError(422, err.message, { code: err.code });
    throw err;
  }
}

/**
 * Rows the user may see: the super admin (all offices) gets every row; an office user only the
 * rows whose Site Master office is their office (rows with an unknown site code are left out).
 */
export async function scopeRows(rows: HourlyRow[], userId: number): Promise<HourlyRow[]> {
  const office = await getOffice(userId);
  if (office === null) return rows;
  return office ? rows.filter((r) => sameOffice(r.office, office)) : [];
}

// ---- query parsing (filters are repeatable: ?office=A&office=B) ----

const GMAIL_ID = /^[A-Za-z0-9_-]{6,64}$/;

export function checkGmailId(id: string): string {
  if (!GMAIL_ID.test(id)) throw new HttpError(400, "Invalid report id");
  return id;
}

const many = (sp: URLSearchParams, key: string): string[] | undefined => {
  const v = sp
    .getAll(key)
    .map((s) => s.trim())
    .filter(Boolean);
  return v.length ? v : undefined;
};

const WALL = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

/** Filters from the URL — the same keys the /hourly page keeps in its own URL. */
export function parseFilters(sp: URLSearchParams): HourlyFilters {
  const category = many(sp, "category");
  if (category?.some((c) => !(CATEGORIES as readonly string[]).includes(c)))
    throw new HttpError(400, "Invalid query", { category: ["must be DOWN, POWER or OTHER"] });
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  for (const [k, v] of [
    ["from", from],
    ["to", to],
  ] as const)
    if (v && !WALL.test(v)) throw new HttpError(400, "Invalid query", { [k]: ["use YYYY-MM-DD HH:mm"] });
  const vip = sp.get("vip");
  if (vip && vip !== "true" && vip !== "false")
    throw new HttpError(400, "Invalid query", { vip: ["true or false"] });
  const q = sp.get("q")?.trim();
  if (q && q.length > 100) throw new HttpError(400, "Invalid query", { q: ["too long"] });
  return {
    sheet: sp.get("sheet") || undefined,
    region: many(sp, "region"),
    office: many(sp, "office"),
    alarm: many(sp, "alarm"),
    siteType: many(sp, "siteType"),
    category: category as Category[] | undefined,
    vip: vip ? vip === "true" : undefined,
    from,
    to,
    q: q || undefined,
  };
}

/** ?columns=a,b,c (or repeated) → known keys in the given order; default = §14 columns. */
export function parseColumns(sp: URLSearchParams): HourlyColumnKey[] {
  const raw = sp
    .getAll("columns")
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!raw.length) return HOURLY_DEFAULT_COLUMNS;
  const bad = raw.filter((c) => !(HOURLY_COLUMN_KEYS as string[]).includes(c));
  if (bad.length) throw new HttpError(400, "Invalid query", { columns: [`unknown: ${bad.join(", ")}`] });
  return [...new Set(raw)] as HourlyColumnKey[];
}

export type { HourlyRow };

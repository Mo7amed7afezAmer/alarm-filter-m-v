// One worker run: optional reprocess, Gmail sync, matching — under pg_advisory_xact_lock(42).
import { MatchingEngine, type BatchSummary } from "@alarm/core";
import {
  PrismaAlarmRepository,
  resolveOffices,
  type Prisma,
  type PrismaClient,
} from "@alarm/db";
import { officeOfLabels, type MailSource, type MessageMeta } from "./gmail.js";
import { planSync } from "./sync.js";

export interface RunDeps {
  prisma: PrismaClient;
  source: MailSource;
  timeZone: string;
  maxPerRun: number;
  backfillHours: number;
  query?: string;
  /** Parents whose child labels are offices (OFFICE_LABEL_PARENTS): a message's office is its
   *  first label under one of them. */
  officeParents?: string[];
  log?: (msg: string) => void;
}

export interface RunResult {
  fetched: number;
  /** Messages this run was allowed to fetch (adapts to the Gmail quota, ≤ maxPerRun). */
  cap: number;
  /** Gmail said "quota exceeded" — the run saved what it had and waits for the next minute. */
  throttled: boolean;
  backlog: number;
  mode: "history" | "fallback";
  reprocessed: BatchSummary | null;
  processed: BatchSummary;
  /** Alarms / orphan clears whose office changed (Site Master or mail label). */
  officesResolved: number;
}

const LOCK_ID = 42;
/** system_status.syncedLabel when lastHistoryId covers the whole mailbox. */
export const ALL_MAIL = "*";
// Small batches: a quota hit then loses at most one batch, and bursts stay gentle.
const FETCH_CONCURRENCY = 5;
const IN_CHUNK = 1000;

async function lock(tx: Prisma.TransactionClient) {
  // ::text because Prisma cannot deserialize a void column.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${LOCK_ID})::text`;
}

async function knownIds(prisma: PrismaClient, ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const rows = await prisma.rawMessage.findMany({
      where: { gmailId: { in: ids.slice(i, i + IN_CHUNK) } },
      select: { gmailId: true },
    });
    for (const r of rows) known.add(r.gmailId);
  }
  return known;
}

/** Gmail 429 / 403 rateLimitExceeded / "Quota exceeded". */
export function isQuotaError(err: unknown): boolean {
  const e = err as { code?: number; status?: number; message?: string };
  const code = e.code ?? e.status;
  return (
    code === 429 ||
    (code === 403 && /quota|rate/i.test(e.message ?? "")) ||
    /Quota exceeded/i.test(e.message ?? "")
  );
}

/**
 * Messages per run, adapted to the Gmail per-user quota (units per minute): a run that hit
 * the quota sets the cap just below what it managed; a clean full run grows it back by 10%.
 * Avoids the "111 fetched, next run fails at once" pattern that halves throughput.
 */
export function nextFetchCap(
  cap: number,
  max: number,
  r: { requested: number; fetched: number; throttled: boolean },
): number {
  const MIN = 20;
  if (r.throttled)
    return Math.max(MIN, r.fetched ? Math.min(cap, Math.floor(r.fetched * 0.9)) : Math.floor(cap / 2));
  if (r.requested >= cap) return Math.min(max, Math.ceil(cap * 1.1));
  return cap;
}

let fetchCap: number | null = null;

/** Fetches in small batches. On a quota error it STOPS and returns what it already has
 *  (`throttled: true`) so the run still saves progress instead of losing the whole batch. */
export async function fetchAll(
  source: MailSource,
  ids: string[],
): Promise<{ metas: MessageMeta[]; throttled: boolean }> {
  const metas: MessageMeta[] = [];
  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const results = await Promise.allSettled(
      ids.slice(i, i + FETCH_CONCURRENCY).map((id) => source.getMeta(id)),
    );
    let throttled = false;
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value) metas.push(r.value);
      } else if (isQuotaError(r.reason)) {
        throttled = true;
      } else {
        throw r.reason;
      }
    }
    if (throttled) return { metas, throttled: true };
  }
  return { metas, throttled: false };
}

export async function runOnce(deps: RunDeps): Promise<RunResult> {
  const { prisma, source, timeZone } = deps;
  const log = deps.log ?? (() => {});
  const status = await prisma.systemStatus.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  // Honour a reprocess request from the API, then clear it.
  let reprocessed: BatchSummary | null = null;
  if (status.reprocessDays && status.reprocessDays > 0) {
    const days = status.reprocessDays;
    log(`reprocess: last ${days} day(s) ...`);
    reprocessed = await prisma.$transaction(
      async (tx) => {
        await lock(tx);
        const summary = await new MatchingEngine(new PrismaAlarmRepository(tx), {
          timeZone,
        }).reprocess(days);
        await resolveOffices(tx); // reopened alarms keep their office; recreated ones need one
        await tx.systemStatus.update({ where: { id: 1 }, data: { reprocessDays: null } });
        return summary;
      },
      { timeout: 30 * 60_000, maxWait: 60_000 },
    );
    log(`reprocess: done ${JSON.stringify(reprocessed)}`);
  }

  // The whole mailbox is read. A history position taken while only one label was read
  // (syncedLabel ≠ "*") does not cover the rest, so that forces one fresh backfill.
  await source.prepare?.(); // picks up a Gmail account (re)connected in /settings/gmail
  const fresh = status.syncedLabel !== ALL_MAIL;
  if (fresh) log(`sync scope: ${status.syncedLabel ?? "(none)"} → all mail — backfilling`);
  await refreshLabels(deps, log);

  // Network work happens outside the DB transaction.
  const cap = Math.min(deps.maxPerRun, (fetchCap ??= deps.maxPerRun));
  let plan: Awaited<ReturnType<typeof planSync>>;
  let listThrottled = false;
  try {
    plan = await planSync(
      source,
      fresh ? null : status.lastHistoryId,
      (ids) => knownIds(prisma, ids),
      { maxPerRun: cap, backfillHours: deps.backfillHours, query: deps.query },
    );
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    // Not an error: the minute's quota is used up. Fetch nothing now (stored-but-unprocessed
    // mail is still processed below) and try again next minute.
    fetchCap = nextFetchCap(cap, deps.maxPerRun, { requested: cap, fetched: 0, throttled: true });
    log(`Gmail quota exhausted while listing — waiting for the next minute (cap ${fetchCap})`);
    plan = {
      ids: [],
      nextHistoryId: null,
      mode: fresh ? "fallback" : "history",
      discovered: 0,
      backlog: 0,
    };
    listThrottled = true;
  }
  const fetched = await fetchAll(source, plan.ids);
  const metas = fetched.metas;
  const throttled = fetched.throttled || listThrottled;
  if (!listThrottled)
    fetchCap = nextFetchCap(cap, deps.maxPerRun, {
      requested: plan.ids.length,
      fetched: metas.length,
      throttled,
    });
  if (fetched.throttled) {
    log(
      `Gmail quota hit after ${metas.length}/${plan.ids.length} messages — saving those, ` +
        `next runs fetch up to ${fetchCap}`,
    );
  }
  // Only advance the sync position when everything discovered was actually fetched.
  const nextHistoryId = throttled ? null : plan.nextHistoryId;

  const parents = deps.officeParents ?? [];
  const processed = await prisma.$transaction(
    async (tx) => {
      await lock(tx);
      if (metas.length) {
        await tx.rawMessage.createMany({
          data: metas.map((m) => ({ ...m, office: officeOfLabels(m.labels, parents) })),
          skipDuplicates: true,
        });
      }
      const [lastAlarm, lastOrphan] = await Promise.all([
        tx.alarm.aggregate({ _max: { id: true } }),
        tx.orphanClear.aggregate({ _max: { id: true } }),
      ]);
      // Includes anything left unprocessed by an earlier crash.
      const pending = await tx.rawMessage.findMany({
        where: { processedAt: null },
        select: {
          id: true,
          gmailId: true,
          subject: true,
          receivedAt: true,
          body: true,
          office: true,
        },
        orderBy: { receivedAt: "asc" },
      });
      const summary = await new MatchingEngine(new PrismaAlarmRepository(tx), {
        timeZone,
      }).processBatch(pending);
      // New rows: office from Site Master (by site code), else the mail label.
      const resolved = await resolveOffices(tx, {
        minAlarmId: (lastAlarm._max.id ?? 0) + 1,
        minOrphanId: (lastOrphan._max.id ?? 0) + 1,
      });
      await tx.systemStatus.update({
        where: { id: 1 },
        data: {
          lastRunAt: new Date(),
          lastRunMessages: metas.length,
          lastError: null,
          // The mailbox counts as synced once its backlog is fully drained.
          ...(nextHistoryId ? { lastHistoryId: nextHistoryId, syncedLabel: ALL_MAIL } : {}),
        },
      });
      return { summary, resolved: resolved.alarms + resolved.orphans };
    },
    { timeout: 5 * 60_000, maxWait: 60_000 },
  );

  return {
    fetched: metas.length,
    cap,
    throttled,
    backlog: plan.backlog,
    mode: plan.mode,
    reprocessed,
    processed: processed.summary,
    officesResolved: processed.resolved,
  };
}

let labelsRefreshedAt = 0;
const LABEL_REFRESH_MS = 10 * 60_000;

/** Keeps system_status.availableLabels (the office list) fresh. A changed list can map Site
 *  Master offices to other labels, so offices are then re-resolved. Never fails a run. */
async function refreshLabels(deps: RunDeps, log: (m: string) => void) {
  if (!deps.source.listLabels || Date.now() - labelsRefreshedAt < LABEL_REFRESH_MS) return;
  try {
    const names = await deps.source.listLabels(deps.officeParents ?? []);
    const before = await deps.prisma.systemStatus.findUnique({
      where: { id: 1 },
      select: { availableLabels: true },
    });
    const next = names.map((name) => ({ name }));
    await deps.prisma.systemStatus.update({ where: { id: 1 }, data: { availableLabels: next } });
    if (JSON.stringify(before?.availableLabels ?? null) !== JSON.stringify(next)) {
      const r = await resolveOffices(deps.prisma);
      if (r.alarms + r.orphans) log(`office labels changed: ${r.alarms + r.orphans} row(s) re-assigned`);
    }
    labelsRefreshedAt = Date.now();
  } catch (err) {
    log(`could not refresh label list: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function recordError(prisma: PrismaClient, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.systemStatus.upsert({
    where: { id: 1 },
    update: { lastRunAt: new Date(), lastError: message.slice(0, 2000), lastRunMessages: 0 },
    create: { id: 1, lastRunAt: new Date(), lastError: message.slice(0, 2000) },
  });
}

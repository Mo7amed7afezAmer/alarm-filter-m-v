// One worker run: optional reprocess, Gmail sync, matching — under pg_advisory_xact_lock(42).
import { MatchingEngine, type BatchSummary } from "@alarm/core";
import { PrismaAlarmRepository, type Prisma, type PrismaClient } from "@alarm/db";
import type { MailSource, MessageMeta } from "./gmail.js";
import { planSync } from "./sync.js";

export interface RunDeps {
  prisma: PrismaClient;
  source: MailSource;
  timeZone: string;
  maxPerRun: number;
  backfillHours: number;
  query?: string;
  log?: (msg: string) => void;
}

export interface RunResult {
  fetched: number;
  backlog: number;
  mode: "history" | "fallback";
  reprocessed: BatchSummary | null;
  processed: BatchSummary;
}

const LOCK_ID = 42;
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
        await tx.systemStatus.update({ where: { id: 1 }, data: { reprocessDays: null } });
        return summary;
      },
      { timeout: 30 * 60_000, maxWait: 60_000 },
    );
    log(`reprocess: done ${JSON.stringify(reprocessed)}`);
  }

  // Network work happens outside the DB transaction.
  const plan = await planSync(source, status.lastHistoryId, (ids) => knownIds(prisma, ids), {
    maxPerRun: deps.maxPerRun,
    backfillHours: deps.backfillHours,
    query: deps.query,
  });
  const { metas, throttled } = await fetchAll(source, plan.ids);
  if (throttled) {
    log(
      `Gmail quota hit after ${metas.length}/${plan.ids.length} messages — saving those, continuing next run`,
    );
  }
  // Only advance the sync position when everything discovered was actually fetched.
  const nextHistoryId = throttled ? null : plan.nextHistoryId;

  const processed = await prisma.$transaction(
    async (tx) => {
      await lock(tx);
      if (metas.length) await tx.rawMessage.createMany({ data: metas, skipDuplicates: true });
      // Includes anything left unprocessed by an earlier crash.
      const pending = await tx.rawMessage.findMany({
        where: { processedAt: null },
        select: { id: true, gmailId: true, subject: true, receivedAt: true, body: true },
        orderBy: { receivedAt: "asc" },
      });
      const summary = await new MatchingEngine(new PrismaAlarmRepository(tx), {
        timeZone,
      }).processBatch(pending);
      await tx.systemStatus.update({
        where: { id: 1 },
        data: {
          lastRunAt: new Date(),
          lastRunMessages: metas.length,
          lastError: null,
          ...(nextHistoryId ? { lastHistoryId: nextHistoryId } : {}),
        },
      });
      return summary;
    },
    { timeout: 5 * 60_000, maxWait: 60_000 },
  );

  return { fetched: metas.length, backlog: plan.backlog, mode: plan.mode, reprocessed, processed };
}

export async function recordError(prisma: PrismaClient, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.systemStatus.upsert({
    where: { id: 1 },
    update: { lastRunAt: new Date(), lastError: message.slice(0, 2000), lastRunMessages: 0 },
    create: { id: 1, lastRunAt: new Date(), lastError: message.slice(0, 2000) },
  });
}

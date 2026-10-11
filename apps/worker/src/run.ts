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
const FETCH_CONCURRENCY = 10;
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

async function fetchAll(source: MailSource, ids: string[]): Promise<MessageMeta[]> {
  const out: MessageMeta[] = [];
  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const metas = await Promise.all(
      ids.slice(i, i + FETCH_CONCURRENCY).map((id) => source.getMeta(id)),
    );
    for (const m of metas) if (m) out.push(m);
  }
  return out;
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
  const metas = await fetchAll(source, plan.ids);

  const processed = await prisma.$transaction(
    async (tx) => {
      await lock(tx);
      if (metas.length) await tx.rawMessage.createMany({ data: metas, skipDuplicates: true });
      // Includes anything left unprocessed by an earlier crash.
      const pending = await tx.rawMessage.findMany({
        where: { processedAt: null },
        select: { id: true, gmailId: true, subject: true, receivedAt: true },
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
          ...(plan.nextHistoryId ? { lastHistoryId: plan.nextHistoryId } : {}),
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

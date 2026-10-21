// Decides which Gmail messages to fetch this run and whether lastHistoryId may advance.
import type { MailSource } from "./gmail.js";

export interface SyncPlan {
  /** Ids to fetch now (≤ maxPerRun): the NEWEST unknown ones, listed oldest first. */
  ids: string[];
  /** historyId to store after this run, or null to keep the current one. Only set once every
   *  discovered message is stored — otherwise the next run re-lists and continues the backlog. */
  nextHistoryId: string | null;
  mode: "history" | "fallback";
  discovered: number;
  backlog: number;
}

export interface PlanOptions {
  maxPerRun: number;
  backfillHours: number;
  query?: string;
  now?: Date;
}

/** `isKnown` returns the subset of ids already present in raw_messages. */
export async function planSync(
  source: MailSource,
  lastHistoryId: string | null,
  isKnown: (ids: string[]) => Promise<Set<string>>,
  opts: PlanOptions,
): Promise<SyncPlan> {
  let ids: string[] | null = null;
  let historyId: string | null = null;
  let mode: SyncPlan["mode"] = "history";

  if (lastHistoryId) {
    const r = await source.historySince(lastHistoryId);
    if (r !== "expired") {
      ids = r.ids;
      historyId = r.historyId;
    }
  }
  if (!ids) {
    // §7 C: first run or 404 "historyId too old" → messages.list with after:.
    mode = "fallback";
    historyId = await source.currentHistoryId(); // captured BEFORE listing, so nothing is missed
    const now = opts.now ?? new Date();
    ids = await source.listSince(
      new Date(now.getTime() - opts.backfillHours * 3_600_000),
      opts.query,
    );
  }

  const known = await isKnown(ids);
  const unknown = ids.filter((id) => !known.has(id));
  // Newest first: current alarms show up at once while a backlog is still being worked off
  // (older mail follows in later runs; the engine handles out-of-order alarms/clears).
  const batch = opts.maxPerRun > 0 ? unknown.slice(-opts.maxPerRun) : [];
  const drained = unknown.length <= opts.maxPerRun;

  return {
    ids: batch,
    nextHistoryId: drained ? historyId : null,
    mode,
    discovered: ids.length,
    backlog: unknown.length - batch.length,
  };
}

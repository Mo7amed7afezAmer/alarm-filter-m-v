// Matching engine — CLAUDE.md §7. Pure logic over an async repository interface.
//
// Identity: when the email body carries CONSEC_NBR (§5), it IS the alarm's identity — the alarm
// and its Clear share it, and two alarms with the same subject but different CONSEC_NBR are two
// alarms (e.g. different cells). Without a body/CONSEC_NBR the subject rules (key + time) apply.
import type { Category } from "./index.js";
import { classify, type RuleRecord } from "./classify.js";
import { parseMessage, type HashAlarm, type ParseResult } from "./parser.js";

export type AlarmStatus = "ACTIVE" | "CLEARED";
export type ClearType = "EMAIL" | "AUTO_SUPERSEDED";

export interface AlarmRecord {
  id: number;
  alarmKey: string;
  alarmName: string;
  site: string;
  category: Category;
  alarmTime: Date;
  status: AlarmStatus;
  clearTime: Date | null;
  durationMin: number | null;
  clearType: ClearType | null;
  consecNbr: string | null;
  cellName: string | null;
  device: string | null;
  /** Gmail office label the alarm came from (e.g. "DN/Kafr ElDawar"). */
  office: string | null;
}

export type NewAlarm = Omit<AlarmRecord, "id">;

export interface ClosePatch {
  clearTime: Date;
  clearType: ClearType;
  durationMin: number;
}

export interface OrphanClearRecord {
  id: number;
  alarmKey: string;
  subject: string;
  clearTime: Date;
  rawMessageId: number;
  consecNbr: string | null;
  office: string | null;
}

export interface RawMessageInput {
  id: number;
  gmailId: string;
  subject: string;
  receivedAt: Date;
  /** Plain-text body; null/undefined when not fetched. */
  body?: string | null;
  /** Office label it was read from. */
  office?: string | null;
}

/** Storage operations the engine needs. Implementations must run inside one transaction per batch. */
export interface AlarmRepository {
  loadRules(): Promise<RuleRecord[]>;
  findAlarm(alarmKey: string, alarmTime: Date): Promise<AlarmRecord | null>;
  findAlarmByConsec(consecNbr: string): Promise<AlarmRecord | null>;
  findActiveAlarms(alarmKey: string): Promise<AlarmRecord[]>;
  createAlarm(alarm: NewAlarm): Promise<AlarmRecord>;
  closeAlarm(id: number, patch: ClosePatch): Promise<void>;
  findOrphanClears(alarmKey: string): Promise<OrphanClearRecord[]>;
  createOrphanClear(orphan: Omit<OrphanClearRecord, "id">): Promise<void>;
  deleteOrphanClear(id: number): Promise<void>;
  markProcessed(rawMessageId: number, parseError: string | null): Promise<void>;
  /** reprocess(): delete alarms with alarmTime >= since, reopen alarms closed at/after since,
   *  delete orphan clears whose raw message was received at/after since. */
  resetWindow(since: Date): Promise<void>;
  /** Raw messages received at/after `since`, any order, with bodies. */
  rawMessagesSince(since: Date): Promise<RawMessageInput[]>;
}

export type Outcome =
  | "parse_error"
  | "ignored_format" // HUAWEI: stored only (§5)
  | "duplicate"
  | "created"
  | "created_cleared" // alarm arrived after its Clear (orphan consumed)
  | "created_superseded" // older alarm arrived after a newer one
  | "superseded" // created, and closed older active alarm(s)
  | "cleared"
  | "stale_clear" // Clear for an alarm that is already closed
  | "orphan";

export interface EngineOptions {
  timeZone?: string;
}

export type BatchSummary = Record<Outcome, number> & { total: number };

const MS_PER_MIN = 60_000;

export function durationMinutes(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_MIN));
}

interface Prepared {
  msg: RawMessageInput;
  parsed: ParseResult;
}

/** §7 ordering: alarmTime then receivedAt. Alarms sort before Clears at the same alarmTime so a
 *  Clear delivered first in the same batch still finds its alarm. gmailId breaks ties. */
function sortKey(p: Prepared): [number, number, number, string] {
  const v = p.parsed.ok ? p.parsed.value : null;
  const t = v?.alarmTime ? v.alarmTime.getTime() : p.msg.receivedAt.getTime();
  return [t, v?.isClear ? 1 : 0, p.msg.receivedAt.getTime(), p.msg.gmailId];
}

function compare(a: Prepared, b: Prepared): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i]! < kb[i]!) return -1;
    if (ka[i]! > kb[i]!) return 1;
  }
  return 0;
}

export class MatchingEngine {
  private rules: RuleRecord[] | null = null;
  private readonly timeZone?: string;

  constructor(
    private readonly repo: AlarmRepository,
    opts: EngineOptions = {},
  ) {
    this.timeZone = opts.timeZone;
  }

  /** Process messages in §7 order. Returns outcome counts. */
  async processBatch(messages: readonly RawMessageInput[]): Promise<BatchSummary> {
    this.rules = await this.repo.loadRules();
    const prepared = messages
      .map((msg) => ({
        msg,
        parsed: parseMessage(msg.subject, msg.body, { timeZone: this.timeZone }),
      }))
      .sort(compare);

    const summary = emptySummary();
    for (const p of prepared) {
      const outcome = await this.processOne(p);
      summary[outcome]++;
      summary.total++;
    }
    return summary;
  }

  /** Rebuild everything derived from raw messages received in the last `days`. Deterministic. */
  async reprocess(days: number, now: Date = new Date()): Promise<BatchSummary> {
    const since = new Date(now.getTime() - days * 24 * 60 * MS_PER_MIN);
    await this.repo.resetWindow(since);
    return this.processBatch(await this.repo.rawMessagesSince(since));
  }

  private async processOne({ msg, parsed }: Prepared): Promise<Outcome> {
    if (!parsed.ok) {
      await this.repo.markProcessed(msg.id, parsed.error);
      return "parse_error";
    }
    const v = parsed.value;
    let outcome: Outcome;
    if (v.format !== "HASH") outcome = "ignored_format";
    else if (v.isClear) outcome = await this.handleClear(v, msg);
    else outcome = await this.handleAlarm(v, msg);
    await this.repo.markProcessed(msg.id, null);
    return outcome;
  }

  // §7 A
  private async handleAlarm(v: HashAlarm, msg: RawMessageInput): Promise<Outcome> {
    // A.1 duplicate: same CONSEC_NBR, or (no CONSEC_NBR) same key + time.
    const dup = v.consecNbr
      ? await this.repo.findAlarmByConsec(v.consecNbr)
      : await this.repo.findAlarm(v.alarmKey, v.alarmTime);
    if (dup) return "duplicate";

    const base: NewAlarm = {
      alarmKey: v.alarmKey,
      alarmName: v.alarmName,
      site: v.site,
      category: classify(v.alarmName, this.rules ?? []),
      alarmTime: v.alarmTime,
      status: "ACTIVE",
      clearTime: null,
      durationMin: null,
      clearType: null,
      consecNbr: v.consecNbr,
      cellName: v.cellName,
      device: v.device,
      office: msg.office ?? null,
    };

    // With CONSEC_NBR every alarm is independent (user rule 2026-10-11): same name + site at a
    // new time is a NEW alarm that only its own Clear closes — no AUTO_SUPERSEDED either way.
    const active = v.consecNbr
      ? []
      : (await this.repo.findActiveAlarms(v.alarmKey)).filter((a) => !a.consecNbr);
    const older = active.filter((a) => a.alarmTime < v.alarmTime);
    const newer = active.filter((a) => a.alarmTime > v.alarmTime);

    // Out-of-order: its Clear was already processed and parked as an orphan.
    const orphan = await this.findOrphanFor(v);
    if (orphan) {
      await this.repo.deleteOrphanClear(orphan.id);
      await this.supersede(older, v.alarmTime);
      await this.repo.createAlarm({
        ...base,
        status: "CLEARED",
        clearType: "EMAIL",
        clearTime: orphan.clearTime,
        durationMin: durationMinutes(v.alarmTime, orphan.clearTime),
      });
      return "created_cleared";
    }

    // Older alarm delivered after a newer one: it was already superseded.
    if (newer.length) {
      const next = newer.reduce((m, a) => (a.alarmTime < m.alarmTime ? a : m));
      await this.repo.createAlarm({
        ...base,
        status: "CLEARED",
        clearType: "AUTO_SUPERSEDED",
        clearTime: next.alarmTime,
        durationMin: durationMinutes(v.alarmTime, next.alarmTime),
      });
      return "created_superseded";
    }

    // A.2 supersede older active alarm(s), A.3 create
    await this.supersede(older, v.alarmTime);
    await this.repo.createAlarm(base);
    return older.length ? "superseded" : "created";
  }

  private async supersede(alarms: readonly AlarmRecord[], at: Date): Promise<void> {
    for (const a of alarms) {
      await this.repo.closeAlarm(a.id, {
        clearTime: at,
        clearType: "AUTO_SUPERSEDED",
        durationMin: durationMinutes(a.alarmTime, at),
      });
    }
  }

  // §7 B
  private async handleClear(v: HashAlarm, msg: RawMessageInput): Promise<Outcome> {
    const clearTime = msg.receivedAt; // §7 B.2: subject time is the ALARM time

    let target: AlarmRecord | undefined;
    if (v.consecNbr) {
      // Exact identity: the Clear carries its alarm's CONSEC_NBR. No fallback guessing.
      const a = await this.repo.findAlarmByConsec(v.consecNbr);
      if (a && a.status !== "ACTIVE") return "stale_clear";
      target = a ?? undefined;
    } else {
      const exact = await this.repo.findAlarm(v.alarmKey, v.alarmTime);
      if (exact) {
        if (exact.status !== "ACTIVE") return "stale_clear";
        target = exact;
      } else {
        const active = await this.repo.findActiveAlarms(v.alarmKey);
        target = active.reduce<AlarmRecord | undefined>(
          (m, a) => (!m || a.alarmTime > m.alarmTime ? a : m),
          undefined,
        );
      }
    }

    if (target) {
      await this.repo.closeAlarm(target.id, {
        clearTime,
        clearType: "EMAIL",
        durationMin: durationMinutes(target.alarmTime, clearTime),
      });
      return "cleared";
    }

    // B.3 never drop
    await this.repo.createOrphanClear({
      alarmKey: v.alarmKey,
      subject: msg.subject,
      clearTime,
      rawMessageId: msg.id,
      consecNbr: v.consecNbr,
      office: msg.office ?? null,
    });
    return "orphan";
  }

  private async findOrphanFor(v: HashAlarm): Promise<OrphanClearRecord | undefined> {
    const orphans = await this.repo.findOrphanClears(v.alarmKey);
    return orphans
      .filter((o) => {
        if (v.consecNbr || o.consecNbr) return o.consecNbr === v.consecNbr;
        const p = parseMessage(o.subject, null, { timeZone: this.timeZone });
        return p.ok && p.value.alarmTime?.getTime() === v.alarmTime.getTime();
      })
      .sort((a, b) => a.clearTime.getTime() - b.clearTime.getTime() || a.id - b.id)[0];
  }
}

function emptySummary(): BatchSummary {
  return {
    total: 0,
    parse_error: 0,
    ignored_format: 0,
    duplicate: 0,
    created: 0,
    created_cleared: 0,
    created_superseded: 0,
    superseded: 0,
    cleared: 0,
    stale_clear: 0,
    orphan: 0,
  };
}

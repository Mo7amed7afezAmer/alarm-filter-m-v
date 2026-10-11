// In-memory AlarmRepository — reference implementation used by tests. No I/O.
import type { RuleRecord } from "./classify.js";
import type {
  AlarmRecord,
  AlarmRepository,
  ClosePatch,
  NewAlarm,
  OrphanClearRecord,
  RawMessageInput,
} from "./engine.js";

export interface MemoryRawMessage extends RawMessageInput {
  parseError: string | null;
  processed: boolean;
}

export class MemoryAlarmRepository implements AlarmRepository {
  alarms: AlarmRecord[] = [];
  orphans: OrphanClearRecord[] = [];
  raw: MemoryRawMessage[] = [];
  private nextAlarmId = 1;
  private nextOrphanId = 1;

  constructor(public rules: RuleRecord[] = []) {}

  /** Test helper: store a raw message (as the worker's Gmail sync would). */
  addRaw(msg: Omit<RawMessageInput, "id"> & { id?: number }): RawMessageInput {
    const stored: MemoryRawMessage = {
      id: msg.id ?? this.raw.length + 1,
      gmailId: msg.gmailId,
      subject: msg.subject,
      receivedAt: msg.receivedAt,
      body: msg.body ?? null,
      parseError: null,
      processed: false,
    };
    this.raw.push(stored);
    return stored;
  }

  async loadRules() {
    return [...this.rules];
  }

  async findAlarm(alarmKey: string, alarmTime: Date) {
    const a = this.alarms.find(
      (x) => x.alarmKey === alarmKey && x.alarmTime.getTime() === alarmTime.getTime(),
    );
    return a ? { ...a } : null;
  }

  async findAlarmByConsec(consecNbr: string) {
    const a = this.alarms.find((x) => x.consecNbr === consecNbr);
    return a ? { ...a } : null;
  }

  async findActiveAlarms(alarmKey: string) {
    return this.alarms
      .filter((x) => x.alarmKey === alarmKey && x.status === "ACTIVE")
      .map((x) => ({ ...x }));
  }

  async createAlarm(alarm: NewAlarm) {
    // Mirrors the DB: consecNbr is unique when present.
    if (alarm.consecNbr && this.alarms.some((x) => x.consecNbr === alarm.consecNbr)) {
      throw new Error("unique violation (consecNbr)");
    }
    const rec = { ...alarm, id: this.nextAlarmId++ };
    this.alarms.push(rec);
    return { ...rec };
  }

  async closeAlarm(id: number, patch: ClosePatch) {
    const a = this.alarms.find((x) => x.id === id);
    if (!a) throw new Error(`alarm ${id} not found`);
    Object.assign(a, { status: "CLEARED", ...patch });
  }

  async findOrphanClears(alarmKey: string) {
    return this.orphans.filter((o) => o.alarmKey === alarmKey).map((o) => ({ ...o }));
  }

  async createOrphanClear(orphan: Omit<OrphanClearRecord, "id">) {
    this.orphans.push({ ...orphan, id: this.nextOrphanId++ });
  }

  async deleteOrphanClear(id: number) {
    this.orphans = this.orphans.filter((o) => o.id !== id);
  }

  async markProcessed(rawMessageId: number, parseError: string | null) {
    const r = this.raw.find((x) => x.id === rawMessageId);
    if (r) {
      r.processed = true;
      r.parseError = parseError;
    }
  }

  async resetWindow(since: Date) {
    this.alarms = this.alarms.filter((a) => a.alarmTime < since);
    for (const a of this.alarms) {
      if (a.clearTime && a.clearTime >= since) {
        Object.assign(a, { status: "ACTIVE", clearTime: null, clearType: null, durationMin: null });
      }
    }
    const inWindow = new Set(this.raw.filter((r) => r.receivedAt >= since).map((r) => r.id));
    this.orphans = this.orphans.filter((o) => !inWindow.has(o.rawMessageId));
  }

  async rawMessagesSince(since: Date) {
    return this.raw
      .filter((r) => r.receivedAt >= since)
      .map(({ id, gmailId, subject, receivedAt, body }) => ({
        id,
        gmailId,
        subject,
        receivedAt,
        body,
      }));
  }
}

// Prisma implementation of the engine's AlarmRepository (packages/core/src/engine.ts).
// Pass a transaction client so a whole batch commits or rolls back together.
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  AlarmRecord,
  AlarmRepository,
  ClosePatch,
  NewAlarm,
  OrphanClearRecord,
  RawMessageInput,
  RuleRecord,
} from "@alarm/core";

type Db = PrismaClient | Prisma.TransactionClient;

const alarmSelect = {
  id: true,
  alarmKey: true,
  alarmName: true,
  site: true,
  category: true,
  alarmTime: true,
  status: true,
  clearTime: true,
  durationMin: true,
  clearType: true,
} as const;

export class PrismaAlarmRepository implements AlarmRepository {
  constructor(private readonly db: Db) {}

  async loadRules(): Promise<RuleRecord[]> {
    return this.db.rule.findMany({
      select: { pattern: true, category: true, priority: true },
      orderBy: [{ priority: "asc" }, { id: "asc" }],
    });
  }

  async findAlarm(alarmKey: string, alarmTime: Date): Promise<AlarmRecord | null> {
    return this.db.alarm.findUnique({
      where: { alarmKey_alarmTime: { alarmKey, alarmTime } },
      select: alarmSelect,
    });
  }

  async findActiveAlarms(alarmKey: string): Promise<AlarmRecord[]> {
    return this.db.alarm.findMany({
      where: { alarmKey, status: "ACTIVE" },
      select: alarmSelect,
      orderBy: { alarmTime: "asc" },
    });
  }

  async createAlarm(alarm: NewAlarm): Promise<AlarmRecord> {
    return this.db.alarm.create({ data: alarm, select: alarmSelect });
  }

  async closeAlarm(id: number, patch: ClosePatch): Promise<void> {
    await this.db.alarm.update({ where: { id }, data: { status: "CLEARED", ...patch } });
  }

  async findOrphanClears(alarmKey: string): Promise<OrphanClearRecord[]> {
    return this.db.orphanClear.findMany({ where: { alarmKey }, orderBy: { id: "asc" } });
  }

  async createOrphanClear(orphan: Omit<OrphanClearRecord, "id">): Promise<void> {
    await this.db.orphanClear.create({ data: orphan });
  }

  async deleteOrphanClear(id: number): Promise<void> {
    await this.db.orphanClear.delete({ where: { id } });
  }

  async markProcessed(rawMessageId: number, parseError: string | null): Promise<void> {
    await this.db.rawMessage.update({
      where: { id: rawMessageId },
      data: { processedAt: new Date(), parseError },
    });
  }

  async resetWindow(since: Date): Promise<void> {
    await this.db.alarm.deleteMany({ where: { alarmTime: { gte: since } } });
    await this.db.alarm.updateMany({
      where: { clearTime: { gte: since } },
      data: { status: "ACTIVE", clearTime: null, clearType: null, durationMin: null },
    });
    await this.db.orphanClear.deleteMany({ where: { rawMessage: { receivedAt: { gte: since } } } });
  }

  async rawMessagesSince(since: Date): Promise<RawMessageInput[]> {
    return this.db.rawMessage.findMany({
      where: { receivedAt: { gte: since } },
      select: { id: true, gmailId: true, subject: true, receivedAt: true },
      orderBy: { receivedAt: "asc" },
    });
  }
}

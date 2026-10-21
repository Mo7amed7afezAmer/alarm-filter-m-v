// Worker configuration from environment variables.

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

export const config = {
  alarmTz: process.env.ALARM_TZ || "Africa/Cairo",
  gmailQuery: process.env.GMAIL_QUERY?.trim() || undefined,
  /** Parent labels whose children are offices ("DN/Tanta"): a message's office is its first
   *  label under one of them. The worker always reads the whole mailbox. */
  officeParents: (process.env.OFFICE_LABEL_PARENTS ?? "DN,DS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  tokenPath: process.env.GOOGLE_TOKEN_PATH || "/app/secrets/token.json",
  credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || "/app/secrets/credentials.json",
  cron: process.env.WORKER_CRON || "* * * * *",
  healthPort: int("WORKER_HEALTH_PORT", 4000),
  /** §7 C: at most this many new messages fetched per run. */
  maxPerRun: int("MAX_MESSAGES_PER_RUN", 200),
  /** First run / expired historyId: look back this far with messages.list. */
  backfillHours: int("INITIAL_BACKFILL_HOURS", 24),
  /** /health reports unhealthy when the last run is older than this. */
  staleAfterSec: int("HEALTH_STALE_AFTER_SEC", 300),
};

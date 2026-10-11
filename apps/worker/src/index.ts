// Long-running worker: node-cron every minute, one run at a time, /health on :4000.
import cron from "node-cron";
import { PrismaClient } from "@alarm/db";
import { config } from "./config.js";
import { createGmailSource } from "./gmail.js";
import { startHealthServer, type HealthState } from "./health.js";
import { recordError, runOnce } from "./run.js";

const log = (msg: string) => console.log(`${new Date().toISOString()} [worker] ${msg}`);

const prisma = new PrismaClient();
const source = createGmailSource(config.credentialsPath, config.tokenPath, {
  labels: config.gmailLabels,
});
const state: HealthState = { startedAt: new Date(), running: false };

async function tick() {
  if (state.running) {
    log("previous run still in progress, skipping");
    return;
  }
  state.running = true;
  const started = Date.now();
  try {
    const r = await runOnce({
      prisma,
      source,
      timeZone: config.alarmTz,
      maxPerRun: config.maxPerRun,
      backfillHours: config.backfillHours,
      query: config.gmailQuery,
      defaultLabels: config.gmailLabels,
      officeParents: config.officeParents,
      log,
    });
    const p = r.processed;
    log(
      `run ok in ${Date.now() - started}ms office=${r.office ?? "(all)"} mode=${r.mode} fetched=${r.fetched} backlog=${r.backlog} ` +
        `processed=${p.total} created=${p.created + p.superseded} cleared=${p.cleared + p.created_cleared} ` +
        `orphan=${p.orphan} dup=${p.duplicate} huawei=${p.ignored_format} parse_errors=${p.parse_error}`,
    );
  } catch (err) {
    log(`run FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    await recordError(prisma, err).catch((e) => log(`could not record error: ${e}`));
  } finally {
    state.running = false;
  }
}

const server = startHealthServer(prisma, state, config.healthPort, config.staleAfterSec);
const task = cron.schedule(config.cron, () => void tick());
log(
  `started: cron="${config.cron}" tz=${config.alarmTz} labels=${config.gmailLabels.join(",") || "(all mail)"} max/run=${config.maxPerRun} health=:${config.healthPort}`,
);
void tick();

async function shutdown(signal: string) {
  log(`${signal} received, shutting down`);
  task.stop();
  server.close();
  const deadline = Date.now() + 25_000;
  while (state.running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

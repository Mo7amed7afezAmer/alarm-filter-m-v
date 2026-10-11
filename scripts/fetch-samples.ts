/**
 * Fetch the last N message subjects + dates for parser development.
 * Writes samples/subjects.txt as "ISO date | subject", oldest first.
 *
 *   corepack pnpm gmail:samples            # N = 300
 *   SAMPLE_COUNT=500 corepack pnpm gmail:samples
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gmail as gmailApi } from "@googleapis/gmail";
import { authorizedClient, loadDotEnv, ROOT } from "./lib/google.js";

loadDotEnv();

const COUNT = Number(process.env.SAMPLE_COUNT ?? 300);
const QUERY = process.env.GMAIL_QUERY?.trim() || undefined;
const CONCURRENCY = 10;
const OUT = path.join(ROOT, "samples", "subjects.txt");

const gmail = gmailApi({ version: "v1", auth: authorizedClient() });

async function listIds(): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: QUERY,
      maxResults: Math.min(500, COUNT - ids.length),
      pageToken,
    });
    for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < COUNT);
  return ids.slice(0, COUNT);
}

async function getMeta(id: string): Promise<{ date: Date; subject: string }> {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["Subject"],
  });
  const subject = data.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "";
  return { date: new Date(Number(data.internalDate)), subject: subject.replace(/\s*\r?\n\s*/g, " ") };
}

async function main() {
  console.log(`Listing up to ${COUNT} messages${QUERY ? ` matching "${QUERY}"` : ""} ...`);
  const ids = await listIds();

  const rows: { date: Date; subject: string }[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    rows.push(...(await Promise.all(ids.slice(i, i + CONCURRENCY).map(getMeta))));
    process.stdout.write(`\rFetched ${rows.length}/${ids.length}`);
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, rows.map((r) => `${r.date.toISOString()} | ${r.subject}`).join("\n") + "\n");
  console.log(`\nWrote ${rows.length} lines to ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

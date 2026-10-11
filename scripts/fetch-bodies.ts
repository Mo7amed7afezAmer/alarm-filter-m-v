/**
 * Fetch recent messages WITH their plain-text bodies (for body-format analysis).
 * Writes samples/bodies.jsonl: {id, receivedAt, subject, body} per line, newest first.
 *
 *   SAMPLE_QUERY="label:dn-kafr-eldawar" SAMPLE_COUNT=200 corepack pnpm gmail:bodies
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import { authorizedClient, loadDotEnv, ROOT } from "./lib/google.js";

loadDotEnv();

const COUNT = Number(process.env.SAMPLE_COUNT ?? 200);
const QUERY = process.env.SAMPLE_QUERY?.trim() || process.env.GMAIL_QUERY?.trim() || undefined;
const OUT = path.join(ROOT, "samples", "bodies.jsonl");
// Gentle: messages.get(full) costs quota shared with the running worker.
const CONCURRENCY = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getFull(id: string, attempt = 0): Promise<gmail_v1.Schema$Message> {
  try {
    return (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if ((code === 429 || code === 403) && attempt < 5) {
      await sleep(15_000 * (attempt + 1));
      return getFull(id, attempt + 1);
    }
    throw err;
  }
}

const gmail = gmailApi({ version: "v1", auth: authorizedClient() });

function decode(data?: string | null): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

/** Prefer text/plain; fall back to text/html with tags stripped. */
export function extractText(part?: gmail_v1.Schema$MessagePart): string {
  if (!part) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(part);
  if (plain.length) return plain.join("\n");
  return html
    .join("\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function main() {
  console.log(`Listing up to ${COUNT} messages${QUERY ? ` matching "${QUERY}"` : ""} ...`);
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

  const rows: string[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const msgs = await Promise.all(ids.slice(i, i + CONCURRENCY).map((id) => getFull(id)));
    await sleep(500);
    for (const data of msgs) {
      rows.push(
        JSON.stringify({
          id: data.id,
          receivedAt: new Date(Number(data.internalDate)).toISOString(),
          subject: data.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "",
          body: extractText(data.payload ?? undefined),
        }),
      );
    }
    process.stdout.write(`\rFetched ${rows.length}/${ids.length}`);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, rows.join("\n") + "\n");
  console.log(`\nWrote ${rows.length} messages to ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

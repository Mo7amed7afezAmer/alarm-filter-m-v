// Gmail access for the worker (read-only). token.json is mounted read-only; refreshed access
// tokens live in memory only — the refresh_token is all that needs to persist.
import { readFileSync } from "node:fs";
import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";

export interface MessageMeta {
  gmailId: string;
  subject: string;
  receivedAt: Date;
  /** Plain-text body (alarm details: CONSEC_NBR, cell name, …). */
  body: string;
}

/** What the sync logic needs from Gmail — faked in tests. */
export interface MailSource {
  /** Message ids added since `startHistoryId` (oldest first) and the latest historyId, or
   *  "expired" when Gmail no longer has that history (HTTP 404). */
  historySince(startHistoryId: string): Promise<{ ids: string[]; historyId: string } | "expired">;
  /** Current mailbox historyId (users.getProfile). */
  currentHistoryId(): Promise<string>;
  /** Ids of messages received after `after` matching `query`, oldest first. */
  listSince(after: Date, query?: string): Promise<string[]>;
  /** Subject + internalDate + body, or null if the message no longer exists. */
  getMeta(id: string): Promise<MessageMeta | null>;
  /** Switch the labels to read (office change). */
  useLabels?(labels: string[]): void;
  /** User label names under the given parents, e.g. ["DN/Tanta", "DS/Benha"]. */
  listLabels?(parents: string[]): Promise<string[]>;
}

export interface GmailSourceOptions {
  /** Gmail label names to read (as typed in search, e.g. "dn-kafr-eldawar", or the display name
   *  "DN/Kafr ElDawar"). Empty = whole mailbox. */
  labels?: string[];
}

function status(err: unknown): number | undefined {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  return e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
}

/** Gmail search form of a label name: "DN/Kafr ElDawar" → "dn-kafr-eldawar". */
export function labelSearchName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s/&]+/g, "-");
}

function decode(data?: string | null): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

/** Prefer text/plain parts; fall back to text/html with tags stripped. */
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

export function createGmailSource(
  credentialsPath: string,
  tokenPath: string,
  opts: GmailSourceOptions = {},
): MailSource {
  const creds = JSON.parse(readFileSync(credentialsPath, "utf8")) as {
    installed?: { client_id: string; client_secret: string };
  };
  if (!creds.installed) throw new Error("credentials.json is not a Desktop-app OAuth client");
  const auth = new OAuth2Client({
    clientId: creds.installed.client_id,
    clientSecret: creds.installed.client_secret,
  });
  auth.setCredentials(JSON.parse(readFileSync(tokenPath, "utf8")));
  const gmail: gmail_v1.Gmail = gmailApi({ version: "v1", auth });
  let wanted = (opts.labels ?? []).map(labelSearchName).filter(Boolean);

  // Label names → ids, resolved once (lazily) and cached.
  let labelIds: Promise<string[] | null> | null = null;
  const resolveLabels = () =>
    (labelIds ??= (async () => {
      if (!wanted.length) return null;
      const { data } = await gmail.users.labels.list({ userId: "me" });
      const byName = new Map(
        (data.labels ?? []).map((l) => [labelSearchName(l.name ?? ""), l.id!]),
      );
      const missing = wanted.filter((w) => !byName.has(w));
      if (missing.length) {
        labelIds = null; // retry next run (label may be created later)
        throw new Error(`Gmail label(s) not found: ${missing.join(", ")}`);
      }
      return wanted.map((w) => byName.get(w)!);
    })());

  async function historyFor(startHistoryId: string, labelId?: string) {
    const ids: string[] = [];
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    do {
      const { data } = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        labelId,
        // labelAdded too: a label applied by a filter/user after delivery.
        historyTypes: ["messageAdded", "labelAdded"],
        maxResults: 500,
        pageToken,
      });
      for (const h of data.history ?? []) {
        const msgs = [
          ...(h.messagesAdded ?? []).map((m) => m.message),
          ...(h.labelsAdded ?? [])
            .filter((l) => !labelId || l.labelIds?.includes(labelId))
            .map((l) => l.message),
        ];
        for (const m of msgs) {
          const labels = m?.labelIds ?? [];
          if (m?.id && !labels.includes("DRAFT") && !labels.includes("SENT")) ids.push(m.id);
        }
      }
      if (data.historyId) historyId = data.historyId;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return { ids, historyId };
  }

  return {
    useLabels(labels) {
      const next = labels.map(labelSearchName).filter(Boolean);
      if (next.join(",") !== wanted.join(",")) {
        wanted = next;
        labelIds = null; // re-resolve ids for the new labels
      }
    },

    async listLabels(parents) {
      const { data } = await gmail.users.labels.list({ userId: "me" });
      const prefixes = parents.map((p) => p.toLowerCase() + "/");
      return (data.labels ?? [])
        .filter((l) => l.type === "user" && l.name)
        .map((l) => l.name!)
        .filter((n) => !prefixes.length || prefixes.some((p) => n.toLowerCase().startsWith(p)))
        .sort((a, b) => a.localeCompare(b));
    },

    async historySince(startHistoryId) {
      try {
        const ids = await resolveLabels();
        const parts = ids
          ? await Promise.all(ids.map((id) => historyFor(startHistoryId, id)))
          : [await historyFor(startHistoryId)];
        const seen = new Set<string>();
        const merged: string[] = [];
        for (const p of parts)
          for (const id of p.ids) if (!seen.has(id) && seen.add(id)) merged.push(id);
        const historyId = parts
          .map((p) => p.historyId)
          .reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a));
        return { ids: merged, historyId };
      } catch (err) {
        if (status(err) === 404) return "expired";
        throw err;
      }
    },

    async currentHistoryId() {
      const { data } = await gmail.users.getProfile({ userId: "me" });
      if (!data.historyId) throw new Error("Gmail profile returned no historyId");
      return data.historyId;
    },

    async listSince(after, query) {
      await resolveLabels(); // fail fast on a misspelt label
      const labelQ = wanted.length
        ? `(${wanted.map((w) => `label:${w}`).join(" OR ")})`
        : undefined;
      const q = [`after:${Math.floor(after.getTime() / 1000)}`, labelQ, query]
        .filter(Boolean)
        .join(" ");
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const { data } = await gmail.users.messages.list({
          userId: "me",
          q,
          maxResults: 500,
          pageToken,
        });
        for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
      return ids.reverse(); // Gmail lists newest first
    },

    async getMeta(id) {
      try {
        const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
        const subject = data.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "";
        return {
          gmailId: id,
          subject: subject.replace(/\s*\r?\n\s*/g, " ").trim(),
          receivedAt: new Date(Number(data.internalDate)),
          body: extractText(data.payload ?? undefined).slice(0, 20_000),
        };
      } catch (err) {
        if (status(err) === 404) return null; // deleted between listing and fetching
        throw err;
      }
    },
  };
}

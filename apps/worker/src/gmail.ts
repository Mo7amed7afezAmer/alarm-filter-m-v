// Gmail access for the worker (read-only). The OAuth client + refresh token come from
// `loadAuth` (gmail_account row from /settings/gmail, else credentials.json / token.json);
// refreshed access tokens live in memory only. A changed token is picked up on the next run.
// Reads the WHOLE mailbox (inbox + every label); each message's labels are returned by name.
import type { GmailAuth } from "@alarm/db";
import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";

export interface MessageMeta {
  gmailId: string;
  subject: string;
  receivedAt: Date;
  /** Plain-text body (alarm details: CONSEC_NBR, cell name, …). */
  body: string;
  /** Label display names ("INBOX", "DN/Kafr ElDawar", …), without noise labels (UNREAD, …). */
  labels: string[];
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
  /** User label names under the given parents, e.g. ["DN/Tanta", "DS/Benha"]. */
  listLabels?(parents: string[]): Promise<string[]>;
  /** Reload the OAuth material (called at the start of every run). */
  prepare?(): Promise<void>;
}

function status(err: unknown): number | undefined {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  return e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
}

/** Messages carrying one of these are never read. */
const SKIP_LABELS = new Set(["DRAFT", "SENT", "SPAM", "TRASH"]);

/** System labels that say nothing about where a message belongs. */
const NOISE_LABELS = new Set(["UNREAD", "IMPORTANT", "STARRED", "CHAT"]);

/** Label ids → names (ids not in the map are kept as-is), noise and CATEGORY_* dropped. */
export function labelNames(ids: readonly string[], names: ReadonlyMap<string, string>): string[] {
  return [
    ...new Set(
      ids
        .filter((id) => !NOISE_LABELS.has(id) && !id.startsWith("CATEGORY_"))
        .map((id) => names.get(id) ?? id),
    ),
  ];
}

/** Office of a message: its first label under one of the office parents ("DN", "DS"). */
export function officeOfLabels(labels: readonly string[], parents: readonly string[]): string | null {
  const prefixes = parents.map((p) => p.toLowerCase() + "/");
  return (
    [...labels]
      .sort((a, b) => a.localeCompare(b))
      .find((l) => prefixes.some((p) => l.toLowerCase().startsWith(p))) ?? null
  );
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

export function createGmailSource(loadAuth: () => Promise<GmailAuth>): MailSource {
  // Label id → display name, loaded lazily; reloaded when a message carries an unknown id.
  let labelMap: Promise<Map<string, string>> | null = null;
  let client: gmail_v1.Gmail | null = null;
  let version: string | null = null;
  /** Rebuilds the Gmail client when the stored token / OAuth client changed. */
  async function prepare() {
    const auth = await loadAuth();
    if (client && auth.version === version) return;
    const oauth = new OAuth2Client({
      clientId: auth.client.clientId,
      clientSecret: auth.client.clientSecret,
    });
    oauth.setCredentials(auth.credentials);
    client = gmailApi({ version: "v1", auth: oauth });
    version = auth.version;
    labelMap = null; // another mailbox has other label ids
  }
  const api = async (): Promise<gmail_v1.Gmail> => {
    if (!client) await prepare();
    return client!;
  };
  const loadLabelMap = () =>
    (labelMap ??= (async () => {
      const { data } = await (await api()).users.labels.list({ userId: "me" });
      return new Map((data.labels ?? []).map((l) => [l.id!, l.name ?? l.id!]));
    })().catch((err) => {
      labelMap = null;
      throw err;
    }));

  async function namesOf(ids: string[]): Promise<string[]> {
    let map = await loadLabelMap();
    if (ids.some((id) => !map.has(id))) {
      labelMap = null; // a label created since the last load
      map = await loadLabelMap();
    }
    return labelNames(ids, map);
  }

  async function historyFor(startHistoryId: string) {
    const ids: string[] = [];
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    do {
      const { data } = await (await api()).users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });
      for (const h of data.history ?? []) {
        for (const { message: m } of h.messagesAdded ?? []) {
          const labels = m?.labelIds ?? [];
          if (m?.id && !labels.some((l) => SKIP_LABELS.has(l))) ids.push(m.id);
        }
      }
      if (data.historyId) historyId = data.historyId;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return { ids, historyId };
  }

  return {
    prepare,

    async listLabels(parents) {
      const { data } = await (await api()).users.labels.list({ userId: "me" });
      const prefixes = parents.map((p) => p.toLowerCase() + "/");
      return (data.labels ?? [])
        .filter((l) => l.type === "user" && l.name)
        .map((l) => l.name!)
        .filter((n) => !prefixes.length || prefixes.some((p) => n.toLowerCase().startsWith(p)))
        .sort((a, b) => a.localeCompare(b));
    },

    async historySince(startHistoryId) {
      try {
        const { ids, historyId } = await historyFor(startHistoryId);
        return { ids: [...new Set(ids)], historyId };
      } catch (err) {
        if (status(err) === 404) return "expired";
        throw err;
      }
    },

    async currentHistoryId() {
      const { data } = await (await api()).users.getProfile({ userId: "me" });
      if (!data.historyId) throw new Error("Gmail profile returned no historyId");
      return data.historyId;
    },

    async listSince(after, query) {
      // No label filter: inbox, archived and every label (spam/trash are excluded by default).
      const q = [`after:${Math.floor(after.getTime() / 1000)}`, "-in:sent -in:drafts", query]
        .filter(Boolean)
        .join(" ");
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const { data } = await (await api()).users.messages.list({
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
        const { data } = await (await api()).users.messages.get({ userId: "me", id, format: "full" });
        const subject = data.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "";
        return {
          gmailId: id,
          subject: subject.replace(/\s*\r?\n\s*/g, " ").trim(),
          receivedAt: new Date(Number(data.internalDate)),
          body: extractText(data.payload ?? undefined).slice(0, 20_000),
          labels: await namesOf(data.labelIds ?? []),
        };
      } catch (err) {
        if (status(err) === 404) return null; // deleted between listing and fetching
        throw err;
      }
    },
  };
}

// Gmail access for the worker (read-only). token.json is mounted read-only; refreshed access
// tokens live in memory only — the refresh_token is all that needs to persist.
import { readFileSync } from "node:fs";
import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";

export interface MessageMeta {
  gmailId: string;
  subject: string;
  receivedAt: Date;
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
  /** Subject + internalDate, or null if the message no longer exists. */
  getMeta(id: string): Promise<MessageMeta | null>;
}

function status(err: unknown): number | undefined {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  return e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
}

export function createGmailSource(credentialsPath: string, tokenPath: string): MailSource {
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

  return {
    async historySince(startHistoryId) {
      const ids: string[] = [];
      const seen = new Set<string>();
      let pageToken: string | undefined;
      let historyId = startHistoryId;
      try {
        do {
          const { data } = await gmail.users.history.list({
            userId: "me",
            startHistoryId,
            historyTypes: ["messageAdded"],
            maxResults: 500,
            pageToken,
          });
          for (const h of data.history ?? []) {
            for (const added of h.messagesAdded ?? []) {
              const id = added.message?.id;
              const labels = added.message?.labelIds ?? [];
              if (id && !seen.has(id) && !labels.includes("DRAFT") && !labels.includes("SENT")) {
                seen.add(id);
                ids.push(id);
              }
            }
          }
          if (data.historyId) historyId = data.historyId;
          pageToken = data.nextPageToken ?? undefined;
        } while (pageToken);
      } catch (err) {
        if (status(err) === 404) return "expired";
        throw err;
      }
      return { ids, historyId };
    },

    async currentHistoryId() {
      const { data } = await gmail.users.getProfile({ userId: "me" });
      if (!data.historyId) throw new Error("Gmail profile returned no historyId");
      return data.historyId;
    },

    async listSince(after, query) {
      const q = [`after:${Math.floor(after.getTime() / 1000)}`, query].filter(Boolean).join(" ");
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
        const { data } = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject"],
        });
        const subject = data.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "";
        return {
          gmailId: id,
          subject: subject.replace(/\s*\r?\n\s*/g, " ").trim(),
          receivedAt: new Date(Number(data.internalDate)),
        };
      } catch (err) {
        if (status(err) === 404) return null; // deleted between listing and fetching
        throw err;
      }
    },
  };
}

// Gmail access for hourly reports (§14): list "Hourly Update" mails with an attachment and
// download one attachment on demand. Same Gmail account as the worker: the one connected in
// /settings/gmail (gmail_account row), else token.json + credentials.json (gmail.readonly).
// Server-only.
//
// The attachment is usually a .rar, sometimes the plain .xlsx — both are processed.
//
// HOURLY_GMAIL_MOCK_DIR=<dir> replaces Gmail with the .rar / .xlsx files in that directory (local
// demo, Playwright smoke test). Tests can inject any source with setHourlySource().

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import { loadGmailAuth, type GmailAuth } from "@alarm/db";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "./db";

export interface HourlyReportInfo {
  gmailId: string;
  receivedAt: string;
  sender: string;
  subject: string;
  fileName: string;
  fileSize: number;
}

export interface HourlyListQuery {
  from?: Date;
  to?: Date;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface HourlySource {
  /** Newest first. Never downloads attachments. */
  list(q: HourlyListQuery): Promise<{ reports: HourlyReportInfo[]; hasMore: boolean }>;
  /** Metadata of one report, or null when the message does not exist / has no attachment. */
  get(gmailId: string): Promise<HourlyReportInfo | null>;
  getAttachment(gmailId: string): Promise<{ fileName: string; data: Buffer }>;
}

export class NotFoundError extends Error {}

// ---------------------------------------------------------------- Gmail

/** Gmail search form of a label name: "Hourly Update" → "hourly-update". */
const labelSearchName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s/&]+/g, "-");

function firstExisting(...paths: (string | undefined)[]): string | undefined {
  return paths.find((p) => p && existsSync(p)) ?? undefined;
}

/** Where the OAuth files may live: env, Docker secrets mount, repo root (local dev). */
export function gmailFiles(): { credentialsPath?: string; tokenPath?: string } {
  const root = path.resolve(process.cwd(), "../..");
  return {
    credentialsPath: firstExisting(
      process.env.GOOGLE_CREDENTIALS_PATH,
      "/app/secrets/credentials.json",
      path.join(root, "credentials.json"),
    ),
    tokenPath: firstExisting(
      process.env.GOOGLE_TOKEN_PATH,
      "/app/secrets/token.json",
      path.join(root, "token.json"),
    ),
  };
}

/** A Gmail API client for an OAuth client + token. */
export function gmailFor(auth: Pick<GmailAuth, "client" | "credentials">): gmail_v1.Gmail {
  const oauth = new OAuth2Client({
    clientId: auth.client.clientId,
    clientSecret: auth.client.clientSecret,
  });
  oauth.setCredentials(auth.credentials);
  return gmailApi({ version: "v1", auth: oauth });
}

let current: { version: string; gmail: gmail_v1.Gmail } | null = null;
/** Gmail client of the connected account; rebuilt when the stored token changes. */
async function connectedGmail(): Promise<gmail_v1.Gmail> {
  const auth = await loadGmailAuth(prisma, gmailFiles());
  if (current?.version !== auth.version) current = { version: auth.version, gmail: gmailFor(auth) };
  return current.gmail;
}

const header = (m: gmail_v1.Schema$Message, name: string) =>
  m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

/** The report attachment: a .rar first, else an .xlsx, else the first attachment. */
function attachmentOf(m: gmail_v1.Schema$Message) {
  const parts: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p?: gmail_v1.Schema$MessagePart) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) parts.push(p);
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  return (
    parts.find((p) => /\.rar$/i.test(p.filename!)) ??
    parts.find((p) => /\.xlsx$/i.test(p.filename!)) ??
    parts[0] ??
    null
  );
}

function toInfo(m: gmail_v1.Schema$Message): HourlyReportInfo | null {
  const a = attachmentOf(m);
  if (!m.id || !a) return null;
  return {
    gmailId: m.id,
    receivedAt: new Date(Number(m.internalDate ?? 0)).toISOString(),
    sender: header(m, "From"),
    subject: header(m, "Subject"),
    fileName: a.filename!,
    fileSize: a.body?.size ?? 0,
  };
}

export function createGmailHourlySource(): HourlySource {
  const label = labelSearchName(process.env.HOURLY_GMAIL_LABEL || "Hourly Update");

  // Message metadata never changes → cache it (bounded).
  const meta = new Map<string, HourlyReportInfo | null>();
  const getMeta = async (id: string) => {
    if (meta.has(id)) return meta.get(id)!;
    let info: HourlyReportInfo | null = null;
    try {
      const { data } = await (await connectedGmail()).users.messages.get({
        userId: "me",
        id,
        format: "full",
        fields: "id,internalDate,payload(headers,filename,body(size,attachmentId),parts)",
      });
      info = toInfo(data);
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
    if (meta.size > 1000) meta.delete(meta.keys().next().value!);
    meta.set(id, info);
    return info;
  };

  // Gmail pages by token: remember the token for each page of each query.
  const pageTokens = new Map<string, (string | undefined)[]>();

  return {
    async list({ from, to, page, pageSize }) {
      const q = [
        `label:${label}`,
        "has:attachment",
        from && `after:${Math.floor(from.getTime() / 1000)}`,
        to && `before:${Math.floor(to.getTime() / 1000)}`,
      ]
        .filter(Boolean)
        .join(" ");
      const key = `${q}|${pageSize}`;
      const tokens = pageTokens.get(key) ?? [undefined];
      pageTokens.set(key, tokens);
      // walk forward to the requested page if we have not seen its token yet
      for (let p = tokens.length; p < page; p++) {
        const { data } = await (await connectedGmail()).users.messages.list({
          userId: "me",
          q,
          maxResults: pageSize,
          pageToken: tokens[p - 1],
          fields: "nextPageToken",
        });
        if (!data.nextPageToken) return { reports: [], hasMore: false };
        tokens[p] = data.nextPageToken;
      }
      const { data } = await (await connectedGmail()).users.messages.list({
        userId: "me",
        q,
        maxResults: pageSize,
        pageToken: tokens[page - 1],
      });
      if (data.nextPageToken) tokens[page] = data.nextPageToken;
      const infos = await Promise.all((data.messages ?? []).map((m) => getMeta(m.id!)));
      return {
        reports: infos.filter((i): i is HourlyReportInfo => !!i),
        hasMore: !!data.nextPageToken,
      };
    },

    get: getMeta,

    async getAttachment(gmailId) {
      // fresh fetch: attachment ids are only guaranteed for the response they came in
      const { data: m } = await (await connectedGmail()).users.messages
        .get({ userId: "me", id: gmailId, format: "full" })
        .catch((err) => {
          if ((err as { code?: number }).code === 404) throw new NotFoundError("Report not found");
          throw err;
        });
      const a = attachmentOf(m);
      if (!a) throw new NotFoundError("Message has no attachment");
      const { data } = await (await connectedGmail()).users.messages.attachments.get({
        userId: "me",
        messageId: gmailId,
        id: a.body!.attachmentId!,
      });
      return { fileName: a.filename!, data: Buffer.from(data.data ?? "", "base64url") };
    },
  };
}

// ---------------------------------------------------------------- mock (local files)

/** Every .rar / .xlsx in `dir` is a report; gmailId = "mock-" + file name slug, time = file mtime. */
export function createDirHourlySource(dir: string): HourlySource {
  const scan = async () => {
    const out: (HourlyReportInfo & { path: string })[] = [];
    for (const name of await readdir(dir)) {
      if (!/\.(rar|xlsx)$/i.test(name)) continue;
      const p = path.join(dir, name);
      const st = await stat(p);
      out.push({
        gmailId: "mock-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-rar$/, ""),
        receivedAt: st.mtime.toISOString(),
        sender: "Hourly Update (local files) <mock@localhost>",
        subject: `Hourly Update — ${name}`,
        fileName: name,
        fileSize: st.size,
        path: p,
      });
    }
    return out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  };
  const strip = (r: HourlyReportInfo & { path: string }): HourlyReportInfo => ({
    gmailId: r.gmailId,
    receivedAt: r.receivedAt,
    sender: r.sender,
    subject: r.subject,
    fileName: r.fileName,
    fileSize: r.fileSize,
  });
  return {
    async list({ from, to, page, pageSize }) {
      const all = (await scan()).filter(
        (r) =>
          (!from || new Date(r.receivedAt) >= from) && (!to || new Date(r.receivedAt) < to),
      );
      const slice = all.slice((page - 1) * pageSize, page * pageSize);
      return { reports: slice.map(strip), hasMore: all.length > page * pageSize };
    },
    async get(id) {
      const r = (await scan()).find((x) => x.gmailId === id);
      return r ? strip(r) : null;
    },
    async getAttachment(id) {
      const r = (await scan()).find((x) => x.gmailId === id);
      if (!r) throw new NotFoundError("Report not found");
      return { fileName: r.fileName, data: await readFile(r.path) };
    },
  };
}

// ---------------------------------------------------------------- selection

const g = globalThis as unknown as { hourlySource?: HourlySource };

/** The active source: injected (tests) → mock dir → Gmail. Created lazily, once. */
export function hourlySource(): HourlySource {
  if (!g.hourlySource) {
    const dir = process.env.HOURLY_GMAIL_MOCK_DIR;
    g.hourlySource = dir
      ? createDirHourlySource(path.resolve(process.cwd(), dir))
      : createGmailHourlySource();
  }
  return g.hourlySource;
}

/** Test hook. */
export function setHourlySource(source: HourlySource | undefined): void {
  g.hourlySource = source;
}

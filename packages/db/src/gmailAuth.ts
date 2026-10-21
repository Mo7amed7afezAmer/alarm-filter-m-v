// Gmail OAuth material for the worker and the web app: the `gmail_account` row (connected from
// /settings/gmail) wins over the files (credentials.json / token.json) field by field.
// No Google library here — callers build their own OAuth2Client from the result.

import { existsSync, readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export interface GmailClientConfig {
  clientId: string;
  clientSecret: string;
  source: "db" | "file";
}

export interface GmailAuth {
  client: GmailClientConfig;
  /** What OAuth2Client.setCredentials() takes; only refresh_token is required. */
  credentials: { refresh_token: string; scope?: string; [k: string]: unknown };
  tokenSource: "db" | "file";
  email: string | null;
  /** Changes whenever the client or the token changes — callers rebuild their client then. */
  version: string;
}

export class GmailNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailNotConnectedError";
  }
}

/** Parses a Google "Desktop app" client file ({ installed: { client_id, client_secret } }). */
export function parseClientFile(json: unknown): { clientId: string; clientSecret: string } {
  const installed = (json as { installed?: { client_id?: unknown; client_secret?: unknown } })?.installed;
  if (!installed) {
    throw new Error('Not a "Desktop app" OAuth client file (no "installed" section)');
  }
  const { client_id, client_secret } = installed;
  if (typeof client_id !== "string" || !client_id.endsWith(".apps.googleusercontent.com"))
    throw new Error("client_id is missing or invalid");
  if (typeof client_secret !== "string" || !client_secret)
    throw new Error("client_secret is missing");
  return { clientId: client_id, clientSecret: client_secret };
}

function readJson(path: string | undefined): unknown | null {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

type Db = Pick<PrismaClient, "gmailAccount">;

/** OAuth client: uploaded one (DB) or credentials.json. null when neither exists. */
export async function loadGmailClient(
  db: Db,
  credentialsPath?: string,
): Promise<GmailClientConfig | null> {
  const row = await db.gmailAccount.findUnique({ where: { id: 1 } });
  if (row?.clientId && row.clientSecret)
    return { clientId: row.clientId, clientSecret: row.clientSecret, source: "db" };
  const file = readJson(credentialsPath);
  return file ? { ...parseClientFile(file), source: "file" } : null;
}

/**
 * Everything needed to call Gmail. Throws GmailNotConnectedError with a message for the
 * dashboard when there is no client or no refresh token.
 */
export async function loadGmailAuth(
  db: Db,
  files: { credentialsPath?: string; tokenPath?: string } = {},
): Promise<GmailAuth> {
  const row = await db.gmailAccount.findUnique({ where: { id: 1 } });
  let client: GmailClientConfig | null = null;
  if (row?.clientId && row.clientSecret)
    client = { clientId: row.clientId, clientSecret: row.clientSecret, source: "db" };
  else {
    const file = readJson(files.credentialsPath);
    if (file) client = { ...parseClientFile(file), source: "file" };
  }
  if (!client)
    throw new GmailNotConnectedError(
      "No Gmail OAuth client — upload credentials.json in Settings → Gmail",
    );

  if (row?.refreshToken) {
    return {
      client,
      credentials: { refresh_token: row.refreshToken, scope: row.scope ?? undefined },
      tokenSource: "db",
      email: row.email,
      // not updatedAt: a connection test also touches the row
      version: `db:${client.source}:${client.clientId}:${row.refreshToken.slice(-12)}`,
    };
  }
  const token = readJson(files.tokenPath) as { refresh_token?: string } | null;
  if (!token?.refresh_token)
    throw new GmailNotConnectedError("Gmail is not connected — connect it in Settings → Gmail");
  return {
    client,
    credentials: token as GmailAuth["credentials"],
    tokenSource: "file",
    email: null,
    version: `file:${client.source}:${client.clientId}:${token.refresh_token.slice(-12)}`,
  };
}

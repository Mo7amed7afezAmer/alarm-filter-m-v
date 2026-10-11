import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const CREDENTIALS_PATH = path.join(ROOT, "credentials.json");
export const TOKEN_PATH = path.join(ROOT, "token.json");
export const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/** Load ROOT/.env into process.env if present (never overrides existing vars). */
export function loadDotEnv(): void {
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

interface DesktopCredentials {
  installed?: { client_id: string; client_secret: string };
}

export function createOAuthClient(redirectUri?: string): OAuth2Client {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json not found at ${CREDENTIALS_PATH}`);
  }
  const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")) as DesktopCredentials;
  if (!creds.installed) {
    throw new Error('credentials.json is not a "Desktop app" OAuth client (missing "installed")');
  }
  const { client_id, client_secret } = creds.installed;
  return new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri });
}

/** OAuth client with token.json loaded; refreshes access tokens automatically. */
export function authorizedClient(): OAuth2Client {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error("token.json not found — run `corepack pnpm gmail:auth` first");
  }
  const client = createOAuthClient();
  client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, "utf8")));
  return client;
}

// Connecting the alarm mailbox from the UI (/settings/gmail): OAuth "Desktop app" flow with
// PKCE and a loopback redirect, the same client as credentials.json. Server-only.
//
// Google only redirects a Desktop client back to a loopback address, so:
// - opened on the host itself (localhost / 127.0.0.1) → Google returns to our callback route;
// - opened over the LAN → Google redirects to http://localhost:<port>/… which does not load on
//   that PC; the admin pastes that address into the page and /oauth/complete finishes.

import {
  GMAIL_SCOPES,
  loadGmailAuth,
  loadGmailClient,
  parseClientFile,
  type GmailClientConfig,
} from "@alarm/db";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { HttpError } from "./api";
import { prisma } from "./db";
import { gmailFiles, gmailFor } from "./gmail";

export const CALLBACK_PATH = "/api/gmail/oauth/callback";
export const FLOW_COOKIE = "gmail_oauth";
const FLOW_MAX_AGE_SEC = 10 * 60;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface FlowState {
  state: string;
  verifier: string;
  redirectUri: string;
  /** ms epoch — the flow expires with the cookie. */
  at: number;
}

/**
 * Redirect URI for a request: this very address when the page is opened on the host
 * (loopback), else http://localhost:<same port> (the admin pastes the result back).
 */
export function redirectFor(requestUrl: string): { redirectUri: string; loopback: boolean } {
  const u = new URL(requestUrl);
  if (LOOPBACK.has(u.hostname)) return { redirectUri: `${u.origin}${CALLBACK_PATH}`, loopback: true };
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return { redirectUri: `http://localhost:${port}${CALLBACK_PATH}`, loopback: false };
}

function isOurCallback(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK.has(u.hostname) && u.pathname === CALLBACK_PATH;
  } catch {
    return false;
  }
}

async function client(): Promise<GmailClientConfig> {
  const c = await loadGmailClient(prisma, gmailFiles().credentialsPath);
  if (!c) throw new HttpError(409, "No OAuth client yet — upload credentials.json first");
  return c;
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/api/gmail/oauth",
  maxAge: FLOW_MAX_AGE_SEC,
};

/** Google consent URL + the flow state to keep in the httpOnly cookie. */
export async function startFlow(requestUrl: string, loginHint?: string) {
  const c = await client();
  const { redirectUri, loopback } = redirectFor(requestUrl);
  const oauth = new OAuth2Client({ clientId: c.clientId, clientSecret: c.clientSecret, redirectUri });
  const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
  const state = crypto.randomUUID();
  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    scope: GMAIL_SCOPES,
    state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  const flow: FlowState = { state, verifier: codeVerifier, redirectUri, at: Date.now() };
  return { authUrl, redirectUri, loopback, flow };
}

export function readFlow(cookie: string | undefined): FlowState {
  let flow: FlowState | null = null;
  try {
    flow = cookie ? (JSON.parse(cookie) as FlowState) : null;
  } catch {
    flow = null;
  }
  if (
    !flow ||
    typeof flow.state !== "string" ||
    typeof flow.verifier !== "string" ||
    !isOurCallback(flow.redirectUri) ||
    Date.now() - flow.at > FLOW_MAX_AGE_SEC * 1000
  )
    throw new HttpError(400, "Sign-in session expired — press Connect again");
  return flow;
}

/** code + state from the address Google redirected to (pasted by the admin). */
export function parseReturnedUrl(pasted: string): { code: string; state: string } {
  let u: URL;
  try {
    u = new URL(pasted.trim());
  } catch {
    throw new HttpError(400, "Paste the whole address from the browser bar (starts with http://localhost)");
  }
  const err = u.searchParams.get("error");
  if (err) throw new HttpError(400, `Google returned: ${err}`);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state) throw new HttpError(400, "That address has no code — copy it after approving access");
  return { code, state };
}

/**
 * Exchanges the code, checks the grant, reads the mailbox address and stores the refresh
 * token. Returns the connected address.
 */
export async function finishFlow(
  flow: FlowState,
  got: { code: string; state: string },
  adminEmail: string,
): Promise<{ email: string; resetSync: boolean }> {
  if (got.state !== flow.state) throw new HttpError(400, "Sign-in state mismatch — press Connect again");
  const c = await client();
  const oauth = new OAuth2Client({
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    redirectUri: flow.redirectUri,
  });
  let tokens;
  try {
    ({ tokens } = await oauth.getToken({ code: got.code, codeVerifier: flow.verifier }));
  } catch (err) {
    throw new HttpError(400, `Google refused the code: ${(err as Error).message}`);
  }
  if (!tokens.refresh_token)
    throw new HttpError(
      400,
      "Google returned no refresh token — remove this app at myaccount.google.com/permissions and connect again",
    );
  const scopes = (tokens.scope ?? "").split(/\s+/);
  if (!GMAIL_SCOPES.every((s) => scopes.includes(s)))
    throw new HttpError(400, "Read access to Gmail was not granted — tick the Gmail permission on the consent screen");

  const gmail = gmailFor({ client: c, credentials: { ...tokens, refresh_token: tokens.refresh_token } });
  const { data } = await gmail.users.getProfile({ userId: "me" });
  const email = data.emailAddress ?? "";

  const before = await prisma.gmailAccount.findUnique({ where: { id: 1 } });
  // A Gmail history id only means something in its own mailbox: a different (or first
  // UI-connected) account makes the worker start over with a fresh backfill.
  const resetSync = !before?.refreshToken || before.email?.toLowerCase() !== email.toLowerCase();
  const now = new Date();
  const data_ = {
    email,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? GMAIL_SCOPES.join(" "),
    connectedAt: now,
    connectedBy: adminEmail,
    lastCheckAt: now,
    lastCheckOk: true,
    lastCheckMsg: `Connected · ${data.messagesTotal ?? "?"} messages`,
  };
  await prisma.$transaction([
    prisma.gmailAccount.upsert({ where: { id: 1 }, create: { id: 1, ...data_ }, update: data_ }),
    ...(resetSync
      ? [
          prisma.systemStatus.upsert({
            where: { id: 1 },
            create: { id: 1 },
            update: { lastHistoryId: null, syncedLabel: null },
          }),
        ]
      : []),
  ]);
  return { email, resetSync };
}

/** Calls users.getProfile with the stored token and records the result. */
export async function checkConnection() {
  const now = new Date();
  let result: { ok: boolean; message: string; email: string | null; tokenSource: string | null };
  try {
    const auth = await loadGmailAuth(prisma, gmailFiles());
    const { data } = await gmailFor(auth).users.getProfile({ userId: "me" });
    result = {
      ok: true,
      message: `OK · ${data.messagesTotal ?? "?"} messages`,
      email: data.emailAddress ?? null,
      tokenSource: auth.tokenSource,
    };
  } catch (err) {
    const e = err as { message?: string; response?: { data?: { error?: string } } };
    const reason = e.response?.data?.error ?? e.message ?? String(err);
    result = {
      ok: false,
      message:
        reason === "invalid_grant"
          ? "Token expired or revoked (invalid_grant) — connect again"
          : reason.slice(0, 300),
      email: null,
      tokenSource: null,
    };
  }
  await prisma.gmailAccount.upsert({
    where: { id: 1 },
    create: { id: 1, lastCheckAt: now, lastCheckOk: result.ok, lastCheckMsg: result.message },
    update: { lastCheckAt: now, lastCheckOk: result.ok, lastCheckMsg: result.message },
  });
  return result;
}

/** Stores an uploaded credentials.json. A different client invalidates the stored token. */
export async function saveClient(json: unknown) {
  let parsed;
  try {
    parsed = parseClientFile(json);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  const before = await prisma.gmailAccount.findUnique({ where: { id: 1 } });
  const current = await loadGmailClient(prisma, gmailFiles().credentialsPath).catch(() => null);
  const changed = !!current && current.clientId !== parsed.clientId;
  const data = {
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
    // a refresh token belongs to the client that issued it
    ...(changed && before?.refreshToken ? { refreshToken: null, email: null, scope: null } : {}),
  };
  await prisma.gmailAccount.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  return { tokenCleared: changed && !!before?.refreshToken };
}

/** Last 6 chars of the client id prefix, for display ("…abc123.apps.googleusercontent.com"). */
export const maskClientId = (id: string) => {
  const [head] = id.split(".apps.googleusercontent.com");
  return `…${(head ?? id).slice(-6)}.apps.googleusercontent.com`;
};

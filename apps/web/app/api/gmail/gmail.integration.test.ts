// Route tests for /api/gmail/* (connect the alarm mailbox from the UI). Google is mocked: the
// token exchange (OAuth2Client.getToken) and users.getProfile. Runs on alarms_test only.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "ZZ-GMAILTEST";
let users: import("../../../test-users").TestUsers;

const session = vi.hoisted(() => ({
  current: null as null | { user: { role: string; id?: string; email?: string } },
}));
const jar = vi.hoisted(() => new Map<string, string>());
const google = vi.hoisted(() => ({
  tokens: {} as Record<string, unknown>,
  profile: { emailAddress: "alarms@example.com", messagesTotal: 42 } as Record<string, unknown>,
}));

vi.mock("next-auth", async (orig) => ({
  ...(await orig<typeof import("next-auth")>()),
  getServerSession: async () => session.current,
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) }),
}));
vi.mock("@/lib/gmail", async (orig) => ({
  ...(await orig<typeof import("@/lib/gmail")>()),
  gmailFor: () => ({ users: { getProfile: async () => ({ data: google.profile }) } }),
}));
vi.mock("google-auth-library", async (orig) => {
  const mod = await orig<typeof import("google-auth-library")>();
  class OAuth2Client extends mod.OAuth2Client {
    // only the network call is faked; URL building / PKCE are real
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async getToken(): Promise<any> {
      return { tokens: google.tokens };
    }
  }
  return { ...mod, OAuth2Client };
});

type Prisma = typeof import("@alarm/db").prisma;
type Handler = (req: Request) => Promise<Response>;

const CLIENT = {
  installed: { client_id: "test-1234567.apps.googleusercontent.com", client_secret: "client-secret-xyz" },
};
const REFRESH = "1//refresh-token-super-secret";

describe.skipIf(!url)("/api/gmail (integration, alarms_test)", () => {
  let prisma: Prisma;
  let accountGET: Handler, accountDELETE: Handler, clientPOST: Handler, startPOST: Handler;
  let completePOST: Handler, callbackGET: Handler;
  let savedAccount: unknown = null;
  let savedStatus: { lastHistoryId: string | null; syncedLabel: string | null } | null = null;

  const call = async (fn: Handler, path: string, init?: RequestInit, host = "http://localhost:3000") => {
    const res = await fn(new Request(`${host}${path}`, init));
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* redirect / empty */
    }
    return { status: res.status, body: body as Record<string, any>, raw: text, res }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const json = (b: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
  /** start → remember the flow cookie like a browser would */
  const start = async (host?: string) => {
    const r = await call(startPOST, "/api/gmail/oauth/start", json({ loginHint: "" }), host);
    const set = r.res.headers.get("set-cookie") ?? "";
    const m = set.match(/gmail_oauth=([^;]+)/);
    if (m) jar.set("gmail_oauth", decodeURIComponent(m[1]!));
    return r;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@alarm/db"));
    ({ GET: accountGET, DELETE: accountDELETE } = await import("./account/route"));
    ({ POST: clientPOST } = await import("./client/route"));
    ({ POST: startPOST } = await import("./oauth/start/route"));
    ({ POST: completePOST } = await import("./oauth/complete/route"));
    ({ GET: callbackGET } = await import("./oauth/callback/route"));
    users = await (await import("../../../test-users")).createTestUsers(prisma, PREFIX, "ZZ/GmailTest");
    savedAccount = await prisma.gmailAccount.findUnique({ where: { id: 1 } });
    const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
    savedStatus = s ? { lastHistoryId: s.lastHistoryId, syncedLabel: s.syncedLabel } : null;
    await prisma.gmailAccount.deleteMany({});
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.gmailAccount.deleteMany({});
    if (savedAccount)
      await prisma.gmailAccount.create({ data: savedAccount as Parameters<Prisma["gmailAccount"]["create"]>[0]["data"] });
    if (savedStatus) await prisma.systemStatus.update({ where: { id: 1 }, data: savedStatus });
    await (await import("../../../test-users")).removeTestUsers(prisma, PREFIX);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    session.current = { user: { role: "SUPER_ADMIN", id: users.SUPER_ADMIN, email: "admin@local.test" } };
    google.tokens = { refresh_token: REFRESH, access_token: "at", scope: "https://www.googleapis.com/auth/gmail.readonly" };
    google.profile = { emailAddress: "alarms@example.com", messagesTotal: 42 };
  });

  it("is super admin only", async () => {
    session.current = { user: { role: "ADMIN", id: users.ADMIN } }; // office admin
    expect((await call(accountGET, "/api/gmail/account")).status).toBe(403);
    session.current = { user: { role: "OPERATOR", id: users.OPERATOR } };
    expect((await call(accountGET, "/api/gmail/account")).status).toBe(403);
    expect((await call(startPOST, "/api/gmail/oauth/start", json({}))).status).toBe(403);
    expect((await call(completePOST, "/api/gmail/oauth/complete", json({ url: "http://x/y?z" }))).status).toBe(403);
    session.current = null;
    expect((await call(clientPOST, "/api/gmail/client", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("stores an uploaded Desktop client and never returns its secret", async () => {
    expect((await call(clientPOST, "/api/gmail/client", { method: "POST", body: "not json" })).status).toBe(400);
    expect(
      (await call(clientPOST, "/api/gmail/client", { method: "POST", body: JSON.stringify({ web: {} }) })).status,
    ).toBe(400);
    const ok = await call(clientPOST, "/api/gmail/client", { method: "POST", body: JSON.stringify(CLIENT) });
    expect(ok.status).toBe(200);
    const st = await call(accountGET, "/api/gmail/account");
    expect(st.body.data.client).toEqual({ source: "db", clientId: "…234567.apps.googleusercontent.com" });
    expect(st.raw).not.toContain("client-secret-xyz");
  });

  it("start: Google consent URL with PKCE, state and a loopback redirect", async () => {
    const local = await start();
    expect(local.status).toBe(200);
    const auth = new URL(local.body.data.authUrl);
    expect(auth.hostname).toBe("accounts.google.com");
    expect(auth.searchParams.get("client_id")).toBe(CLIENT.installed.client_id);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("access_type")).toBe("offline");
    expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(auth.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/gmail/oauth/callback");
    expect(local.body.data.loopback).toBe(true);

    const lan = await start("http://192.168.1.20:3000");
    expect(lan.body.data).toMatchObject({
      loopback: false,
      redirectUri: "http://localhost:3000/api/gmail/oauth/callback",
    });
  });

  it("complete: rejects a wrong state and a missing refresh token", async () => {
    await start();
    const wrong = await call(
      completePOST,
      "/api/gmail/oauth/complete",
      json({ url: "http://localhost:3000/api/gmail/oauth/callback?state=nope&code=abc" }),
    );
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/state/);

    const flow = JSON.parse(jar.get("gmail_oauth")!);
    google.tokens = { access_token: "at", scope: "https://www.googleapis.com/auth/gmail.readonly" };
    const noRefresh = await call(
      completePOST,
      "/api/gmail/oauth/complete",
      json({ url: `http://localhost:3000/api/gmail/oauth/callback?state=${flow.state}&code=abc` }),
    );
    expect(noRefresh.status).toBe(400);
    expect(noRefresh.body.error).toMatch(/refresh token/);
  });

  it("complete (pasted address): stores the token, reads the mailbox, resets the sync position", async () => {
    await prisma.systemStatus.upsert({
      where: { id: 1 },
      create: { id: 1, lastHistoryId: "999", syncedLabel: "DN/Test" },
      update: { lastHistoryId: "999", syncedLabel: "DN/Test" },
    });
    await start("http://192.168.1.20:3000");
    const flow = JSON.parse(jar.get("gmail_oauth")!);
    const r = await call(
      completePOST,
      "/api/gmail/oauth/complete",
      json({ url: `http://localhost:3000/api/gmail/oauth/callback?state=${flow.state}&code=4/abc&scope=x` }),
      "http://192.168.1.20:3000",
    );
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ email: "alarms@example.com", resetSync: true });

    const row = await prisma.gmailAccount.findUnique({ where: { id: 1 } });
    expect(row).toMatchObject({ email: "alarms@example.com", refreshToken: REFRESH, connectedBy: "admin@local.test" });
    const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
    expect(s).toMatchObject({ lastHistoryId: null, syncedLabel: null });

    const st = await call(accountGET, "/api/gmail/account");
    expect(st.body.data.token).toMatchObject({ source: "db", email: "alarms@example.com" });
    expect(st.raw).not.toContain(REFRESH);

    const { loadGmailAuth } = await import("@alarm/db");
    const auth = await loadGmailAuth(prisma, {});
    expect(auth).toMatchObject({ tokenSource: "db", client: { source: "db" } });
    expect(auth.credentials.refresh_token).toBe(REFRESH);
  });

  it("reconnecting the same mailbox keeps the sync position", async () => {
    await prisma.systemStatus.update({ where: { id: 1 }, data: { lastHistoryId: "1234", syncedLabel: "DN/Test" } });
    await start();
    const flow = JSON.parse(jar.get("gmail_oauth")!);
    const r = await call(
      completePOST,
      "/api/gmail/oauth/complete",
      json({ url: `http://localhost:3000/api/gmail/oauth/callback?state=${flow.state}&code=x` }),
    );
    expect(r.body.data.resetSync).toBe(false);
    expect(await prisma.systemStatus.findUnique({ where: { id: 1 } })).toMatchObject({ lastHistoryId: "1234" });
  });

  it("callback (on the host) finishes the flow and redirects back to the page", async () => {
    await start();
    const flow = JSON.parse(jar.get("gmail_oauth")!);
    const r = await call(callbackGET, `/api/gmail/oauth/callback?state=${flow.state}&code=x`);
    expect(r.status).toBe(307);
    const loc = new URL(r.res.headers.get("location")!);
    expect(loc.pathname).toBe("/settings/gmail");
    expect(loc.searchParams.get("connected")).toBe("alarms@example.com");

    const bad = await call(callbackGET, "/api/gmail/oauth/callback?error=access_denied");
    expect(new URL(bad.res.headers.get("location")!).searchParams.get("error")).toMatch(/access_denied/);
  });

  it("a different uploaded client clears the stored token; disconnect forgets it", async () => {
    const other = { installed: { client_id: "other-999.apps.googleusercontent.com", client_secret: "s2" } };
    const up = await call(clientPOST, "/api/gmail/client", { method: "POST", body: JSON.stringify(other) });
    expect(up.body.data.tokenCleared).toBe(true);
    expect((await prisma.gmailAccount.findUnique({ where: { id: 1 } }))?.refreshToken).toBeNull();

    await prisma.gmailAccount.update({ where: { id: 1 }, data: { refreshToken: REFRESH, email: "a@b" } });
    expect((await call(accountDELETE, "/api/gmail/account", { method: "DELETE" })).status).toBe(200);
    expect(await prisma.gmailAccount.findUnique({ where: { id: 1 } })).toMatchObject({ refreshToken: null, email: null });
  });
});

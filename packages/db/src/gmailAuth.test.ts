import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GmailNotConnectedError, loadGmailAuth, loadGmailClient, parseClientFile } from "./gmailAuth.js";

const dir = mkdtempSync(path.join(tmpdir(), "gmail-auth-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CLIENT = { installed: { client_id: "file-123.apps.googleusercontent.com", client_secret: "file-secret" } };
const credentialsPath = path.join(dir, "credentials.json");
const tokenPath = path.join(dir, "token.json");
writeFileSync(credentialsPath, JSON.stringify(CLIENT));
writeFileSync(tokenPath, JSON.stringify({ refresh_token: "file-refresh-token-0001", scope: "x" }));

type Row = Record<string, unknown> | null;
const db = (row: Row) =>
  ({ gmailAccount: { findUnique: async () => row } }) as unknown as Parameters<typeof loadGmailAuth>[0];

describe("loadGmailAuth", () => {
  it("falls back to credentials.json + token.json when nothing is connected in the UI", async () => {
    const a = await loadGmailAuth(db(null), { credentialsPath, tokenPath });
    expect(a.client).toEqual({ clientId: CLIENT.installed.client_id, clientSecret: "file-secret", source: "file" });
    expect(a.tokenSource).toBe("file");
    expect(a.credentials.refresh_token).toBe("file-refresh-token-0001");
  });

  it("prefers the token and client saved in gmail_account", async () => {
    const row = {
      clientId: "db-1.apps.googleusercontent.com",
      clientSecret: "db-secret",
      refreshToken: "db-refresh-token-0002",
      email: "alarms@example.com",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      updatedAt: new Date(),
    };
    const a = await loadGmailAuth(db(row), { credentialsPath, tokenPath });
    expect(a.client.source).toBe("db");
    expect(a.tokenSource).toBe("db");
    expect(a.email).toBe("alarms@example.com");
    expect(a.credentials.refresh_token).toBe("db-refresh-token-0002");
  });

  it("keeps the version stable when only the check fields change, and changes it with the token", async () => {
    const base = { refreshToken: "tok-aaaaaaaaaaaa", email: "a@x", updatedAt: new Date(1) };
    const v1 = (await loadGmailAuth(db(base), { credentialsPath })).version;
    const v2 = (await loadGmailAuth(db({ ...base, updatedAt: new Date(2), lastCheckOk: true }), { credentialsPath })).version;
    const v3 = (await loadGmailAuth(db({ ...base, refreshToken: "tok-bbbbbbbbbbbb" }), { credentialsPath })).version;
    expect(v2).toBe(v1);
    expect(v3).not.toBe(v1);
  });

  it("throws GmailNotConnectedError without a client or without a token", async () => {
    await expect(loadGmailAuth(db(null), {})).rejects.toBeInstanceOf(GmailNotConnectedError);
    await expect(loadGmailAuth(db(null), { credentialsPath })).rejects.toThrow(/not connected/);
  });

  it("loadGmailClient: uploaded client wins, else the file, else null", async () => {
    expect(await loadGmailClient(db(null), credentialsPath)).toMatchObject({ source: "file" });
    expect(
      await loadGmailClient(db({ clientId: "c.apps.googleusercontent.com", clientSecret: "s" }), credentialsPath),
    ).toMatchObject({ source: "db", clientId: "c.apps.googleusercontent.com" });
    expect(await loadGmailClient(db(null), undefined)).toBeNull();
  });
});

describe("parseClientFile", () => {
  it("accepts a Desktop-app client and rejects everything else", () => {
    expect(parseClientFile(CLIENT)).toEqual({ clientId: CLIENT.installed.client_id, clientSecret: "file-secret" });
    expect(() => parseClientFile({ web: CLIENT.installed })).toThrow(/Desktop app/);
    expect(() => parseClientFile({ installed: { client_id: "nope", client_secret: "s" } })).toThrow(/client_id/);
    expect(() => parseClientFile({ installed: { client_id: "a.apps.googleusercontent.com" } })).toThrow(/client_secret/);
  });
});

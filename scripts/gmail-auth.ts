/**
 * One-time Gmail authorization (OAuth2 Desktop flow).
 * Prints a consent URL, receives the code on a loopback server, saves token.json.
 *
 *   corepack pnpm gmail:auth
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createOAuthClient, SCOPES, TOKEN_PATH } from "./lib/google.js";

const PORT = Number(process.env.OAUTH_PORT ?? 0); // 0 = any free port (allowed for Desktop clients)
const TIMEOUT_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/oauth2callback";

const state = randomBytes(16).toString("hex");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== CALLBACK_PATH) {
    res.writeHead(404).end();
    return;
  }
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  try {
    if (error) throw new Error(`Google returned error: ${error}`);
    if (url.searchParams.get("state") !== state) throw new Error("state mismatch");
    if (!code) throw new Error("no code in callback");

    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error("no refresh_token returned — revoke the app's access and retry");
    }
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Authorized. token.json saved — you can close this tab.</h2>");
    console.log(`\nSaved ${TOKEN_PATH} (scope: ${tokens.scope})`);
    shutdown(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`Authorization failed: ${msg}`);
    console.error(`Authorization failed: ${msg}`);
    shutdown(1);
  }
});

let client: ReturnType<typeof createOAuthClient>;

server.listen(PORT, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  client = createOAuthClient(`http://127.0.0.1:${port}${CALLBACK_PATH}`);
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
  console.log("Open this URL in a browser on THIS machine and approve access:\n");
  console.log(authUrl);
  console.log(`\nWaiting for the callback on http://127.0.0.1:${port}${CALLBACK_PATH} ...`);
});

const timer = setTimeout(() => {
  console.error("Timed out waiting for authorization.");
  shutdown(1);
}, TIMEOUT_MS);

function shutdown(code: number) {
  clearTimeout(timer);
  server.close(() => process.exit(code));
}

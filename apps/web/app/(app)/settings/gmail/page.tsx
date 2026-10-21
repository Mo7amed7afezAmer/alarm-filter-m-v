"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  RefreshCw,
  Unplug,
  Upload,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { api } from "@/components/hourly/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Status {
  client: { source: "db" | "file" | "none"; clientId: string | null };
  token: {
    source: "db" | "file" | "none";
    email: string | null;
    scope: string | null;
    connectedAt: string | null;
    connectedBy: string | null;
  };
  lastCheck: { at: string; ok: boolean | null; message: string | null } | null;
  worker: { lastRunAt: string | null; lastError: string | null };
  redirect: { redirectUri: string; loopback: boolean };
}

const TOKEN_SOURCE: Record<Status["token"]["source"], string> = {
  db: "connected here",
  file: "token.json on the server",
  none: "not connected",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <span className="w-40 shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-sm text-slate-800">{children}</span>
    </div>
  );
}

function GmailView() {
  const { role, timeZone } = useAppConfig();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    params.get("connected")
      ? { ok: true, text: `Connected ${params.get("connected")}` }
      : params.get("error")
        ? { ok: false, text: params.get("error")! }
        : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [loginHint, setLoginHint] = useState("");
  const [pending, setPending] = useState<{ authUrl: string; redirectUri: string } | null>(null);
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setStatus((await api<{ data: Status }>("/api/gmail/account")).data);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    if (role === "SUPER_ADMIN") void load();
  }, [load, role]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run("connect", async () => {
      const { data } = await api<{ data: { authUrl: string; redirectUri: string; loopback: boolean } }>(
        "/api/gmail/oauth/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loginHint }),
        },
      );
      if (data.loopback) {
        window.location.href = data.authUrl; // Google comes back to our callback
        return;
      }
      setPending(data);
      window.open(data.authUrl, "_blank", "noopener");
    });

  const complete = () =>
    run("complete", async () => {
      const { data } = await api<{ data: { email: string; resetSync: boolean } }>(
        "/api/gmail/oauth/complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pasted }),
        },
      );
      setPending(null);
      setPasted("");
      return `Connected ${data.email}${data.resetSync ? " — the worker re-reads the last 24 h on its next run" : ""}`;
    });

  const check = () =>
    run("check", async () => {
      const { data } = await api<{ data: { ok: boolean; message: string; email: string | null } }>(
        "/api/gmail/check",
        { method: "POST" },
      );
      if (!data.ok) throw new Error(data.message);
      return `${data.email ?? "Gmail"}: ${data.message}`;
    });

  const disconnect = () => {
    if (!confirm("Forget the Gmail token saved here? The worker will stop reading mail unless token.json exists on the server.")) return;
    void run("disconnect", async () => {
      await api("/api/gmail/account", { method: "DELETE" });
      return "Disconnected";
    });
  };

  const upload = (file: File) =>
    run("upload", async () => {
      const { data } = await api<{ data: { tokenCleared: boolean } }>("/api/gmail/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      return data.tokenCleared
        ? "OAuth client saved — it is a different client, so connect the mailbox again"
        : "OAuth client saved";
    });

  if (role !== "SUPER_ADMIN")
    return <p className="text-sm text-muted-foreground">Gmail connection is managed by the super admin.</p>;

  const t = status?.token;
  const connected = !!t && t.source !== "none";
  const check_ = status?.lastCheck;

  return (
    <>
      <PageHeader
        title="Gmail connection"
        subtitle="The alarm mailbox the worker and the hourly reports read (read-only access)"
        actions={
          <Button size="sm" variant="outline" className="bg-white" asChild>
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4" /> Settings
            </Link>
          </Button>
        }
      />

      {msg && (
        <p
          role="status"
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
          )}
        >
          {msg.text}
        </p>
      )}

      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Mailbox
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              <Row label="Status">
                {connected ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {TOKEN_SOURCE[t!.source]}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                    <XCircle className="h-4 w-4" /> Not connected
                  </span>
                )}
              </Row>
              {t?.email && <Row label="Account">{t.email}</Row>}
              {t?.connectedAt && (
                <Row label="Connected">
                  {formatDateTime(t.connectedAt, timeZone)}
                  {t.connectedBy && <span className="text-slate-500"> by {t.connectedBy}</span>}
                </Row>
              )}
              {check_ && (
                <Row label="Last test">
                  <span className={check_.ok ? "text-emerald-700" : "text-red-700"}>
                    {check_.message}
                  </span>{" "}
                  <span className="text-slate-500">· {formatDateTime(check_.at, timeZone)}</span>
                </Row>
              )}
              <Row label="Worker">
                {status.worker.lastError ? (
                  <span className="text-red-700">{status.worker.lastError.slice(0, 200)}</span>
                ) : status.worker.lastRunAt ? (
                  <>last run {formatDateTime(status.worker.lastRunAt, timeZone)}</>
                ) : (
                  "has not run yet"
                )}
              </Row>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Mailbox address (optional)</span>
              <Input
                type="email"
                className="w-72 bg-white"
                placeholder="alarms@company.com"
                value={loginHint}
                onChange={(e) => setLoginHint(e.target.value)}
              />
            </label>
            <Button
              onClick={connect}
              disabled={!!busy || status?.client.source === "none"}
              data-testid="gmail-connect"
            >
              {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {connected ? "Reconnect / switch account" : "Sign in with Google"}
            </Button>
            <Button variant="outline" className="bg-white" onClick={check} disabled={!!busy || !connected}>
              {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Test connection
            </Button>
            {t?.source === "db" && (
              <Button variant="ghost" className="text-red-700" onClick={disconnect} disabled={!!busy}>
                <Unplug className="h-4 w-4" /> Disconnect
              </Button>
            )}
          </div>

          {pending && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Finish the sign-in</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  In the Google tab, choose the alarm mailbox and allow read access.{" "}
                  <a href={pending.authUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline">
                    Open it again <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  Google then opens <code className="rounded bg-white/70 px-1">{pending.redirectUri.replace(/\/api.*/, "/…")}</code>,
                  which does not load on this PC — that is expected. Copy the whole address from that tab’s address bar.
                </li>
                <li>Paste it here:</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-0 flex-1 bg-white font-mono text-xs"
                  placeholder="http://localhost:3000/api/gmail/oauth/callback?state=…&code=…"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  aria-label="Address Google redirected to"
                />
                <Button onClick={complete} disabled={!!busy || pasted.length < 10}>
                  {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Finish
                </Button>
              </div>
              <p className="text-xs text-amber-800">
                Tip: opening this page on the server itself (http://localhost:…) skips the copy-paste.
              </p>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            While the Google OAuth app is in “Testing” mode, Google expires the token after 7 days —
            reconnect here when the worker reports invalid_grant, or publish the app / make it Internal.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> OAuth client
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The Google Cloud “Desktop app” client (credentials.json) used to sign in. Upload one to
            replace the file on the server.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {status && (
            <Row label="Client">
              {status.client.source === "none" ? (
                <span className="text-red-700">none — upload credentials.json</span>
              ) : (
                <>
                  <span className="font-mono text-xs">{status.client.clientId}</span>{" "}
                  <span className="text-slate-500">
                    ({status.client.source === "db" ? "uploaded here" : "credentials.json on the server"})
                  </span>
                </>
              )}
            </Row>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" className="bg-white" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload credentials.json
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

export default function GmailSettingsPage() {
  return (
    <Suspense>
      <GmailView />
    </Suspense>
  );
}

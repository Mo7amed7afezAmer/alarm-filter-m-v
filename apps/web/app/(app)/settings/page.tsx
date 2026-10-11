"use client";

import { useEffect, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { usePoll } from "@/components/use-poll";

type Category = "DOWN" | "POWER" | "OTHER";
interface Rule {
  pattern: string;
  category: Category;
  priority: number;
}
interface User {
  id: number;
  email: string;
  role: "VIEWER" | "ADMIN";
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json?.details?.fieldErrors
      ? ` (${JSON.stringify(json.details.fieldErrors)})`
      : "";
    throw new Error((json?.error ?? `HTTP ${res.status}`) + details);
  }
  return json;
}

function RulesEditor() {
  const { data, reload } = usePoll<{ rules: Rule[] }>("/api/rules", 0);
  const [rules, setRules] = useState<Rule[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data)
      setRules(
        data.rules.map(({ pattern, category, priority }) => ({ pattern, category, priority })),
      );
  }, [data]);

  const update = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const cleaned = rules.filter((r) => r.pattern.trim());
      const r = await send("/api/rules", "PUT", { rules: cleaned });
      setMsg(`Saved ${r.rules.length} rules · ${r.reclassified} existing alarms re-classified`);
      await reload();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const sorted = rules.map((r, i) => ({ r, i })).sort((a, b) => a.r.priority - b.r.priority);
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Classification rules</CardTitle>
        <p className="text-sm text-muted-foreground">
          Case-insensitive “contains” match on the alarm name. Lowest priority number is checked
          first; no match → OTHER.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="hidden grid-cols-[1fr_8rem_6rem_2.5rem] gap-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Pattern</span>
          <span>Category</span>
          <span>Priority</span>
          <span />
        </div>
        {sorted.map(({ r, i }) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1fr_2.5rem] gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[1fr_8rem_6rem_2.5rem] sm:rounded-none sm:border-0 sm:p-0 [&>*:first-child]:col-span-3 sm:[&>*:first-child]:col-span-1"
          >
            <Input value={r.pattern} onChange={(e) => update(i, { pattern: e.target.value })} />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={r.category}
              onChange={(e) => update(i, { category: e.target.value as Category })}
            >
              <option value="DOWN">DOWN</option>
              <option value="POWER">POWER</option>
              <option value="OTHER">OTHER</option>
            </select>
            <Input
              type="number"
              value={r.priority}
              onChange={(e) => update(i, { priority: Number(e.target.value) })}
            />
            <Button
              variant="ghost"
              size="sm"
              title="Remove"
              onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
            >
              ✕
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRules((rs) => [
                ...rs,
                {
                  pattern: "",
                  category: "DOWN",
                  priority: Math.max(0, ...rs.map((r) => r.priority)) + 10,
                },
              ])
            }
          >
            + Add rule
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save rules"}
          </Button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Reprocess() {
  const [days, setDays] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);
  async function queue() {
    if (!window.confirm(`Rebuild all alarms from the last ${days} day(s) of stored emails?`))
      return;
    try {
      await send(`/api/reprocess?days=${days}`, "POST");
      setMsg(
        `Queued — the worker will rebuild the last ${days} day(s) on its next run (within a minute).`,
      );
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  }
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Reprocess</CardTitle>
        <p className="text-sm text-muted-foreground">
          Rebuilds alarms from stored emails (e.g. after a parser fix). Safe to repeat — results are
          identical.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={1}
          max={90}
          className="w-24"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <span className="text-sm">days</span>
        <Button size="sm" variant="outline" onClick={() => void queue()}>
          Queue reprocess
        </Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </CardContent>
    </Card>
  );
}

function Users() {
  const { email: me } = useAppConfig();
  const { data, reload } = usePoll<{ users: User[] }>("/api/users", 0);
  const [form, setForm] = useState({ email: "", password: "", role: "VIEWER" as User["role"] });
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await reload();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  }

  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Users</CardTitle>
        <p className="text-sm text-muted-foreground">
          Viewers can see all pages; admins can also edit rules, users and reprocess.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Email</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2">{u.email}</td>
                  <td>
                    <select
                      className="h-8 rounded-md border bg-background px-2"
                      value={u.role}
                      disabled={u.email === me}
                      onChange={(e) =>
                        void run(
                          () => send("/api/users", "PATCH", { id: u.id, role: e.target.value }),
                          `Updated ${u.email}`,
                        )
                      }
                    >
                      <option value="VIEWER">viewer</option>
                      <option value="ADMIN">admin</option>
                    </select>
                  </td>
                  <td className="space-x-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const pw = window.prompt(`New password for ${u.email} (min 8 characters)`);
                        if (pw)
                          void run(
                            () => send("/api/users", "PATCH", { id: u.id, password: pw }),
                            `Password reset for ${u.email}`,
                          );
                      }}
                    >
                      Reset password
                    </Button>
                    {u.email !== me && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        onClick={() => {
                          if (window.confirm(`Delete ${u.email}?`))
                            void run(
                              () => send(`/api/users?id=${u.id}`, "DELETE"),
                              `Deleted ${u.email}`,
                            );
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form
          className="grid grid-cols-1 gap-2 border-t pt-3 sm:flex sm:flex-wrap sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await send("/api/users", "POST", form);
              setForm({ email: "", password: "", role: "VIEWER" });
            }, `Added ${form.email}`);
          }}
        >
          <Input
            className="w-full sm:w-56"
            type="email"
            required
            placeholder="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            className="w-full sm:w-48"
            type="password"
            required
            minLength={8}
            placeholder="password (min 8)"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as User["role"] })}
          >
            <option value="VIEWER">viewer</option>
            <option value="ADMIN">admin</option>
          </select>
          <Button size="sm" type="submit">
            Add user
          </Button>
        </form>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { role } = useAppConfig();
  if (role !== "ADMIN")
    return <p className="text-sm text-muted-foreground">Settings are available to admins only.</p>;
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Classification rules, reprocessing and users (admin only)"
      />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <RulesEditor />
        <div className="space-y-4">
          <Reprocess />
          <Users />
        </div>
      </div>
    </>
  );
}

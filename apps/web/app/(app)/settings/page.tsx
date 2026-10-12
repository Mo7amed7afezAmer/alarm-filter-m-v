"use client";

import { Eye, EyeOff, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { CategoryBadge } from "@/components/badges";
import { useAppConfig } from "@/components/app-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { usePoll } from "@/components/use-poll";
import { splitAlarmName } from "@/lib/format";
import { cn } from "@/lib/utils";

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

interface OfficeState {
  office: string | null;
  syncedOffice: string | null;
  offices: string[];
}

/** "DN/Kafr ElDawar" → { group: "DN", name: "Kafr ElDawar" }. */
function splitOffice(label: string) {
  const i = label.lastIndexOf("/");
  return i > 0
    ? { group: label.slice(0, i), name: label.slice(i + 1) }
    : { group: "Other", name: label };
}

type Cat = "DOWN" | "POWER" | "OTHER";
interface DisplayFilter {
  hiddenCategories: Cat[];
  hiddenAlarmNames: string[];
}
interface NameRow {
  name: string;
  category: Cat;
  count: number;
}

function VisibilityButton({
  shown,
  onClick,
  label,
}: {
  shown: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={(shown ? "Hide " : "Show ") + label}
      title={shown ? "Shown — click to hide" : "Hidden — click to show"}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
        shown
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200",
      )}
    >
      {shown ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      {shown ? "Shown" : "Hidden"}
    </button>
  );
}

function DisplayedTypes() {
  const current = usePoll<DisplayFilter>("/api/settings/display", 0);
  const names = usePoll<{ names: NameRow[] }>("/api/alarm-names?all=1", 0);
  const [filter, setFilter] = useState<DisplayFilter | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (current.data && !filter) setFilter(current.data);
  }, [current.data, filter]);
  if (!filter) return null;

  const catHidden = (c: Cat) => filter.hiddenCategories.includes(c);
  const nameHidden = (n: string) => filter.hiddenAlarmNames.includes(n);
  const toggleCat = (c: Cat) =>
    setFilter({
      ...filter,
      hiddenCategories: catHidden(c)
        ? filter.hiddenCategories.filter((x) => x !== c)
        : [...filter.hiddenCategories, c],
    });
  const toggleName = (n: string) =>
    setFilter({
      ...filter,
      hiddenAlarmNames: nameHidden(n)
        ? filter.hiddenAlarmNames.filter((x) => x !== n)
        : [...filter.hiddenAlarmNames, n],
    });
  const query = q.trim().toUpperCase();
  const rows = (names.data?.names ?? []).filter(
    (n) => !query || n.name.toUpperCase().includes(query),
  );
  const changed = JSON.stringify(filter) !== JSON.stringify(current.data);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await send("/api/settings/display", "PUT", filter);
      window.location.reload(); // every page + the "hidden" note pick up the new filter
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <Card id="display" className="scroll-mt-20 rounded-xl border-slate-200 shadow-sm">
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Displayed alarm types</CardTitle>
          <p className="text-sm text-muted-foreground">
            Hidden types disappear from Alarms, Cleared, Dashboard, exports and notifications for
            everyone. They are still read and matched in the background — show them again at any
            time.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(filter.hiddenCategories.length > 0 || filter.hiddenAlarmNames.length > 0) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFilter({ hiddenCategories: [], hiddenAlarmNames: [] })}
            >
              Show all
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={busy || !changed}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {msg && <p className="text-sm text-red-700">{msg}</p>}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Categories
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["DOWN", "POWER", "OTHER"] as Cat[]).map((c) => (
              <div
                key={c}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2",
                  catHidden(c) ? "border-slate-200 bg-slate-50" : "border-slate-200",
                )}
              >
                <CategoryBadge value={c} />
                <VisibilityButton shown={!catHidden(c)} onClick={() => toggleCat(c)} label={c} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Alarm names (last 30 days in this office)
            </span>
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="bg-white pl-8"
              />
            </div>
          </div>
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {rows.map((n) => {
              const byCat = catHidden(n.category);
              const hidden = byCat || nameHidden(n.name);
              const { name, prefix } = splitAlarmName(n.name);
              return (
                <div
                  key={n.name}
                  className={cn("flex items-center gap-3 px-3 py-2", hidden && "bg-slate-50")}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      hidden ? "text-slate-400 line-through" : "text-slate-900",
                    )}
                    title={n.name}
                  >
                    {name}
                    {prefix && (
                      <span className="ml-1.5 font-mono text-[10px] text-slate-400 no-underline">
                        {prefix}
                      </span>
                    )}
                  </span>
                  <CategoryBadge value={n.category} />
                  <span className="hidden w-10 text-right text-xs tabular-nums text-slate-400 sm:inline">
                    {n.count}
                  </span>
                  {byCat ? (
                    <span className="w-[5.5rem] text-right text-[11px] text-slate-400">
                      via category
                    </span>
                  ) : (
                    <VisibilityButton
                      shown={!nameHidden(n.name)}
                      onClick={() => toggleName(n.name)}
                      label={n.name}
                    />
                  )}
                </div>
              );
            })}
            {names.data && !rows.length && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">No alarm names match.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OfficePicker() {
  const { data } = usePoll<OfficeState>("/api/settings/office", 15_000);
  const [choice, setChoice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.office && !choice) setChoice(data.office);
  }, [data, choice]);

  const groups = new Map<string, string[]>();
  for (const label of data?.offices ?? []) {
    const { group } = splitOffice(label);
    groups.set(group, [...(groups.get(group) ?? []), label]);
  }
  const syncing = !!data?.office && data.office !== data.syncedOffice;

  async function save() {
    if (!choice || choice === data?.office) return;
    if (
      !window.confirm(`Switch the system to office "${choice}"? Pages will show this office only.`)
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      await send("/api/settings/office", "PUT", { office: choice });
      window.location.reload(); // header + every page re-scope to the new office
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Office</CardTitle>
        <p className="text-sm text-muted-foreground">
          The Gmail label (office) the system reads. All pages show the selected office only; each
          office keeps its own history.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data && !data.offices.length ? (
          <p className="text-sm text-amber-700">
            No office labels found yet — the worker refreshes the list every 10 minutes (labels
            under DN/ and DS/).
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm sm:max-w-xs"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              {!choice && <option value="">Choose an office…</option>}
              {[...groups].map(([group, labels]) => (
                <optgroup key={group} label={group}>
                  {labels.map((l) => (
                    <option key={l} value={l}>
                      {splitOffice(l).name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={busy || !choice || choice === data?.office}
            >
              {busy ? "Switching…" : "Use this office"}
            </Button>
          </div>
        )}
        {data?.office && (
          <p className="text-sm">
            Current: <span className="font-medium">{data.office}</span>{" "}
            {syncing ? (
              <span className="text-amber-700">
                · loading the last 24h of this office (a few minutes)…
              </span>
            ) : (
              <span className="text-emerald-700">· synced</span>
            )}
          </p>
        )}
        {msg && <p className="text-sm text-red-700">{msg}</p>}
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
        subtitle="Office, classification rules, reprocessing and users (admin only)"
      />
      <OfficePicker />
      <DisplayedTypes />
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

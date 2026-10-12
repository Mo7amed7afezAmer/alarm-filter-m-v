"use client";

import { Eye, EyeOff, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { CategoryBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/components/use-poll";
import { splitAlarmName } from "@/lib/format";
import { cn } from "@/lib/utils";

type Cat = "DOWN" | "POWER" | "OTHER";
interface Filter {
  hiddenCategories: Cat[];
  hiddenAlarmNames: string[];
}
interface NameRow {
  name: string;
  category: Cat;
  count: number;
}

const EMPTY: Filter = { hiddenCategories: [], hiddenAlarmNames: [] };

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

function Locked({ text }: { text: string }) {
  return <span className="w-[6.5rem] shrink-0 text-right text-[11px] text-slate-400">{text}</span>;
}

/**
 * Hide/show alarm types.
 * - `admin`: hides for everyone (PUT /api/settings/display).
 * - `personal`: hides on this user's pages only (PUT /api/me/display); types the admin already
 *   hides are shown as locked.
 */
export function TypesVisibilityEditor({ mode }: { mode: "admin" | "personal" }) {
  const endpoint = mode === "admin" ? "/api/settings/display" : "/api/me/display";
  const current = usePoll<Filter & { admin?: Filter }>(endpoint, 0);
  const names = usePoll<{ names: NameRow[] }>("/api/alarm-names?all=1", 0);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (current.data && !filter) {
      setFilter({
        hiddenCategories: current.data.hiddenCategories,
        hiddenAlarmNames: current.data.hiddenAlarmNames,
      });
    }
  }, [current.data, filter]);
  if (!filter) return null;

  const admin = mode === "personal" ? (current.data?.admin ?? EMPTY) : EMPTY;
  const adminCat = (c: Cat) => admin.hiddenCategories.includes(c);
  const adminName = (n: string) => admin.hiddenAlarmNames.includes(n);
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
  const saved = {
    hiddenCategories: current.data?.hiddenCategories ?? [],
    hiddenAlarmNames: current.data?.hiddenAlarmNames ?? [],
  };
  const changed = JSON.stringify(filter) !== JSON.stringify(saved);
  const anyHidden = filter.hiddenCategories.length > 0 || filter.hiddenAlarmNames.length > 0;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filter),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      window.location.reload(); // pages + the "hidden" note pick up the new filter
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <Card id="display" className="scroll-mt-20 rounded-xl border-slate-200 shadow-sm">
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">
            {mode === "admin"
              ? "Displayed alarm types (everyone)"
              : "Hide alarm types from my pages"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {mode === "admin"
              ? "Hidden types disappear from Alarms, Cleared, Dashboard, exports and notifications for every user."
              : "Only for you: hidden types disappear from your Alarms, Cleared, Dashboard, exports and notifications. Other users are not affected."}{" "}
            Alarms are still read and matched in the background — show them again at any time.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {anyHidden && (
            <Button size="sm" variant="outline" onClick={() => setFilter({ ...EMPTY })}>
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
                  "flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2",
                  (catHidden(c) || adminCat(c)) && "bg-slate-50",
                )}
              >
                <CategoryBadge value={c} />
                {adminCat(c) ? (
                  <Locked text="hidden by admin" />
                ) : (
                  <VisibilityButton shown={!catHidden(c)} onClick={() => toggleCat(c)} label={c} />
                )}
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
              const lockedByAdmin = adminCat(n.category) || adminName(n.name);
              const byMyCategory = catHidden(n.category);
              const hidden = lockedByAdmin || byMyCategory || nameHidden(n.name);
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
                      <span className="ml-1.5 font-mono text-[10px] text-slate-400">{prefix}</span>
                    )}
                  </span>
                  <CategoryBadge value={n.category} />
                  <span className="hidden w-10 text-right text-xs tabular-nums text-slate-400 sm:inline">
                    {n.count}
                  </span>
                  {lockedByAdmin ? (
                    <Locked text="hidden by admin" />
                  ) : byMyCategory ? (
                    <Locked text="via category" />
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

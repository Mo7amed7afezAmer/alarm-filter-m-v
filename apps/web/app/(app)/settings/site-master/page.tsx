"use client";

import { officeColor } from "@alarm/core";
import { ArrowLeft, Check, Pencil, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { Pager } from "@/components/data-table";
import { Field, TextFilter, useUrlFilters } from "@/components/filters";
import { api } from "@/components/hourly/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/components/use-poll";

interface Site {
  code: string;
  siteName: string | null;
  office: string;
  nodality: string | null;
  vip: boolean;
  siteType: string | null;
  powerSource: string | null;
  battery: string | null;
  region: string | null;
  notes: string | null;
  updatedAt: string;
}
interface SitesPage {
  data: Site[];
  meta: { total: number; page: number; pages: number; offices: { office: string; count: number }[] };
}
interface ImportResult {
  inserted: number;
  updated: number;
  skipped: { row: number; code: string; reason: string }[];
}
interface Rule {
  field: string;
  from: string;
  to: string;
}

function ImportCard({ onDone }: { onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    const f = file.current?.files?.[0];
    if (!f) return setError("Choose an .xlsx file first");
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", f);
      const r = await api<{ data: ImportResult }>("/api/site-master/import", { method: "POST", body });
      setResult(r.data);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Import Site Master</CardTitle>
        <p className="text-sm text-muted-foreground">
          Excel with a sheet <b>SiteMaster</b> and the columns Code, Site Name, Office, Nodality, VIP,
          Site type, Power Source, Battery. Re-importing updates existing codes; one file per office
          is fine. Other columns (e.g. Guard Number) are ignored.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={file}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-sm"
            aria-label="Site Master file"
          />
          <Button size="sm" disabled={busy} onClick={() => void upload()}>
            <Upload className="h-4 w-4" />
            {busy ? "Importing…" : "Import"}
          </Button>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {result && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="import-summary">
            <b>{result.inserted}</b> inserted · <b>{result.updated}</b> updated ·{" "}
            <b>{result.skipped.length}</b> skipped
            {result.skipped.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs text-emerald-800">
                {result.skipped.slice(0, 20).map((s) => (
                  <li key={`${s.row}-${s.code}`}>
                    Row {s.row} {s.code}: {s.reason}
                  </li>
                ))}
                {result.skipped.length > 20 && <li>… and {result.skipped.length - 20} more</li>}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Click-to-edit cell; Enter / blur saves, Escape cancels. */
function EditableCell({
  value,
  onSave,
  required,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  required?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(value), [value]);
  const save = async () => {
    if (text.trim() === value || (required && !text.trim())) return setEditing(false);
    setBusy(true);
    try {
      await onSave(text.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  if (!editing)
    return (
      <button
        className="group inline-flex items-center gap-1 rounded px-1 text-left hover:bg-slate-100"
        onClick={() => setEditing(true)}
        title="Click to edit"
      >
        {value || <span className="text-slate-400">—</span>}
        <Pencil className="h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100" />
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        autoFocus
        className="h-7 w-40 bg-white text-sm"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            setText(value);
            setEditing(false);
          }
        }}
        onBlur={() => void save()}
      />
      {busy && <Check className="h-3.5 w-3.5 animate-pulse text-slate-400" />}
    </span>
  );
}

function SitesTable({ reloadKey }: { reloadKey: number }) {
  const { params, set } = useUrlFilters();
  const q = params.get("q") ?? "";
  const office = params.get("office") ?? "";
  const page = Number(params.get("page") ?? 1);
  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (q) query.set("q", q);
  if (office) query.set("office", office);
  const { data, error, reload } = usePoll<SitesPage>(`/api/site-master?${query}&k=${reloadKey}`, 0);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (code: string, patch: Partial<Site>) => {
    try {
      await api(`/api/site-master/${encodeURIComponent(code)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setMsg(`Saved ${code}`);
      await reload();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
      throw e;
    }
  };

  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Sites</CardTitle>
        <p className="text-sm text-muted-foreground">
          Office and site type can be edited inline. Hourly reports pick up changes on their next
          processing (cached reports are refreshed automatically).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextFilter label="Search code / site name" value={q} onChange={(v) => set({ q: v })} />
          <Field label="Office">
            <select
              className="h-9 rounded-md border border-input bg-white px-2 text-sm shadow-sm"
              value={office}
              onChange={(e) => set({ office: e.target.value || null })}
            >
              <option value="">All offices</option>
              {data?.meta.offices.map((o) => (
                <option key={o.office} value={o.office}>
                  {o.office} ({o.count})
                </option>
              ))}
            </select>
          </Field>
          {msg && <span className="text-sm text-slate-500 sm:ml-auto">{msg}</span>}
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2">Code</th>
                <th>Site name</th>
                <th>Office</th>
                <th>Nodality</th>
                <th>VIP</th>
                <th>Site type</th>
                <th>Power</th>
                <th>Battery</th>
                <th>Region</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No sites — import a Site Master file above.
                  </td>
                </tr>
              )}
              {data?.data.map((s) => {
                const color = officeColor(s.office);
                return (
                  <tr key={s.code} className="border-t" style={{ background: color ? `#${color}55` : undefined }}>
                    <td className="py-1.5 font-mono text-xs font-medium">{s.code}</td>
                    <td>{s.siteName ?? "—"}</td>
                    <td>
                      <EditableCell value={s.office} required onSave={(v) => save(s.code, { office: v })} />
                    </td>
                    <td>{s.nodality ?? "—"}</td>
                    <td>{s.vip ? <b className="text-rose-700">VIP</b> : "—"}</td>
                    <td>
                      <EditableCell value={s.siteType ?? ""} onSave={(v) => save(s.code, { siteType: v || null })} />
                    </td>
                    <td>{s.powerSource ?? "—"}</td>
                    <td>{s.battery ?? "—"}</td>
                    <td>{s.region ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data && (
          <Pager page={data.meta.page} pages={data.meta.pages} total={data.meta.total} onPage={(p) => set({ page: String(p) })} />
        )}
      </CardContent>
    </Card>
  );
}

function NormalizationsCard() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ data: Rule[]; meta: { fields: string[] } }>("/api/hourly-normalizations")
      .then((r) => {
        setRules(r.data.map(({ field, from, to }) => ({ field, from, to })));
        setFields(r.meta.fields);
      })
      .catch((e) => setMsg(`Error: ${(e as Error).message}`));
  }, []);
  const update = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    try {
      const r = await api<{ data: Rule[] }>("/api/hourly-normalizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules!.filter((x) => x.from.trim())),
      });
      setRules(r.data.map(({ field, from, to }) => ({ field, from, to })));
      setMsg("Saved — reports are re-processed with the new rules");
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  };
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Value normalization</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every value is trimmed, double spaces collapsed and upper-cased first; then these fixes
          replace whole words (e.g. SHELTER DOO → SHELTER DOOR). Field <b>*</b> applies everywhere;
          alarmName rules also fix Alarm Text and Supplementary Information.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules?.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border bg-white px-2 text-sm"
              value={r.field}
              onChange={(e) => update(i, { field: e.target.value })}
            >
              {fields.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <Input className="h-8 w-56 bg-white" value={r.from} placeholder="from" onChange={(e) => update(i, { from: e.target.value })} />
            <span className="text-slate-400">→</span>
            <Input className="h-8 w-56 bg-white" value={r.to} placeholder="to" onChange={(e) => update(i, { to: e.target.value })} />
            <Button size="sm" variant="ghost" aria-label="Remove rule" onClick={() => setRules((rs) => rs!.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="bg-white" onClick={() => setRules((rs) => [...(rs ?? []), { field: "alarmName", from: "", to: "" }])}>
            <Plus className="h-4 w-4" /> Add rule
          </Button>
          <Button size="sm" disabled={!rules} onClick={() => void save()}>
            Save rules
          </Button>
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function SiteMasterView() {
  const { role } = useAppConfig();
  const [reloadKey, setReloadKey] = useState(0);
  if (role !== "ADMIN")
    return <p className="text-sm text-slate-600">Site Master is managed by admins.</p>;
  return (
    <>
      <PageHeader
        title="Site Master"
        subtitle={
          <Link href="/settings" className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Settings
          </Link>
        }
      />
      <ImportCard onDone={() => setReloadKey((k) => k + 1)} />
      <SitesTable reloadKey={reloadKey} />
      <NormalizationsCard />
    </>
  );
}

export default function SiteMasterPage() {
  return (
    <Suspense>
      <SiteMasterView />
    </Suspense>
  );
}

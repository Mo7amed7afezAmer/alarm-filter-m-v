"use client";

import {
  filterHourlyRows,
  hourlyFacets,
  officeColor,
  sortHourlyRows,
  type HourlyMeta,
  type HourlyRow,
} from "@alarm/core";
import { ArrowLeft, Loader2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { Field, TextFilter } from "@/components/filters";
import { api, useHourlyUrl, type ReportItem } from "@/components/hourly/client";
import { ColumnChooser, HourlyTable, useColumnPrefs } from "@/components/hourly/hourly-table";
import { MultiSelect } from "@/components/hourly/multi-select";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";

interface Diff {
  data: { new: HourlyRow[]; disappeared: HourlyRow[] };
  meta: { a: HourlyMeta; b: HourlyMeta };
}

function CompareView() {
  const { timeZone } = useAppConfig();
  const { params, filters, sort, setMany, setOne, setSort } = useHourlyUrl();
  const cols = useColumnPrefs();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportItem[]>([]);

  useEffect(() => {
    if (!a || !b) return;
    setDiff(null);
    setError(null);
    api<Diff>(`/api/hourly-reports/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then(setDiff)
      .catch((e) => setError((e as Error).message));
    api<{ data: ReportItem[] }>("/api/hourly-reports?page=1")
      .then((r) => setReports(r.data))
      .catch(() => undefined);
  }, [a, b]);

  const label = (id: string) => {
    const r = reports.find((x) => x.gmailId === id);
    return r ? formatDateTime(r.receivedAt, timeZone) : id;
  };

  const all = useMemo(() => (diff ? [...diff.data.new, ...diff.data.disappeared] : []), [diff]);
  const facets = useMemo(() => hourlyFacets(all), [all]);
  const view = (rows: HourlyRow[]) => sortHourlyRows(filterHourlyRows(rows, filters), sort);
  const added = useMemo(() => (diff ? view(diff.data.new) : []), [diff, filters, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const gone = useMemo(() => (diff ? view(diff.data.disappeared) : []), [diff, filters, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Compare hourly reports"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3">
            <Link href={b ? `/hourly/${encodeURIComponent(b)}` : "/hourly"} className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Link>
            <span>
              Older <b>{label(a)}</b> → newer <b>{label(b)}</b> · matched on site code + alarm + DN
            </span>
          </span>
        }
        actions={<ColumnChooser visible={cols.visible} onChange={cols.setVisible} onReset={cols.reset} />}
      />

      {(!a || !b) && <p className="text-sm text-slate-500">Pick two reports (?a=older&b=newer).</p>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {a && b && !diff && !error && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-14 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Comparing…
        </div>
      )}

      {diff && (
        <>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex sm:flex-wrap sm:items-end">
            <Field label="Office">
              <MultiSelect
                label="Office"
                className="sm:w-48"
                options={facets.office}
                value={filters.office ?? []}
                onChange={(v) => setMany("office", v)}
                swatch={officeColor}
              />
            </Field>
            <Field label="Alarm">
              <MultiSelect
                label="Alarm"
                className="sm:w-60"
                searchable
                options={facets.alarm}
                value={filters.alarm ?? []}
                onChange={(v) => setMany("alarm", v)}
              />
            </Field>
            <div className="col-span-2 sm:col-span-1">
              <TextFilter label="Search code / name" value={filters.q ?? ""} onChange={(v) => setOne("q", v)} />
            </div>
          </div>

          <div className="grid gap-5 2xl:grid-cols-2">
            <section className="min-w-0 space-y-2">
              <h2 className="flex items-center gap-2 font-semibold text-emerald-800">
                <Plus className="h-4 w-4" /> New <span className="tabular-nums text-slate-500">{added.length}</span>
              </h2>
              <HourlyTable rows={added} columns={cols.visible} sort={sort} onSort={setSort} height="60vh" empty="Nothing new" />
            </section>
            <section className="min-w-0 space-y-2">
              <h2 className="flex items-center gap-2 font-semibold text-slate-700">
                <Minus className="h-4 w-4" /> Disappeared{" "}
                <span className="tabular-nums text-slate-500">{gone.length}</span>
              </h2>
              <HourlyTable rows={gone} columns={cols.visible} sort={sort} onSort={setSort} height="60vh" empty="Nothing disappeared" />
            </section>
          </div>
        </>
      )}
    </>
  );
}

export default function ComparePage() {
  return (
    <Suspense>
      <CompareView />
    </Suspense>
  );
}

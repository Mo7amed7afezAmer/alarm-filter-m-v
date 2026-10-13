"use client";

import {
  CATEGORIES,
  HOURLY_SHEETS,
  filterHourlyRows,
  hourlyFacets,
  officeColor,
  sortHourlyRows,
  type HourlyMeta,
  type HourlyRow,
} from "@alarm/core";
import { ArrowLeft, ClipboardCopy, Download, FilterX, GitCompare, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { Field, TextFilter } from "@/components/filters";
import {
  api,
  ApiError,
  apiQueryFromParams,
  loadAllRows,
  processReport,
  useHourlyUrl,
  waitForReport,
  type ReportItem,
} from "@/components/hourly/client";
import { ColumnChooser, copyRows, HourlyTable, useColumnPrefs } from "@/components/hourly/hourly-table";
import { MultiSelect } from "@/components/hourly/multi-select";
import { TableImageButton } from "@/components/hourly/table-image";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type State =
  | { kind: "loading" }
  | { kind: "needs-process" }
  | { kind: "processing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: HourlyRow[]; meta: HourlyMeta };

function ResultsView({ gmailId }: { gmailId: string }) {
  const { timeZone, role } = useAppConfig();
  const canProcess = role === "OPERATOR" || role === "ADMIN";
  const { params, filters, sort, setMany, setOne, setSort, clear, active } = useHourlyUrl();
  const cols = useColumnPrefs();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { rows, meta } = await loadAllRows(gmailId);
      setState({ kind: "ready", rows, meta });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setState({ kind: "needs-process" });
      else setState({ kind: "error", message: (e as Error).message });
    }
  }, [gmailId]);

  useEffect(() => {
    void load();
    api<{ data: ReportItem[] }>("/api/hourly-reports?page=1")
      .then((r) => setReports(r.data))
      .catch(() => setReports([]));
  }, [load]);

  const process = async () => {
    setState({ kind: "processing" });
    try {
      await processReport(gmailId);
      await waitForReport(gmailId);
      await load();
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  };

  const idx = reports.findIndex((r) => r.gmailId === gmailId);
  const current = idx >= 0 ? reports[idx] : undefined;
  const previous = idx >= 0 ? reports[idx + 1] : undefined;

  const rows = useMemo(() => (state.kind === "ready" ? state.rows : []), [state]);
  // option lists come from the data (within the selected sheet)
  const facets = useMemo(
    () => hourlyFacets(filters.sheet ? rows.filter((r) => r.sheets.includes(filters.sheet!)) : rows),
    [rows, filters.sheet],
  );
  const sheetCounts = useMemo(() => hourlyFacets(rows).sheet, [rows]);
  const shown = useMemo(() => sortHourlyRows(filterHourlyRows(rows, filters), sort), [rows, filters, sort]);

  const exportHref = useMemo(() => {
    const q = apiQueryFromParams(params);
    q.set("columns", cols.visible.join(","));
    return `/api/hourly-reports/${encodeURIComponent(gmailId)}/export?${q}`;
  }, [params, cols.visible, gmailId]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const meta = state.kind === "ready" ? state.meta : null;

  return (
    <>
      <PageHeader
        title="Hourly report"
        count={meta ? shown.length : null}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/hourly" className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-3.5 w-3.5" /> All reports
            </Link>
            {current && (
              <span>
                Received {formatDateTime(current.receivedAt, timeZone)} · {current.fileName}
              </span>
            )}
            {meta && (
              <span className="text-slate-400">
                processed {formatDateTime(meta.processedAt, timeZone)} in {(meta.durationMs / 1000).toFixed(1)} s
              </span>
            )}
          </span>
        }
        actions={
          meta && (
            <>
              <ColumnChooser visible={cols.visible} onChange={cols.setVisible} onReset={cols.reset} />
              <Button
                size="sm"
                variant="outline"
                className="bg-white"
                onClick={() =>
                  copyRows(shown, cols.visible).then(
                    () => flash(`Copied ${shown.length.toLocaleString("en-US")} rows`),
                    (e) => flash(`Copy failed: ${(e as Error).message}`),
                  )
                }
              >
                <ClipboardCopy className="h-4 w-4" />
                Copy as table
              </Button>
              <TableImageButton
                rows={shown}
                visibleColumns={cols.visible}
                filters={filters}
                title={`Nokia hourly report${current ? ` · ${formatDateTime(current.receivedAt, timeZone)}` : ""}`}
                fileStem={`hourly-${(current?.receivedAt ?? meta.processedAt).slice(0, 16).replace(/[-:]/g, "").replace("T", "_")}`}
              />
              {previous && (
                <Button size="sm" variant="outline" className="bg-white" asChild>
                  <Link
                    href={`/hourly/compare?a=${encodeURIComponent(previous.gmailId)}&b=${encodeURIComponent(gmailId)}`}
                  >
                    <GitCompare className="h-4 w-4" />
                    Compare with previous
                  </Link>
                </Button>
              )}
              <Button size="sm" asChild>
                <a href={exportHref} data-testid="export-excel">
                  <Download className="h-4 w-4" />
                  Export Excel
                </a>
              </Button>
            </>
          )
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {state.kind === "loading" && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-14 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading report…
        </div>
      )}
      {state.kind === "processing" && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-sky-300 bg-sky-50 py-14 text-sm text-sky-800">
          <Loader2 className="h-5 w-5 animate-spin" /> Downloading and extracting the report…
        </div>
      )}
      {state.kind === "needs-process" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white py-12 text-sm text-slate-600">
          This report has not been processed yet.
          {canProcess ? (
            <Button size="sm" onClick={() => void process()}>
              <Play className="h-4 w-4" /> Process now
            </Button>
          ) : (
            <span className="text-slate-500">Ask an operator to process it.</span>
          )}
        </div>
      )}
      {state.kind === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 py-10 text-sm text-red-800">
          {state.message}
          <Button size="sm" variant="outline" className="bg-white" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {meta && (
        <>
          <div className="sticky top-14 z-20 -mx-1 space-y-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <div role="tablist" aria-label="Sheet" className="flex gap-1 overflow-x-auto">
              {[{ value: "", count: rows.length }, ...HOURLY_SHEETS.map((s) => ({
                value: s,
                count: sheetCounts.find((c) => c.value === s)?.count ?? 0,
              }))].map((s) => {
                const on = (filters.sheet ?? "") === s.value;
                return (
                  <button
                    key={s.value || "all"}
                    role="tab"
                    aria-selected={on}
                    onClick={() => setOne("sheet", s.value || null)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                      on ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {s.value ? s.value.replace("_", " ") : "All sheets"}
                    <span className={cn("tabular-nums text-xs", on ? "text-slate-300" : "text-slate-400")}>
                      {s.count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
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
              <Field label="Region">
                <MultiSelect
                  label="Region"
                  className="sm:w-28"
                  options={facets.region}
                  value={filters.region ?? []}
                  onChange={(v) => setMany("region", v)}
                />
              </Field>
              <Field label="Site type">
                <MultiSelect
                  label="Site type"
                  className="sm:w-36"
                  options={facets.siteType}
                  value={filters.siteType ?? []}
                  onChange={(v) => setMany("siteType", v)}
                />
              </Field>
              <Field label="Category">
                <MultiSelect
                  label="Category"
                  className="sm:w-32"
                  options={CATEGORIES.map((c) => ({ value: c }))}
                  value={filters.category ?? []}
                  onChange={(v) => setMany("category", v)}
                />
              </Field>
              <Field label="VIP">
                <select
                  aria-label="VIP"
                  className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm shadow-sm sm:w-28"
                  value={filters.vip === undefined ? "" : String(filters.vip)}
                  onChange={(e) => setOne("vip", e.target.value || null)}
                >
                  <option value="">All</option>
                  <option value="true">VIP only</option>
                  <option value="false">Non-VIP</option>
                </select>
              </Field>
              <Field label="Alarm time from">
                <Input
                  type="datetime-local"
                  className="w-full bg-white sm:w-48"
                  value={filters.from ?? ""}
                  onChange={(e) => setOne("from", e.target.value || null)}
                />
              </Field>
              <Field label="to">
                <Input
                  type="datetime-local"
                  className="w-full bg-white sm:w-48"
                  value={filters.to ?? ""}
                  onChange={(e) => setOne("to", e.target.value || null)}
                />
              </Field>
              <div className="col-span-2 sm:col-span-1">
                <TextFilter
                  label="Search code / name"
                  value={filters.q ?? ""}
                  placeholder="e.g. 3273DE or BH-6"
                  onChange={(v) => setOne("q", v)}
                />
              </div>
              {active > 0 && (
                <Button size="sm" variant="ghost" className="self-end" onClick={clear}>
                  <FilterX className="h-4 w-4" /> Clear filters
                </Button>
              )}
            </div>
          </div>

          <HourlyTable rows={shown} columns={cols.visible} sort={sort} onSort={setSort} />

          <div className="flex flex-col gap-1 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span data-testid="row-count">
              Showing <b className="text-slate-800">{shown.length.toLocaleString("en-US")}</b> of{" "}
              {rows.length.toLocaleString("en-US")} rows
              {meta.emptyCodes > 0 && <> · {meta.emptyCodes} rows without a site code</>}
            </span>
            {meta.unmatchedCodes > 0 && (
              <span>
                <b className="text-amber-700">{meta.unmatchedCodes}</b> site codes are not in Site Master —{" "}
                <Link href="/settings/site-master" className="font-medium text-sky-700 underline-offset-2 hover:underline">
                  import Site Master
                </Link>
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default function HourlyResultsPage({ params }: { params: { gmailId: string } }) {
  return (
    <Suspense>
      <ResultsView gmailId={decodeURIComponent(params.gmailId)} />
    </Suspense>
  );
}

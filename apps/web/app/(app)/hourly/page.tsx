"use client";

import { zonedToUtc } from "@alarm/core";
import { FileArchive, Play, RefreshCw, Table2, Zap } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { Field, FilterBar, useUrlFilters } from "@/components/filters";
import { formatBytes, processReport, type ReportItem } from "@/components/hourly/client";
import { ReportStatusBadge } from "@/components/hourly/status-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/components/use-poll";
import { dateInputValue, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ListResponse {
  data: ReportItem[];
  meta: { page: number; hasMore: boolean };
}

/** Start/end of a local calendar day (YYYY-MM-DD) in `timeZone`, as an ISO instant. */
function dayBound(day: string, timeZone: string, end: boolean): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = end ? zonedToUtc(y, m, d, 23, 59, 59, timeZone) : zonedToUtc(y, m, d, 0, 0, 0, timeZone);
  return new Date(t.getTime() + (end ? 999 : 0)).toISOString();
}

function ReportsView() {
  const { timeZone, role } = useAppConfig();
  const canProcess = role !== "VIEWER";
  const { params, set } = useUrlFilters();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? 1);
  const today = dateInputValue(new Date(), timeZone);

  const q = new URLSearchParams({ page: String(page) });
  if (from) q.set("from", dayBound(from, timeZone, false));
  if (to) q.set("to", dayBound(to, timeZone, true));
  const { data, error, loading, reload } = usePoll<ListResponse>(`/api/hourly-reports?${q}`, 60_000);
  const [actionError, setActionError] = useState<string | null>(null);

  // fast refresh while anything is processing
  const busy = data?.data.some((r) => r.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void reload(), 2000);
    return () => clearInterval(id);
  }, [busy, reload]);

  const run = async (gmailId: string, force = false) => {
    setActionError(null);
    try {
      await processReport(gmailId, force);
    } catch (e) {
      setActionError((e as Error).message);
    }
    await reload();
  };

  const reports = data?.data ?? [];
  const latest = reports[0];

  return (
    <>
      <PageHeader
        title="Hourly Alarms"
        subtitle={
          <>
            Nokia hourly reports from the Gmail label <b>Hourly Update</b> — processed on demand,
            nothing is stored.
          </>
        }
        actions={
          <>
            <Button size="sm" variant="outline" className="bg-white" onClick={() => void reload()}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
            {canProcess && latest && (
              <Button
                size="sm"
                disabled={latest.status === "processing"}
                onClick={() => void run(latest.gmailId, latest.status === "failed")}
              >
                <Zap className="h-4 w-4" />
                Process latest
              </Button>
            )}
          </>
        }
      />

      <FilterBar active={[from, to].filter(Boolean).length}>
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <Field label="Received from">
            <Input
              type="date"
              className="w-full bg-white sm:w-40"
              value={from}
              max={to || today}
              onChange={(e) => set({ from: e.target.value || null })}
            />
          </Field>
          <Field label="Received to">
            <Input
              type="date"
              className="w-full bg-white sm:w-40"
              value={to}
              min={from}
              max={today}
              onChange={(e) => set({ to: e.target.value || null })}
            />
          </Field>
        </div>
        {(from || to) && (
          <Button size="sm" variant="ghost" onClick={() => set({ from: null, to: null })}>
            Clear dates
          </Button>
        )}
      </FilterBar>

      {(error || actionError) && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError ?? `Could not load: ${error}`}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[44rem] text-sm" data-testid="reports-table">
          <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="h-10 px-3">Received ({timeZone})</th>
              <th className="px-3">Sender</th>
              <th className="px-3">File</th>
              <th className="px-3 text-right">Size</th>
              <th className="px-3">Status</th>
              <th className="px-3" />
            </tr>
          </thead>
          <tbody>
            {!reports.length && (
              <tr>
                <td colSpan={6} className="py-14 text-center text-slate-500">
                  {loading ? "Loading…" : "No hourly reports in this range"}
                </td>
              </tr>
            )}
            {reports.map((r) => (
              <tr key={r.gmailId} className="border-t border-slate-100" data-gmail-id={r.gmailId}>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                  {formatDateTime(r.receivedAt, timeZone)}
                </td>
                <td className="max-w-[16rem] truncate px-3 text-slate-600" title={r.sender}>
                  {r.sender.replace(/<.*>/, "").trim() || r.sender}
                </td>
                <td className="px-3">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-800">
                    <FileArchive className="h-4 w-4 text-slate-400" />
                    {r.fileName}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 text-right tabular-nums text-slate-600">
                  {formatBytes(r.fileSize)}
                </td>
                <td className="px-3">
                  <ReportStatusBadge item={r} />
                </td>
                <td className="whitespace-nowrap px-3 text-right">
                  <div className="flex justify-end gap-1.5">
                    {canProcess && r.status !== "done" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white"
                        disabled={r.status === "processing"}
                        onClick={() => void run(r.gmailId, r.status === "failed")}
                      >
                        <Play className="h-3.5 w-3.5" />
                        {r.status === "failed" ? "Retry" : "Process"}
                      </Button>
                    )}
                    {r.status === "done" && (
                      <Button size="sm" asChild>
                        <Link href={`/hourly/${encodeURIComponent(r.gmailId)}`}>
                          <Table2 className="h-3.5 w-3.5" />
                          Open
                        </Link>
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && (page > 1 || data.meta.hasMore) && (
        <div className="flex justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
            Newer
          </Button>
          <Button size="sm" variant="outline" disabled={!data.meta.hasMore} onClick={() => set({ page: String(page + 1) })}>
            Older
          </Button>
        </div>
      )}
      {!canProcess && (
        <p className="text-xs text-slate-500">
          Reports are processed by operators and admins. Processed reports stay available for{" "}
          {"~30"} minutes and are re-processed automatically when opened later.
        </p>
      )}
    </>
  );
}

export default function HourlyPage() {
  return (
    <Suspense>
      <ReportsView />
    </Suspense>
  );
}

"use client";

import { zonedToUtc } from "@alarm/core";
import type { ColumnDef } from "@tanstack/react-table";
import { Suspense, useMemo } from "react";
import { useAppConfig } from "@/components/app-config";
import { CategoryBadge, ClearTypeBadge } from "@/components/badges";
import { DataTable, Pager } from "@/components/data-table";
import { CategoryFilter, Field, FilterBar, TextFilter, useUrlFilters } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/components/use-poll";
import { dateInputValue, formatDateTime, formatMinutes } from "@/lib/format";

interface ClearedAlarm {
  id: number;
  alarmName: string;
  site: string;
  category: string;
  alarmTime: string;
  clearTime: string;
  durationMin: number | null;
  clearType: string | null;
  region: string | null;
  cellName: string | null;
  device: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

/** Start/end of a local calendar day (YYYY-MM-DD) in `timeZone`, as an ISO instant. */
function dayBoundIso(day: string, timeZone: string, end: boolean): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = end
    ? zonedToUtc(y, m, d, 23, 59, 59, timeZone)
    : zonedToUtc(y, m, d, 0, 0, 0, timeZone);
  return new Date(t.getTime() + (end ? 999 : 0)).toISOString();
}

function ClearedView() {
  const { timeZone } = useAppConfig();
  const { params, set } = useUrlFilters();
  const today = dateInputValue(new Date(), timeZone);
  const yesterday = dateInputValue(new Date(Date.now() - 86_400_000), timeZone);
  const from = params.get("from") ?? yesterday;
  const to = params.get("to") ?? today;
  const category = params.get("category") ?? "";
  const site = params.get("site") ?? "";
  const page = Number(params.get("page") ?? 1);

  const filter = new URLSearchParams();
  filter.set("from", dayBoundIso(from, timeZone, false));
  filter.set("to", dayBoundIso(to, timeZone, true));
  if (category) filter.set("category", category);
  if (site) filter.set("site", site);
  const query = new URLSearchParams(filter);
  query.set("page", String(page));
  query.set("pageSize", "100");

  const { data, error, loading } = usePoll<Page<ClearedAlarm>>(
    `/api/alarms/cleared?${query}`,
    60_000,
  );

  const columns = useMemo<ColumnDef<ClearedAlarm, unknown>[]>(
    () => [
      {
        accessorKey: "category",
        header: "Category",
        cell: (c) => <CategoryBadge value={c.getValue() as string} />,
      },
      { accessorKey: "alarmName", header: "Alarm" },
      {
        accessorKey: "site",
        header: "Site",
        cell: (c) => <span className="font-mono text-xs">{c.getValue() as string}</span>,
      },
      {
        id: "cell",
        header: "Cell / device",
        accessorFn: (r) => r.cellName ?? r.device ?? "",
        cell: (c) => <span className="font-mono text-xs">{(c.getValue() as string) || "—"}</span>,
      },
      {
        accessorKey: "alarmTime",
        header: "Raised",
        cell: (c) => formatDateTime(c.getValue() as string, timeZone),
      },
      {
        accessorKey: "clearTime",
        header: "Cleared",
        cell: (c) => formatDateTime(c.getValue() as string, timeZone),
      },
      {
        accessorKey: "durationMin",
        header: "Duration",
        cell: (c) => (
          <span className="tabular-nums">{formatMinutes(c.getValue() as number | null)}</span>
        ),
      },
      {
        accessorKey: "clearType",
        header: "Clear type",
        cell: (c) => <ClearTypeBadge value={c.getValue() as string | null} />,
      },
    ],
    [timeZone],
  );

  const exportQuery = new URLSearchParams(filter);
  exportQuery.set("status", "cleared");

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Cleared alarms{" "}
          {data && (
            <span className="text-muted-foreground">({data.total.toLocaleString("en-US")})</span>
          )}
        </h1>
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/export?${exportQuery}`}>Export .xlsx</a>
        </Button>
      </div>

      <FilterBar>
        <Field label="From">
          <Input
            type="date"
            className="w-40"
            value={from}
            max={to}
            onChange={(e) => set({ from: e.target.value || null })}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            className="w-40"
            value={to}
            min={from}
            max={today}
            onChange={(e) => set({ to: e.target.value || null })}
          />
        </Field>
        <CategoryFilter value={category} onChange={(v) => set({ category: v })} />
        <TextFilter
          label="Site"
          value={site}
          placeholder="e.g. SK-ADLIYA"
          onChange={(v) => set({ site: v })}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          By clear time, {timeZone} days
        </span>
      </FilterBar>

      {error && <p className="text-sm text-red-600">Could not load: {error}</p>}
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        empty={loading && !data ? "Loading…" : "No cleared alarms in this range"}
      />
      {data && (
        <Pager
          page={data.page}
          pages={data.pages}
          total={data.total}
          onPage={(p) => set({ page: String(p) })}
        />
      )}
    </>
  );
}

export default function ClearedPage() {
  return (
    <Suspense>
      <ClearedView />
    </Suspense>
  );
}

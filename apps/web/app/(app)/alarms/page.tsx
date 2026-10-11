"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Suspense, useMemo } from "react";
import { useAppConfig } from "@/components/app-config";
import { CategoryBadge } from "@/components/badges";
import { DataTable, Pager } from "@/components/data-table";
import { CategoryFilter, Field, FilterBar, TextFilter, useUrlFilters } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { usePoll, useNow } from "@/components/use-poll";
import { ageMinutes, formatDateTime, formatMinutes } from "@/lib/format";

interface ActiveAlarm {
  id: number;
  alarmName: string;
  site: string;
  category: string;
  alarmTime: string;
  region: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

function AlarmsView() {
  const { timeZone, alertHours } = useAppConfig();
  const { params, set } = useUrlFilters();
  const now = useNow(30_000); // live age column
  const category = params.get("category") ?? "";
  const site = params.get("site") ?? "";
  const region = params.get("region") ?? "";
  const minHours = params.get("minHours") ?? "";
  const page = Number(params.get("page") ?? 1);

  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (site) query.set("site", site);
  if (region) query.set("region", region);
  if (minHours) query.set("minHours", minHours);
  query.set("page", String(page));
  query.set("pageSize", "100");

  const { data, error, loading, updatedAt, reload } = usePoll<Page<ActiveAlarm>>(
    `/api/alarms/active?${query}`,
    60_000,
  );

  const columns = useMemo<ColumnDef<ActiveAlarm, unknown>[]>(
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
        accessorKey: "region",
        header: "Region",
        cell: (c) => (c.getValue() as string | null) ?? "—",
      },
      {
        accessorKey: "alarmTime",
        header: "Raised",
        cell: (c) => formatDateTime(c.getValue() as string, timeZone),
      },
      {
        id: "age",
        header: "Age",
        accessorFn: (r) => ageMinutes(r.alarmTime, now),
        cell: (c) => <span className="tabular-nums">{formatMinutes(c.getValue() as number)}</span>,
      },
    ],
    [timeZone, now],
  );

  const exportQuery = new URLSearchParams(query);
  exportQuery.delete("page");
  exportQuery.delete("pageSize");
  exportQuery.set("status", "active");

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Active alarms{" "}
          {data && (
            <span className="text-muted-foreground">({data.total.toLocaleString("en-US")})</span>
          )}
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {updatedAt && <span>Updated {formatDateTime(new Date(updatedAt), timeZone)}</span>}
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
            Refresh
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/export?${exportQuery}`}>Export .xlsx</a>
          </Button>
        </div>
      </div>

      <FilterBar>
        <CategoryFilter value={category} onChange={(v) => set({ category: v })} />
        <TextFilter
          label="Site"
          value={site}
          placeholder="e.g. SK-ADLIYA"
          onChange={(v) => set({ site: v })}
        />
        <TextFilter label="Region" value={region} onChange={(v) => set({ region: v })} />
        <Field label="Older than">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={minHours}
            onChange={(e) => set({ minHours: e.target.value || null })}
          >
            <option value="">Any age</option>
            <option value="1">1 hour</option>
            <option value={String(alertHours)}>{alertHours} hours (alert)</option>
            <option value="24">1 day</option>
            <option value="72">3 days</option>
          </select>
        </Field>
        <span className="ml-auto text-xs text-muted-foreground">
          Rows older than {alertHours}h are highlighted · auto-refresh 60s
        </span>
      </FilterBar>

      {error && <p className="text-sm text-red-600">Could not load: {error}</p>}
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        empty={loading && !data ? "Loading…" : "No active alarms"}
        rowClassName={(r) =>
          ageMinutes(r.alarmTime, now) > alertHours * 60 ? "bg-red-50 hover:bg-red-100" : undefined
        }
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

export default function AlarmsPage() {
  return (
    <Suspense>
      <AlarmsView />
    </Suspense>
  );
}

"use client";

import { zonedToUtc } from "@alarm/core";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { Suspense, useMemo } from "react";
import {
  AlarmCard,
  AlarmName,
  Mono,
  siteMasterColumns,
  SiteCell,
  type SiteMasterInfo,
} from "@/components/alarm-bits";
import { useAppConfig } from "@/components/app-config";
import { CategoryBadge, ClearTypeBadge } from "@/components/badges";
import { DataTable, Pager } from "@/components/data-table";
import { CategoryFilter, Field, FilterBar, TextFilter, useUrlFilters } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/components/use-poll";
import { CATEGORY_STRIPE, dateInputValue, formatDateTime, formatMinutes } from "@/lib/format";

interface ClearedAlarm extends SiteMasterInfo {
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

function Duration({ min }: { min: number | null }) {
  return <span className="font-medium tabular-nums text-slate-800">{formatMinutes(min)}</span>;
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
      {
        accessorKey: "alarmName",
        header: "Alarm",
        cell: (c) => (
          <AlarmName value={c.getValue() as string} className="max-w-[14rem] 2xl:max-w-[22rem]" />
        ),
      },
      {
        accessorKey: "site",
        header: "Site",
        cell: (c) => <SiteCell site={c.getValue() as string} vip={c.row.original.vip} />,
      },
      {
        id: "cell",
        header: "Cell / device",
        accessorFn: (r) => r.cellName ?? r.device ?? "",
        cell: (c) => <Mono className="text-slate-500">{(c.getValue() as string) || "—"}</Mono>,
      },
      ...siteMasterColumns<ClearedAlarm>(),
      {
        accessorKey: "alarmTime",
        header: "Raised",
        cell: (c) => (
          <span className="text-slate-600">{formatDateTime(c.getValue() as string, timeZone)}</span>
        ),
      },
      {
        accessorKey: "clearTime",
        header: "Cleared",
        cell: (c) => (
          <span className="text-slate-600">{formatDateTime(c.getValue() as string, timeZone)}</span>
        ),
      },
      {
        accessorKey: "durationMin",
        header: "Duration",
        cell: (c) => <Duration min={c.getValue() as number | null} />,
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
      <PageHeader
        title="Cleared alarms"
        count={data?.total}
        subtitle={`By clear time · ${timeZone} days`}
        actions={
          <Button size="sm" variant="outline" className="bg-white" asChild>
            <a href={`/api/export?${exportQuery}`}>
              <Download className="h-4 w-4" />
              Export
            </a>
          </Button>
        }
      />

      <FilterBar
        active={[category, site, params.get("from"), params.get("to")].filter(Boolean).length}
      >
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <Field label="From">
            <Input
              type="date"
              className="w-full bg-white sm:w-40"
              value={from}
              max={to}
              onChange={(e) => set({ from: e.target.value || null })}
            />
          </Field>
          <Field label="To">
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
        <CategoryFilter value={category} onChange={(v) => set({ category: v })} />
        <TextFilter
          label="Site"
          value={site}
          placeholder="e.g. SK-ADLIYA"
          onChange={(v) => set({ site: v })}
        />
      </FilterBar>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load: {error}
        </p>
      )}
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        getRowId={(r) => String(r.id)}
        loading={loading && !data}
        empty="No cleared alarms in this range"
        rowClassName={(r) => CATEGORY_STRIPE[r.category]}
        renderCard={(r) => (
          <AlarmCard
            alarmName={r.alarmName}
            category={r.category}
            site={r.site}
            cell={r.cellName ?? r.device}
            info={r}
            meta={
              <span>
                {formatDateTime(r.alarmTime, timeZone)} → {formatDateTime(r.clearTime, timeZone)}
              </span>
            }
            right={
              <span className="flex items-center gap-2">
                <Duration min={r.durationMin} />
                <ClearTypeBadge value={r.clearType} />
              </span>
            }
          />
        )}
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

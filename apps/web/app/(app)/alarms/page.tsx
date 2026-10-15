"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCw } from "lucide-react";
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
import { CategoryBadge } from "@/components/badges";
import { DataTable, Pager } from "@/components/data-table";
import { CategoryFilter, Field, FilterBar, TextFilter, useUrlFilters } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { usePoll, useNow } from "@/components/use-poll";
import { ageMinutes, CATEGORY_STRIPE, formatDateTime, formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ActiveAlarm extends SiteMasterInfo {
  id: number;
  alarmName: string;
  site: string;
  category: string;
  alarmTime: string;
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

function AgeBadge({ minutes, alert }: { minutes: number; alert: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        alert ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700",
      )}
    >
      {formatMinutes(minutes)}
    </span>
  );
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

  const isAlert = (a: ActiveAlarm) => ageMinutes(a.alarmTime, now) > alertHours * 60;

  const columns = useMemo<ColumnDef<ActiveAlarm, unknown>[]>(
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
      {
        accessorKey: "region",
        header: "Region",
        cell: (c) => (c.getValue() as string | null) ?? <span className="text-slate-400">—</span>,
      },
      ...siteMasterColumns<ActiveAlarm>(),
      {
        accessorKey: "alarmTime",
        header: "Raised",
        cell: (c) => (
          <span className="text-slate-600">{formatDateTime(c.getValue() as string, timeZone)}</span>
        ),
      },
      {
        id: "age",
        header: "Age",
        accessorFn: (r) => ageMinutes(r.alarmTime, now),
        cell: (c) => (
          <AgeBadge
            minutes={c.getValue() as number}
            alert={(c.getValue() as number) > alertHours * 60}
          />
        ),
      },
    ],
    [timeZone, now, alertHours],
  );

  const exportQuery = new URLSearchParams(query);
  exportQuery.delete("page");
  exportQuery.delete("pageSize");
  exportQuery.set("status", "active");

  return (
    <>
      <PageHeader
        title="Active alarms"
        count={data?.total}
        subtitle={
          <>
            Rows older than {alertHours}h are highlighted · refreshes every minute
            {updatedAt && <> · updated {formatDateTime(new Date(updatedAt), timeZone)}</>}
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={() => void reload()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" className="bg-white" asChild>
              <a href={`/api/export?${exportQuery}`}>
                <Download className="h-4 w-4" />
                Export
              </a>
            </Button>
          </>
        }
      />

      <FilterBar active={[category, site, region, minHours].filter(Boolean).length}>
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
            className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm sm:w-40"
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
        empty="No active alarms — all clear"
        rowClassName={(r) =>
          cn(CATEGORY_STRIPE[r.category], isAlert(r) && "bg-red-50/70 hover:bg-red-50")
        }
        renderCard={(r) => (
          <AlarmCard
            alarmName={r.alarmName}
            category={r.category}
            site={r.site}
            cell={r.cellName ?? r.device}
            info={r}
            alert={isAlert(r)}
            meta={formatDateTime(r.alarmTime, timeZone)}
            right={<AgeBadge minutes={ageMinutes(r.alarmTime, now)} alert={isAlert(r)} />}
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

export default function AlarmsPage() {
  return (
    <Suspense>
      <AlarmsView />
    </Suspense>
  );
}

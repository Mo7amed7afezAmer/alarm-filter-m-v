"use client";

import Link from "next/link";
import {
  AlarmClock,
  ChevronRight,
  CircleCheck,
  Hourglass,
  PlugZap,
  TowerControl,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAppConfig } from "@/components/app-config";
import { PageHeader } from "@/components/page-header";
import { usePoll, useNow } from "@/components/use-poll";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Summary {
  active: { DOWN: number; POWER: number; OTHER: number; total: number };
  overdue: { count: number; alertHours: number };
  mttr: { days: number; byCategory: Record<string, { avgMin: number | null; count: number }> };
  last24h: { cleared: number; orphanClears: number; parseErrors: number };
  lastRun: { at: string | null; ageSec: number | null; messages: number; error: string | null };
}
interface Daily {
  series: { day: string; DOWN: number; POWER: number; OTHER: number }[];
}
interface TopSites {
  items: { site: string; total: number; active: number; region: string | null }[];
}

const COLORS = { DOWN: "#ef4444", POWER: "#f59e0b", OTHER: "#94a3b8" } as const;
const STALE_SEC = 5 * 60;

function SyncBar({ s }: { s: Summary["lastRun"] }) {
  const { timeZone } = useAppConfig();
  const now = useNow(15_000);
  // Age is recomputed locally between polls so the bar keeps counting.
  const age = s.at ? Math.round((now - new Date(s.at).getTime()) / 1000) : null;
  const stale = age === null || age > STALE_SEC;
  const bad = stale || !!s.error;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4",
        bad
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        <span className="relative flex h-2.5 w-2.5">
          {!bad && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full",
              bad ? "bg-red-500" : "bg-emerald-500",
            )}
          />
        </span>
        {age === null ? "Worker has never run" : `Last sync ${formatMinutes(age / 60)} ago`}
      </span>
      {s.at && <span className="opacity-80">at {formatDateTime(s.at, timeZone)}</span>}
      <span className="opacity-80">{s.messages} new messages in last run</span>
      {s.error && <span className="font-medium">Error: {s.error}</span>}
      {!s.error && stale && age !== null && (
        <span className="font-medium">Worker is not running</span>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  href,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  icon: LucideIcon;
  tone?: "red" | "amber" | "slate" | "emerald" | "rose";
}) {
  const tones = {
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-700",
  } as const;
  const body = (
    <div
      className={cn(
        "group flex h-full flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors",
        href && "hover:border-slate-300 hover:bg-slate-50/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            tones[tone],
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div>
        <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const summary = usePoll<Summary>("/api/stats/summary", 60_000);
  const daily = usePoll<Daily>("/api/stats/daily?days=30", 5 * 60_000);
  const top = usePoll<TopSites>("/api/stats/top-sites?limit=10", 5 * 60_000);
  const s = summary.data;
  const maxTop = Math.max(1, ...(top.data?.items ?? []).map((t) => t.total));
  const hours = s?.overdue.alertHours ?? 4;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live overview · refreshes every minute" />
      {s && <SyncBar s={s.lastRun} />}
      {summary.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load: {summary.error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Active · Down"
          value={s?.active.DOWN ?? "…"}
          href="/alarms?category=DOWN"
          icon={TowerControl}
          tone="red"
        />
        <StatCard
          label="Active · Power"
          value={s?.active.POWER ?? "…"}
          href="/alarms?category=POWER"
          icon={PlugZap}
          tone="amber"
        />
        <StatCard
          label="Active · Other"
          value={s?.active.OTHER ?? "…"}
          href="/alarms?category=OTHER"
          icon={TriangleAlert}
        />
        <StatCard
          label={`Older than ${hours}h`}
          value={s?.overdue.count ?? "…"}
          href={`/alarms?minHours=${hours}`}
          icon={AlarmClock}
          tone="rose"
        />
        <StatCard
          label="Cleared · 24h"
          value={s?.last24h.cleared ?? "…"}
          sub={
            s
              ? `${s.last24h.orphanClears} unmatched · ${s.last24h.parseErrors} unparsed`
              : undefined
          }
          href="/cleared"
          icon={CircleCheck}
          tone="emerald"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(["DOWN", "POWER", "OTHER"] as const).map((c) => {
          const m = s?.mttr.byCategory[c];
          return (
            <StatCard
              key={c}
              label={`MTTR · ${c[0]}${c.slice(1).toLowerCase()}`}
              value={m ? formatMinutes(m.avgMin) : "…"}
              sub={
                m
                  ? `${m.count.toLocaleString("en-US")} clears · last ${s?.mttr.days} days`
                  : undefined
              }
              icon={Hourglass}
              tone={c === "DOWN" ? "red" : c === "POWER" ? "amber" : "slate"}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Alarms raised per day · 30 days" className="lg:col-span-2">
          <div className="h-64 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily.data?.series ?? []} margin={{ left: -18, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d: string) => d.slice(5)}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0", fontSize: 12 }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="DOWN" stackId="a" fill={COLORS.DOWN} isAnimationActive={false} />
                <Bar dataKey="POWER" stackId="a" fill={COLORS.POWER} isAnimationActive={false} />
                <Bar
                  dataKey="OTHER"
                  stackId="a"
                  fill={COLORS.OTHER}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Top 10 sites · 30 days">
          <ol className="space-y-1">
            {(top.data?.items ?? []).map((t, i) => (
              <li key={t.site}>
                <Link
                  href={`/alarms?site=${encodeURIComponent(t.site)}`}
                  className="group block rounded-md px-2 py-1.5 hover:bg-slate-50"
                  title={t.site}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-4 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">
                      {t.site}
                    </span>
                    <span className="tabular-nums font-medium text-slate-900">{t.total}</span>
                    {t.active > 0 && (
                      <span className="rounded-full bg-red-50 px-1.5 text-[11px] font-medium tabular-nums text-red-600">
                        {t.active} active
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
                  </div>
                  <div className="ml-6 mt-1 h-1 rounded-full bg-slate-100">
                    <div
                      className="h-1 rounded-full bg-slate-400"
                      style={{ width: `${(t.total / maxTop) * 100}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
            {top.data && !top.data.items.length && (
              <li className="py-6 text-center text-sm text-slate-500">No data yet</li>
            )}
          </ol>
        </Panel>
      </div>
    </>
  );
}

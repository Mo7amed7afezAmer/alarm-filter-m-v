"use client";

import Link from "next/link";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const COLORS = { DOWN: "#dc2626", POWER: "#d97706", OTHER: "#64748b" } as const;
const STALE_SEC = 5 * 60;

function SyncBar({ s }: { s: Summary["lastRun"] }) {
  const { timeZone } = useAppConfig();
  const now = useNow(15_000);
  // Age is recomputed locally between polls so the bar keeps counting.
  const age = s.at ? Math.round((now - new Date(s.at).getTime()) / 1000) : null;
  const bad = age === null || age > STALE_SEC || !!s.error;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-4 py-2 text-sm",
        bad
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      <span className="font-medium">
        {age === null ? "Worker has never run" : `Last sync ${formatMinutes(age / 60)} ago`}
      </span>
      {s.at && <span>at {formatDateTime(s.at, timeZone)}</span>}
      <span>{s.messages} messages in last run</span>
      {s.error && <span className="font-medium">Error: {s.error}</span>}
      {!s.error && age !== null && age > STALE_SEC && (
        <span className="font-medium">Worker is not running</span>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  tone?: string;
}) {
  const body = (
    <Card className={cn("h-full transition-colors", href && "hover:bg-muted/50")}>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-3xl font-semibold tabular-nums", tone)}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function DashboardPage() {
  const summary = usePoll<Summary>("/api/stats/summary", 60_000);
  const daily = usePoll<Daily>("/api/stats/daily?days=30", 5 * 60_000);
  const top = usePoll<TopSites>("/api/stats/top-sites?limit=10", 5 * 60_000);
  const s = summary.data;

  return (
    <>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      {s && <SyncBar s={s.lastRun} />}
      {summary.error && <p className="text-sm text-red-600">Could not load: {summary.error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Active — Down"
          value={s?.active.DOWN ?? "…"}
          href="/alarms?category=DOWN"
          tone="text-red-600"
        />
        <Stat
          label="Active — Power"
          value={s?.active.POWER ?? "…"}
          href="/alarms?category=POWER"
          tone="text-amber-600"
        />
        <Stat label="Active — Other" value={s?.active.OTHER ?? "…"} href="/alarms?category=OTHER" />
        <Stat
          label={`Older than ${s?.overdue.alertHours ?? 4}h`}
          value={s?.overdue.count ?? "…"}
          href={`/alarms?minHours=${s?.overdue.alertHours ?? 4}`}
          tone="text-red-700"
        />
        <Stat
          label="Cleared (24h)"
          value={s?.last24h.cleared ?? "…"}
          sub={
            s
              ? `${s.last24h.orphanClears} unmatched clears · ${s.last24h.parseErrors} unparsed`
              : undefined
          }
          href="/cleared"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {(["DOWN", "POWER", "OTHER"] as const).map((c) => {
          const m = s?.mttr.byCategory[c];
          return (
            <Stat
              key={c}
              label={`MTTR — ${c[0]}${c.slice(1).toLowerCase()}`}
              value={m ? formatMinutes(m.avgMin) : "…"}
              sub={
                m
                  ? `${m.count.toLocaleString("en-US")} clears, last ${s?.mttr.days} days`
                  : undefined
              }
            />
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Alarms raised per day (30 days)</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily.data?.series ?? []} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="DOWN" stackId="a" fill={COLORS.DOWN} isAnimationActive={false} />
                <Bar dataKey="POWER" stackId="a" fill={COLORS.POWER} isAnimationActive={false} />
                <Bar dataKey="OTHER" stackId="a" fill={COLORS.OTHER} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 10 sites (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1.5 text-sm">
              {(top.data?.items ?? []).map((t, i) => (
                <li key={t.site} className="flex items-center gap-2">
                  <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
                  <Link
                    href={`/alarms?site=${encodeURIComponent(t.site)}`}
                    className="flex-1 truncate font-mono text-xs hover:underline"
                    title={t.site}
                  >
                    {t.site}
                  </Link>
                  <span className="tabular-nums">{t.total}</span>
                  <span
                    className={cn(
                      "w-14 text-right text-xs tabular-nums",
                      t.active ? "text-red-600" : "text-muted-foreground",
                    )}
                  >
                    {t.active} active
                  </span>
                </li>
              ))}
              {top.data && !top.data.items.length && (
                <li className="text-muted-foreground">No data yet</li>
              )}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

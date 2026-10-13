"use client";
// Client helpers for the /hourly pages: API calls, URL-synced filters (multi-value keys are
// repeated: ?office=A&office=B — the same keys the rows/export API takes).

import {
  CATEGORIES,
  HOURLY_DEFAULT_SORT,
  formatHourlySort,
  parseHourlySort,
  type Category,
  type HourlyFilters,
  type HourlyMeta,
  type HourlyRow,
  type HourlySort,
} from "@alarm/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export interface ReportItem {
  gmailId: string;
  receivedAt: string;
  sender: string;
  subject: string;
  fileName: string;
  fileSize: number;
  status: "pending" | "processing" | "done" | "failed";
  meta?: HourlyMeta;
  error?: string;
  startedAt?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** fetch JSON; 401 → /login (like usePoll); non-2xx → ApiError with the server message. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) {
    window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ApiError(401, "Not signed in");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** All rows of a processed report (rows API pages of 500), unfiltered — filtering is local. */
export async function loadAllRows(gmailId: string): Promise<{ rows: HourlyRow[]; meta: HourlyMeta }> {
  type Page = { data: HourlyRow[]; meta: { pages: number; report: HourlyMeta } };
  const base = `/api/hourly-reports/${encodeURIComponent(gmailId)}/rows?limit=500&sort=`;
  const first = await api<Page>(`${base}&page=1`);
  const rest = await Promise.all(
    Array.from({ length: first.meta.pages - 1 }, (_, i) => api<Page>(`${base}&page=${i + 2}`)),
  );
  return { rows: [first, ...rest].flatMap((p) => p.data), meta: first.meta.report };
}

export const processReport = (gmailId: string, force = false) =>
  api<{ data: { status: string } }>(
    `/api/hourly-reports/${encodeURIComponent(gmailId)}/process${force ? "?force=true" : ""}`,
    { method: "POST" },
  );

export const reportStatus = (gmailId: string) =>
  api<{ data: Pick<ReportItem, "status" | "meta" | "error"> }>(
    `/api/hourly-reports/${encodeURIComponent(gmailId)}/status`,
  );

/** Resolves when the report is done; rejects with the processing error. */
export async function waitForReport(gmailId: string, intervalMs = 1500): Promise<HourlyMeta> {
  for (;;) {
    const { data } = await reportStatus(gmailId);
    if (data.status === "done") return data.meta!;
    if (data.status === "failed") throw new Error(data.error ?? "Processing failed");
    if (data.status === "pending") throw new Error("Processing did not start");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---- URL filters ----

export const MULTI_KEYS = ["region", "office", "alarm", "siteType", "category"] as const;
type MultiKey = (typeof MULTI_KEYS)[number];
const SINGLE_KEYS = ["sheet", "vip", "from", "to", "q"] as const;
type SingleKey = (typeof SINGLE_KEYS)[number];

export function filtersFromParams(p: URLSearchParams): HourlyFilters {
  const many = (k: MultiKey) => {
    const v = p.getAll(k).filter(Boolean);
    return v.length ? v : undefined;
  };
  const vip = p.get("vip");
  return {
    sheet: p.get("sheet") || undefined,
    region: many("region"),
    office: many("office"),
    alarm: many("alarm"),
    siteType: many("siteType"),
    category: many("category")?.filter((c): c is Category =>
      (CATEGORIES as readonly string[]).includes(c),
    ),
    vip: vip === "true" ? true : vip === "false" ? false : undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    q: p.get("q") || undefined,
  };
}

/** Query string for the rows/export/diff API from the page URL (filters + sort only). */
export function apiQueryFromParams(p: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of [...MULTI_KEYS, ...SINGLE_KEYS, "sort"])
    for (const v of p.getAll(k)) if (v) out.append(k, v);
  return out;
}

export function useHourlyUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const sort: HourlySort = useMemo(() => parseHourlySort(params.get("sort")), [params]);

  const replace = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      const qs = next.toString();
      router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
    },
    [params, router, path],
  );

  const setMany = useCallback(
    (key: MultiKey, values: string[]) =>
      replace((n) => {
        n.delete(key);
        values.forEach((v) => n.append(key, v));
      }),
    [replace],
  );
  const setOne = useCallback(
    (key: SingleKey, value: string | null) =>
      replace((n) => (value ? n.set(key, value) : n.delete(key))),
    [replace],
  );
  const setSort = useCallback(
    (s: HourlySort) =>
      replace((n) => {
        const str = formatHourlySort(s);
        if (!s.length || str === formatHourlySort(HOURLY_DEFAULT_SORT)) n.delete("sort");
        else n.set("sort", str);
      }),
    [replace],
  );
  const clear = useCallback(
    () => replace((n) => [...MULTI_KEYS, ...SINGLE_KEYS].forEach((k) => k !== "sheet" && n.delete(k))),
    [replace],
  );
  const active = [...MULTI_KEYS, "vip", "from", "to", "q"].filter((k) => params.getAll(k).length).length;

  return { params, filters, sort, setMany, setOne, setSort, clear, active };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

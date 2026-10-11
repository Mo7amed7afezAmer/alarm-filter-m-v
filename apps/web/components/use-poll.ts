"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch JSON from `url`, re-fetch every `intervalMs` and whenever `url` changes.
 *  A 401 sends the user to /login. Keeps the previous data while reloading (no flicker). */
export function usePoll<T>(url: string | null, intervalMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const body = await res.json();
      if (my !== seq.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body as T);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void load();
    if (!intervalMs) return;
    const id = setInterval(() => void load(), intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  return { data, error, loading, updatedAt, reload: load };
}

/** Re-render every `ms` (for live "age" columns). Returns the current time. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

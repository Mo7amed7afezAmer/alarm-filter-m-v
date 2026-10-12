"use client";

import Link from "next/link";
import { Bell, BellOff, CheckCheck, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMinutes, splitAlarmName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "./badges";
import { usePoll, useNow } from "./use-poll";

interface Item {
  id: number;
  alarmName: string;
  site: string;
  cellName: string | null;
  device: string | null;
  category: string;
  alarmTime: string;
  status: "ACTIVE" | "CLEARED";
  createdAt: string;
  unread: boolean;
}

interface Feed {
  prefs: { enabled: boolean; sound: boolean };
  unread: number;
  items: Item[];
}

const POLL_MS = 30_000;
const TOAST_MS = 10_000;
const BASE_TITLE = "Alarm Filter";

/** Two short beeps via WebAudio (no asset). Browsers allow it after the user has clicked once. */
function beep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* audio unavailable — the visual alerts still show */
  }
}

function ItemRow({ item, now, onClick }: { item: Item; now: number; onClick?: () => void }) {
  const { name } = splitAlarmName(item.alarmName);
  return (
    <Link
      href={`/alarms?site=${encodeURIComponent(item.site)}`}
      onClick={onClick}
      className={cn("block px-4 py-3 hover:bg-slate-50", item.unread && "bg-sky-50/60")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {item.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />}
          <span className="truncate text-sm font-medium text-slate-900" title={item.alarmName}>
            {name}
          </span>
        </span>
        <CategoryBadge value={item.category} />
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
        {item.site}
        {item.cellName ? ` · ${item.cellName}` : ""}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{formatMinutes((now - new Date(item.createdAt).getTime()) / 60_000)} ago</span>
        {item.status === "CLEARED" && <span className="text-emerald-700">cleared</span>}
      </div>
    </Link>
  );
}

export function NotificationBell() {
  const { data, reload } = usePoll<Feed>("/api/notifications", POLL_MS);
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Item[]>([]);
  const known = useRef<Set<number> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Detect alarms that appeared since the previous poll → sound + toast. The first load only
  // records what exists (no burst of alerts when the page opens).
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.items.map((i) => i.id));
    if (known.current) {
      const fresh = data.items.filter((i) => i.unread && !known.current!.has(i.id));
      if (fresh.length) {
        setToasts((t) => [...fresh.slice(0, 3), ...t].slice(0, 4));
        if (data.prefs.sound) beep();
        setTimeout(() => setToasts((t) => t.filter((x) => !fresh.includes(x))), TOAST_MS);
      }
    }
    known.current = ids;
  }, [data]);

  // Unread count in the browser tab title.
  useEffect(() => {
    document.title = data?.unread ? `(${data.unread}) ${BASE_TITLE}` : BASE_TITLE;
  }, [data?.unread]);

  // Close the panel on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = useCallback(async () => {
    await fetch("/api/notifications/read", { method: "POST" });
    await reload();
  }, [reload]);

  const unread = data?.unread ?? 0;
  const disabled = data && !data.prefs.enabled;

  return (
    <div className="relative" ref={panelRef}>
      <button
        className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
      >
        {disabled ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold tabular-nums text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-16 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  onClick={() => void markRead()}
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
              <Link
                href="/preferences#notifications"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                title="Notification settings"
              >
                <Settings2 className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {disabled ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Notifications are off.{" "}
                <Link
                  href="/preferences#notifications"
                  className="text-sky-700 underline"
                  onClick={() => setOpen(false)}
                >
                  Turn them on
                </Link>
              </p>
            ) : data?.items.length ? (
              data.items.map((i) => (
                <ItemRow key={i.id} item={i} now={now} onClick={() => setOpen(false)} />
              ))
            ) : (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No important alarms in the last 24 hours.
              </p>
            )}
          </div>
        </div>
      )}

      {/* New-arrival pop-ups */}
      <div className="pointer-events-none fixed right-2 top-16 z-50 flex w-[calc(100%-1rem)] max-w-sm flex-col gap-2 sm:right-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto overflow-hidden rounded-xl border border-red-200 bg-white shadow-lg ring-1 ring-red-100"
          >
            <div className="flex items-center justify-between bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-700">
              New important alarm
              <button
                aria-label="Dismiss"
                className="rounded p-0.5 hover:bg-red-100"
                onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ItemRow
              item={t}
              now={now}
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

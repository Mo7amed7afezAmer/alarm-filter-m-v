// Display helpers. All times are shown in ALARM_TZ, whatever the viewer's PC timezone.

export function formatDateTime(iso: string | Date | null, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "3d 4h", "5h 12m", "7m". */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  const m = Math.max(0, Math.round(min));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const r = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${r}m`;
  return `${r}m`;
}

export function ageMinutes(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / 60_000;
}

/** YYYY-MM-DD for <input type="date"> in `timeZone`. */
export function dateInputValue(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
}

export const CATEGORY_STYLES: Record<string, string> = {
  DOWN: "bg-red-100 text-red-800 border-red-200",
  POWER: "bg-amber-100 text-amber-800 border-amber-200",
  OTHER: "bg-slate-100 text-slate-700 border-slate-200",
};

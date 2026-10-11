// Wall-clock → UTC conversion for an IANA timezone, using only Intl (no deps, no I/O).

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset (ms) of `timeZone` from UTC at instant `utcMs`. */
function offsetAt(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Interpret a wall-clock time in `timeZone` and return the UTC instant. */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes settle the offset across DST transitions.
  let utc = naive - offsetAt(naive, timeZone);
  utc = naive - offsetAt(utc, timeZone);
  return new Date(utc);
}

const STAMP = /^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/** Parse "DD-MON-YYYY HH:mm:ss" as wall-clock time in `timeZone`. Returns null if invalid. */
export function parseAlarmStamp(text: string, timeZone: string): Date | null {
  const m = STAMP.exec(text.trim());
  if (!m) return null;
  const [, dd, mon, yyyy, hh, mm, ss] = m as unknown as string[];
  const month = MONTHS[mon!.toUpperCase()];
  const [d, y, h, mi, s] = [dd, yyyy, hh, mm, ss].map(Number) as number[];
  if (!month || h! > 23 || mi! > 59 || s! > 59) return null;
  // Reject impossible calendar dates such as 31-FEB.
  const check = new Date(Date.UTC(y!, month - 1, d!));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== d) return null;
  return zonedToUtc(y!, month, d!, h!, mi!, s!, timeZone);
}

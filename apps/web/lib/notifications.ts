// Notification feed: NEW alarms (by createdAt) in the current office that match the user's prefs.
// Computed on read — no per-user notification rows to keep in sync.
import { matchesPrefs, normalizePrefs, type NotifyPrefs } from "@alarm/core";
import { prisma } from "./db";
import { officeFilter } from "./office";

const WINDOW_MS = 24 * 3_600_000;
const SCAN_LIMIT = 2_000;
export const FEED_LIMIT = 50;
/** A user who never opened the bell starts with the last 30 minutes as unread (no flood). */
const FIRST_SEEN_MS = 30 * 60_000;

export async function loadUserPrefs(userId: number) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyPrefs: true, notificationsSeenAt: true },
  });
  return {
    prefs: normalizePrefs(u?.notifyPrefs),
    seenAt: u?.notificationsSeenAt ?? null,
  };
}

export async function notificationFeed(userId: number, now = new Date()) {
  const { prefs, seenAt } = await loadUserPrefs(userId);
  const since = new Date(now.getTime() - WINDOW_MS);
  const effectiveSeen = seenAt ?? new Date(now.getTime() - FIRST_SEEN_MS);

  const recent = prefs.enabled
    ? await prisma.alarm.findMany({
        where: { createdAt: { gte: since }, ...(await officeFilter()) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: SCAN_LIMIT,
        select: {
          id: true,
          alarmName: true,
          site: true,
          cellName: true,
          device: true,
          category: true,
          alarmTime: true,
          status: true,
          createdAt: true,
        },
      })
    : [];

  const matching = recent.filter((a) => matchesPrefs(a, prefs));
  return {
    prefs,
    seenAt: effectiveSeen,
    unread: matching.filter((a) => a.createdAt > effectiveSeen).length,
    items: matching
      .slice(0, FEED_LIMIT)
      .map((a) => ({ ...a, unread: a.createdAt > effectiveSeen })),
  };
}

export type { NotifyPrefs };

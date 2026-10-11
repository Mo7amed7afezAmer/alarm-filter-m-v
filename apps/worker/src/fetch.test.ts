import { describe, expect, it } from "vitest";
import type { MailSource, MessageMeta } from "./gmail.js";
import { fetchAll, isQuotaError } from "./run.js";

const quota = Object.assign(new Error("Quota exceeded for quota metric 'Total Query Cost'"), {
  code: 429,
});

function source(failFrom: number, error: unknown = quota): MailSource {
  let n = 0;
  return {
    historySince: async () => ({ ids: [], historyId: "1" }),
    currentHistoryId: async () => "1",
    listSince: async () => [],
    getMeta: async (id): Promise<MessageMeta | null> => {
      if (n++ >= failFrom) throw error;
      return { gmailId: id, subject: `s${id}`, receivedAt: new Date(0), body: "" };
    },
  };
}

const ids = Array.from({ length: 12 }, (_, i) => String(i));

describe("fetchAll", () => {
  it("returns everything when Gmail does not throttle", async () => {
    const r = await fetchAll(source(Infinity), ids);
    expect(r).toMatchObject({ throttled: false });
    expect(r.metas).toHaveLength(12);
  });

  it("keeps the messages fetched before a quota error instead of losing the batch", async () => {
    const r = await fetchAll(source(7), ids);
    expect(r.throttled).toBe(true);
    expect(r.metas.map((m) => m.gmailId)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  });

  it("rethrows non-quota errors", async () => {
    await expect(fetchAll(source(2, new Error("boom")), ids)).rejects.toThrow("boom");
  });

  it("recognises Gmail quota errors", () => {
    expect(isQuotaError(quota)).toBe(true);
    expect(isQuotaError(Object.assign(new Error("User rate limit exceeded"), { code: 403 }))).toBe(
      true,
    );
    expect(isQuotaError(Object.assign(new Error("Forbidden"), { code: 403 }))).toBe(false);
  });
});

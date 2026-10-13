import { describe, expect, it } from "vitest";
import { ReportCache } from "./hourlyCache";

type V = { meta: { n: number } };
const value = (n: number): V => ({ meta: { n } });

describe("ReportCache", () => {
  it("runs once for concurrent callers (in-flight promise) and reports status", async () => {
    const c = new ReportCache<V>(60_000, 20);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = async () => {
      calls++;
      await gate;
      return value(1);
    };
    const p1 = c.run("a", fn);
    const p2 = c.run("a", fn);
    expect(c.status("a").status).toBe("processing");
    release();
    expect(await p1).toBe(await p2);
    expect(calls).toBe(1);
    expect(c.status("a")).toEqual({ status: "done", meta: { n: 1 } });
    expect(c.wasProcessed("a")).toBe(true);
    expect(c.status("b")).toEqual({ status: "pending" });
  });

  it("expires entries after the TTL", async () => {
    let now = 0;
    const c = new ReportCache<V>(1000, 20, () => now);
    await c.run("a", async () => value(1));
    now = 999;
    expect(c.get("a")).toBeDefined();
    now = 1000;
    expect(c.get("a")).toBeUndefined();
    expect(c.status("a").status).toBe("pending");
    expect(c.wasProcessed("a")).toBe(true); // may re-process transparently
  });

  it("evicts the least recently used entry beyond max", async () => {
    const c = new ReportCache<V>(60_000, 2);
    await c.run("a", async () => value(1));
    await c.run("b", async () => value(2));
    c.get("a"); // a is now most recent
    await c.run("c", async () => value(3));
    expect(c.get("a")).toBeDefined();
    expect(c.get("b")).toBeUndefined();
    expect(c.size).toBe(2);
  });

  it("records failures with their code and clears them on success", async () => {
    const c = new ReportCache<V>(60_000, 20);
    const err = Object.assign(new Error("bad rar"), { code: "BAD_SIGNATURE" });
    await expect(c.run("a", async () => Promise.reject(err))).rejects.toThrow("bad rar");
    expect(c.status("a")).toMatchObject({ status: "failed", error: "bad rar", code: "BAD_SIGNATURE" });
    expect(c.wasProcessed("a")).toBe(false);
    await c.run("a", async () => value(5));
    expect(c.status("a").status).toBe("done");
  });

  it("force re-runs a cached entry; clear() drops cached values", async () => {
    const c = new ReportCache<V>(60_000, 20);
    await c.run("a", async () => value(1));
    expect((await c.run("a", async () => value(2))).meta.n).toBe(1);
    expect((await c.run("a", async () => value(3), true)).meta.n).toBe(3);
    c.clear();
    expect(c.get("a")).toBeUndefined();
  });
});

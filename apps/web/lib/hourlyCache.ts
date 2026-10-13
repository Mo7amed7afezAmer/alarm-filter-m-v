// In-process LRU for processed hourly reports (§14: key gmailId, TTL HOURLY_CACHE_MIN = 30,
// max 20). One cache PER Next.js instance — fine for the single `web` container; with
// several instances each would process on its own. Lives on globalThis so dev hot reloads
// keep it. Nothing here is persisted; a restart simply means "process again".

export type CacheStatus<M> =
  | { status: "pending" }
  | { status: "processing"; startedAt: string }
  | { status: "done"; meta: M }
  | { status: "failed"; error: string; code?: string; at: string };

interface Entry<V> {
  value: V;
  expires: number;
}

export class ReportCache<V extends { meta: M }, M = V["meta"]> {
  private entries = new Map<string, Entry<V>>();
  private inflight = new Map<string, { promise: Promise<V>; startedAt: string }>();
  private failures = new Map<string, { error: string; code?: string; at: string }>();
  /** Ids processed successfully at least once — they may re-process transparently. */
  private known = new Set<string>();

  constructor(
    private ttlMs: number,
    private max: number,
    private now: () => number = Date.now,
  ) {}

  /** Cached value (refreshes LRU position) or undefined when absent/expired. */
  get(id: string): V | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    if (e.expires <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    this.entries.delete(id);
    this.entries.set(id, e);
    return e.value;
  }

  status(id: string): CacheStatus<M> {
    const v = this.get(id);
    if (v) return { status: "done", meta: v.meta };
    const f = this.inflight.get(id);
    if (f) return { status: "processing", startedAt: f.startedAt };
    const err = this.failures.get(id);
    if (err) return { status: "failed", ...err };
    return { status: "pending" };
  }

  wasProcessed(id: string): boolean {
    return this.known.has(id);
  }

  /**
   * Returns the cached value or runs `fn` once — concurrent callers share the same
   * in-flight promise. `force` skips the cached value (not an in-flight run).
   */
  run(id: string, fn: () => Promise<V>, force = false): Promise<V> {
    if (!force) {
      const v = this.get(id);
      if (v) return Promise.resolve(v);
    }
    const f = this.inflight.get(id);
    if (f) return f.promise;
    const startedAt = new Date(this.now()).toISOString();
    const promise = (async () => {
      try {
        const value = await fn();
        this.set(id, value);
        this.failures.delete(id);
        this.known.add(id);
        return value;
      } catch (err) {
        const e = err as { message?: string; code?: unknown };
        this.failures.set(id, {
          error: e.message ?? String(err),
          code: typeof e.code === "string" ? e.code : undefined,
          at: new Date(this.now()).toISOString(),
        });
        if (this.failures.size > 100) this.failures.delete(this.failures.keys().next().value!);
        throw err;
      } finally {
        this.inflight.delete(id);
      }
    })();
    this.inflight.set(id, { promise, startedAt });
    return promise;
  }

  private set(id: string, value: V) {
    this.entries.delete(id);
    this.entries.set(id, { value, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }

  /** Drop cached results (SiteMaster / normalization changed → enrichment is stale). */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

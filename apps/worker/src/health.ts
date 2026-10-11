// GET /health on :4000 — lastRunAt age and lastError from SystemStatus.
import { createServer, type Server } from "node:http";
import type { PrismaClient } from "@alarm/db";

export interface HealthState {
  startedAt: Date;
  running: boolean;
}

export function startHealthServer(
  prisma: PrismaClient,
  state: HealthState,
  port: number,
  staleAfterSec: number,
): Server {
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/health") {
      res.writeHead(404).end();
      return;
    }
    try {
      const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
      const now = Date.now();
      const lastRunAgeSec = s?.lastRunAt ? Math.round((now - s.lastRunAt.getTime()) / 1000) : null;
      const inGrace = now - state.startedAt.getTime() < staleAfterSec * 1000;
      const fresh = lastRunAgeSec !== null && lastRunAgeSec <= staleAfterSec;
      const ok = (fresh || inGrace) && !s?.lastError;
      const body = {
        ok,
        lastRunAt: s?.lastRunAt ?? null,
        lastRunAgeSec,
        lastError: s?.lastError ?? null,
        lastRunMessages: s?.lastRunMessages ?? 0,
        running: state.running,
      };
      // Unhealthy only when runs have stopped; a Gmail error is reported but keeps 200 so Docker
      // does not restart-loop the worker over an external problem.
      res.writeHead(fresh || inGrace ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    } catch (err) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    }
  });
  server.listen(port, "0.0.0.0");
  return server;
}

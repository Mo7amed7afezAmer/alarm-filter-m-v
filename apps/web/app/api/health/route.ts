// Phase 0 placeholder. Phase 6 adds the db check and worker lastRunAt age (CLAUDE.md §9).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true });
}

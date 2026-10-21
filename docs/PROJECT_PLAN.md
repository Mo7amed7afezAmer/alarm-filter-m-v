# Alarm Filter — Implementation Plan

**Status:** DRAFT v2 (2026-10-15) — awaiting approval. No code or files in the repository have been modified.
**Changes in v2:** Redis removed entirely (D-04); hourly-report processing moved to the client (D-10, Phase 5 rewritten); React Native mobile app added (Phase 7).
**Source of truth:** `REQUIREMENTS.md` (reverse-engineered, 2026-10-14, HEAD `a48b33d` + uncommitted working tree).
**Scope rule:** preserve every FR-01…FR-70 and NFR-01…NFR-43 as implemented. Nothing in this plan adds a feature that is not already described in REQUIREMENTS.md or CLAUDE.md; the mobile app from CLAUDE.md §13 is now planned (Phase 7); PWA/web push/tunnel remain backlog (§9).

---

## 1. Executive summary

The system is functionally complete for its core job (Gmail ingestion → matching engine → alarm views → hourly reports) with 31 engine tests and ~11 API integration tests, but it is **not deployable as-is** (no `web` service in compose, no backups, no README) and carries a list of 35 observed gaps (§8 of the requirements). The plan therefore prioritises:

1. **Deployability** (Phase 1) — ship what exists.
2. **Correctness of business rules** (Phase 2) — fix bugs without changing intended behaviour.
3. **REST API hardening** (Phase 3) — versioned, documented, consistent contracts; extraction into `apps/api` only if decision D-01 is approved.
4. **Test coverage** (Phase 4) — every untested route gets a test.
5. **Client-side hourly processing** (Phase 5) — RAR/XLSX parsing moves from the server to the browser, cutting server RAM from 8 GB to 4 GB; no Redis anywhere.
6. **Documentation sync** (Phase 6), then **React Native mobile app** (Phase 7) sharing `packages/core`.

Total estimate: **57–72 person-days** incl. mobile app (one senior full-stack engineer; see §8). Phases 1–2 alone (≈ 12 days) produce a production-ready release of the current functionality; Phase 7 is optional and separable.

---

## 2. Baseline (what exists)

| Area | State | Evidence |
|---|---|---|
| Monorepo | `apps/web` (Next.js 14, Route Handlers `/api/*`), `apps/worker` (node-cron), `packages/core`, `packages/db` (Prisma, PostgreSQL 16) | NFR-40, §1 |
| Ingestion | history.list / messages.list fallback, 200 msg/cycle, advisory lock 42, idempotent | FR-01–FR-09, NFR-10–12 |
| Engine | HASH subject parser, classification rules, dedupe, supersede, orphan clears, reprocess | FR-10–FR-24 |
| Auth | NextAuth credentials, JWT 12 h, VIEWER/OPERATOR/ADMIN | FR-25–FR-29 |
| Views/API | active/cleared lists, export, stats, office scope, hidden types, notifications | FR-30–FR-46 |
| Hourly reports | Gmail label list, RAR/XLSX validation + extraction, parse/enrich/normalize, cache, filters, export, diff, images | FR-47–FR-64 |
| Site Master / normalizations | import, list, edit, phone column (uncommitted migration) | FR-65–FR-68 |
| Ops | worker `/health`, web `/api/health`; compose has `db`, `migrate`, `worker` only | FR-69–FR-70, §8 #1 |
| Target host after D-10 | 2 vCPU / 4 GB / 40 GB SSD (was 8 GB for server-side hourly processing) | §3 D-10 |
| Tests | Vitest (core, worker, web), 1 Playwright smoke | NFR-41–42 |

---

## 3. Architectural decisions (need sign-off before Phase 3)

| ID | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| D-01 | API hosting | (a) keep Next.js Route Handlers, add `/api/v1` alias; (b) extract `apps/api` (Fastify) per CLAUDE.md §14 | **(a) now, (b) only when a non-browser client is confirmed.** (a) is 2–3 days; (b) is 10+ days and duplicates auth. | P3-T01…T08 |
| D-02 | API versioning | `/api/v1` prefix from day one vs. unversioned | `/api/v1` with `/api/*` kept as deprecated alias for one release | P3-T01 |
| D-03 | Scheduler | keep in-process `node-cron`; system cron; `pg-boss` queue | **Keep `node-cron`** — advisory lock already guarantees single run; revisit only if worker is scaled | — |
| D-04 | Shared cache / rate limiting | in-memory vs. Redis | **Redis removed from the design.** Single `web` replica is a documented constraint; login counters and idempotency keys are in-memory. With D-10 the server no longer holds a hourly cache at all | P3-T06, P3-T08 |
| D-05 | Office scoping of matching | keep global matching (current) vs. scope `findAlarm*`/`resetWindow` by office | **Needs product answer** — see R-01. Plan assumes "scope by office" is intended, but task P2-T01 starts with a confirmation step | P2-T01 |
| D-06 | Reverse proxy | none (publish `web:3000`) vs. nginx/Caddy with TLS | **Caddy** (auto-TLS or internal CA on LAN); required for Web Share / clipboard secure context (NFR-38) | P1-T03 |
| D-07 | Backups | `pg_dump` cron container vs. host cron | **Compose `backup` service** (daily `pg_dump`, 14-day retention, restore script) | P1-T04 |
| D-10 | Hourly-report processing location | (a) server (current: download, unrar, parse, cache); (b) client: server only streams the attachment, browser/mobile does unrar (WASM) + parse + export | **(b)** — removes the only RAM-heavy workload from the server (target 2 vCPU / 4 GB), no file is ever written to disk on server or device. Business rules unchanged: `packages/core` parse/enrich/normalize runs as-is on the client | Phase 5, Phase 7 |
| D-11 | RAR extraction on React Native | (a) server unrars and streams XLSX; (b) native module (UnrarKit/junrar); (c) WASM in hidden WebView | **(a)** — Hermes has no WebAssembly; `unrar` streaming on the server costs < 100 MB RAM. (b) only if the app must work with the server unreachable | P7-T04 |
| D-12 | Mobile framework | Expo (managed) vs. bare RN | **Expo SDK (latest stable), TypeScript, pnpm workspace `apps/mobile`**; EAS build; no Expo Go dependency if D-11(b) is chosen later | Phase 7 |
| D-08 | Login protection | none (current) vs. rate limit at proxy vs. in-app lockout | Rate limit at proxy (D-06) + in-app per-email counter | P3-T06 |

Technology stack stays as-is: Node 20, pnpm 9.15.9, Next.js 14, Prisma, PostgreSQL 16, Vitest, Playwright, Docker Compose, Debian `unrar` (NFR-33, NFR-36).

---

## 4. Phases and milestones

| Phase | Milestone | Exit criterion | Est. days |
|---|---|---|---|
| 0 | **M0 — Decisions signed** | D-01…D-08 answered; R-01…R-06 resolved or accepted | 1 |
| 1 | **M1 — Deployable release v1.0** | `docker compose up` brings up proxy+web+api+worker+db+backup; README + runbook exist; smoke test passes on a clean host | 6–7 |
| 2 | **M2 — Business-rule fixes v1.1** | All "behaviour fact" gaps (§8 #13–#24) closed or explicitly accepted; engine tests still green; no FR changed | 5–6 |
| 3 | **M3 — REST API v1** | `/api/v1` with uniform error envelope, OpenAPI spec, rate-limited login, API tokens for scripts (if D-01 approved) | 9–14 |
| 4 | **M4 — Coverage** | Every route in §8 #33 has ≥ 1 integration test incl. 401/403; CI runs unit + integration + e2e | 7–8 |
| 5 | **M5 — Client-side hourly** | Hourly RAR/XLSX processed in the browser; server streams attachments only; `hourlyCache` removed; §8 #27–#31 closed | 8–10 |
| 6 | **M6 — Docs sync** | CLAUDE.md, RUNBOOK.md, `.env.example` match the code | 2 |
| 7 | **M7 — Mobile app v1** | Expo app on iOS/Android: login, active/cleared alarms, hourly reports (parse/export/share/auto-delete temp files) against `/api/v1` | 10–13 |
| — | Buffer / reviews | — | 10–12 |

Execution order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Phases 4 and 5 can run in parallel; Phase 7 needs M3 (`/api/v1` + bearer tokens) and P5-T01 (attachment endpoint) only.

---

## 5. Detailed tasks

Legend — **Pri:** P0 blocker · P1 must · P2 should · P3 nice. **Effort** in person-days. **Trace** cites FR/NFR/§8 items. Every task includes "existing tests remain green" as an implicit acceptance criterion.

### Phase 0 — Decisions and baseline

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
|---|---|---|---|---|---|---|
| P0-T01 | Review this plan; record answers to D-01…D-08 and R-01…R-06 in `docs/DECISIONS.md` | — | §3, §7 | Document signed by product owner + tech lead | 0.5 | P0 |
| P0-T02 | Commit the uncommitted working tree (`SiteMaster.phone`, migration `20261014000000_site_phone`, per-category images) on a feature branch; run full test suite | — | FR-66, §8 #35 | Migration applies on fresh DB; `siteMaster.test.ts` green; branch pushed | 0.5 | P0 |

### Phase 1 — Deployability

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
|---|---|---|---|---|---|---|
| P1-T01 | Add `web` service to `docker-compose.yml` using `apps/web/Dockerfile`; depends on `migrate` success; healthcheck `/api/health` 30 s; mount OAuth files read-only; run as `node` | P0-T02 | §8 #1, NFR-26, NFR-32–33 | `docker compose up -d` → web healthy; login works; `/api/health` 200 with worker freshness | 1 | P0 |
| P1-T02 | Complete `.env.example` with all worker/web variables from §6 (incl. `OFFICE_LABEL_PARENTS`, `WORKER_CRON`, `MAX_MESSAGES_PER_RUN`, `INITIAL_BACKFILL_HOURS`, `HEALTH_STALE_AFTER_SEC`, `WORKER_HEALTH_PORT`, `HOURLY_*`) with defaults and comments | — | §8 #4, NFR-34 | Fresh clone + copy of `.env.example` boots without "missing env" errors; config `int()` validation passes | 0.5 | P0 |
| P1-T03 | Add `proxy` service (Caddy) in front of `web`; only service publishing ports; TLS per D-06; `/api/auth/*` and login rate limit (10 req/min/IP) | P1-T01, D-06 | NFR-38, §8 #22 | HTTPS reachable on LAN; Web Share / Copy image work in Chrome (secure context); 11th login attempt in a minute → 429 | 1 | P1 |
| P1-T04 | Add `backup` service: daily `pg_dump -Fc` to `./backups/` volume, 14-day retention, `scripts/restore.sh`; document restore test | P1-T01, D-07 | §8 #2, NFR-30 | Backup file appears; restore into empty DB reproduces `alarms` row count; procedure in RUNBOOK | 1 | P0 |
| P1-T05 | `docker-compose.dev.yml`: bind-mount `apps/*`/`packages/*`, `next dev` + `tsx watch` for worker, DB on `127.0.0.1:5432` | P1-T01 | §8 #3 | Editing a page hot-reloads; worker restarts on change | 1 | P2 |
| P1-T06 | Write `README.md` (purpose, architecture diagram from §1, quick start, env table, roles, troubleshooting) and finish RUNBOOK "Phase 8" (deploy, upgrade, migrate, backup/restore, Gmail token refresh, reprocess) | P1-T01–T04 | §8 #5, §8 #2 | A new engineer deploys from docs alone on a clean VM in < 1 h (dry run) | 1.5 | P1 |
| P1-T07 | Release v1.0: tag, changelog, migration dry-run on a copy of production data | P1-T01–T06 | — | Tag `v1.0.0`; `prisma migrate deploy` idempotent on copy | 0.5 | P1 |

### Phase 2 — Business-rule correctness (no behaviour additions)

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
|---|---|---|---|---|---|---|
| P2-T01 | Scope `findAlarm`, `findActiveAlarms`, `findAlarmByConsec`, `findOrphanClears`, `resetWindow` and pending-message query by `office` (per D-05). Step 1: write failing test reproducing cross-office match | P0-T01 (D-05) | §8 #13, FR-19–24, FR-23 | New engine test "clear in office A never closes alarm in office B" passes; reprocess test ×2 still deterministic (NFR-13) | 1.5 | P0 |
| P2-T02 | Verify §8 #17 with a test: body-less Clear vs. alarm with `consecNbr` via latest-active fallback; if confirmed, restrict fallback to alarms without `consecNbr` (consistent with FR-20 rule "consecNbr alarms never supersede") | P2-T01 | §8 #17, FR-21 | Test documents intended behaviour; decision recorded | 0.5 | P1 |
| P2-T03 | `PUT /api/rules`: re-classify only the current office's alarms unless `?office=*` (ADMIN) — or keep global per D-05 answer; document either way | P0-T01 | §8 #18, FR-17 | Integration test: rules change in office A leaves office B categories unchanged (or global, per decision) | 0.5 | P1 |
| P2-T04 | `/api/users` PATCH/DELETE: 404 for unknown id instead of 500; block self-demotion to any lower role (ADMIN → OPERATOR too) | — | §8 #19, FR-28 | Tests: unknown id → 404; admin self → OPERATOR → 400 | 0.5 | P1 |
| P2-T05 | `dateParam`: interpret `YYYY-MM-DD` as local midnight in `ALARM_TZ` (consistent with NFR-29 and FR-37 `localDay`) | — | §8 #20, NFR-29 | Unit test: `2026-10-14` in Africa/Cairo → `2026-10-13T21:00:00Z`; cleared list and export use it | 0.5 | P1 |
| P2-T06 | `/api/export`: either honour `page`/`pageSize` or remove them from the schema; keep 50,000-row cap | — | §8 #21, FR-35, NFR-09 | Test: >50,000 rows → 413; params behave as documented | 0.5 | P2 |
| P2-T07 | `GET /api/site-master`: keep readable by any user (FR-67 says so) but gate `/settings/site-master` **page** server-side to ADMIN (middleware), matching the client gate | — | §8 #24, NFR-18 | VIEWER requesting the page → redirect/403; API GET still 200 | 0.5 | P1 |
| P2-T08 | `GMAIL_LABELS`: either read all entries (document as list) or rename semantics to "default label" in docs/`.env.example` | — | §8 #14, FR-07 | Behaviour and docs agree; worker test for label resolution | 0.5 | P2 |
| P2-T09 | Notification feed: exclude alarms recreated by `reprocess` from "unread" (e.g. compare against `alarmTime`, or stamp reprocessed alarms) | P2-T01 | §8 #23, FR-44 | Test: after reprocess, previously-seen alarms are not unread | 1 | P2 |
| P2-T10 | ~~Hourly `parseFilters` / `maxEntries`~~ — superseded by Phase 5 (D-10); only the attachment size limits (`HOURLY_MAX_RAR_MB`, `HOURLY_MAX_XLSX_MB`) stay on the server in P5-T01 | — | §8 #26 | — | 0 | — |
| P2-T11 | Investigate §8 #34 (RECTIFIER shown as OTHER in dev DB): compare `rules` table with seed; add admin UI hint "reset to defaults" is **not** added (out of scope) — only document finding | — | §8 #34, FR-16 | Root cause written in `docs/DECISIONS.md` | 0.5 | P2 |

### Phase 3 — REST API v1 (conditional on D-01/D-02)

| ID | Task | Depends | Trace | Acceptance | Effort (a / b) | Pri |
|---|---|---|---|---|---|---|
| P3-T01 | Introduce `/api/v1` prefix: option (a) Next.js rewrite `/api/v1/:path*` → existing handlers; option (b) scaffold `apps/api` (Fastify + Prisma + shared zod schemas) and move handlers one domain at a time | P0-T01 | §8 #8, CLAUDE.md §14 | All existing integration tests pass against `/api/v1`; old paths return same responses (deprecation header) | 1 / 6 | P1 |
| P3-T02 | Uniform error envelope `{ error: { code, message, details? } }`; map zod flattened errors into `details`; keep status codes (400/401/403/404/409/413/422/429) | P3-T01 | NFR-23, FR-58 | Snapshot tests for each status; UI error toasts unchanged | 1 | P1 |
| P3-T03 | Generate OpenAPI 3.1 from zod schemas (`zod-to-openapi`); serve `/api/v1/openapi.json` + Swagger UI (ADMIN only) | P3-T02 | §8 #7, #33 | Spec validates; every route in §3 of requirements appears with its min role | 1.5 | P2 |
| P3-T04 | Shared `requireUser`/role middleware with declarative min-role per route; add 403 tests for every ADMIN/OPERATOR route (overlaps P4) | P3-T01 | NFR-17–18, FR-27 | Table-driven test: 23 protected routes × {VIEWER, OPERATOR} → expected 403/200 | 1.5 | P0 |
| P3-T05 | Office-scope middleware: resolve office once per request, inject into queries; explicit `?office=*` for ADMIN cross-office reads | P2-T01, P3-T04 | FR-40, §8 #13, #18 | No route reads `officeLabel` directly; integration tests for scope pass | 1 | P1 |
| P3-T06 | Login hardening: in-app per-email failure counter (5 fails → 15 min lockout), explicit `secret` in `authOptions`, `NEXTAUTH_SECRET` required at boot | P1-T03 | §8 #22, NFR-20 | Test: 6th bad password → 429/423; boot fails loudly without secret | 1 | P1 |
| P3-T07 | API tokens for scripts/mobile (`POST /api/v1/auth/tokens`, ADMIN; bearer auth path; `hashed` storage; revoke) — **only if D-01(b) or a script consumer is confirmed** | P3-T04 | CLAUDE.md §13 (`/api/auth/token`) | Token can call `/alarms`; revoked token → 401 | 1.5 | P3 |
| P3-T08 | `Idempotency-Key` on `PUT /rules`, `POST /site-master/import`, `POST /reprocess` (24 h window, in-memory map per D-04) | P3-T02 | FR-17, FR-24, FR-65 | Replayed request returns cached 2xx without re-executing | 1 | P3 |

### Phase 4 — Test coverage and CI

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
|---|---|---|---|---|---|---|
| P4-T01 | Integration tests for untested routes: `alarms/cleared`, `export`, `stats/daily`, `stats/top-sites`, `health`, `rules`, `reprocess`, `users`, `notifications`, `me/*`, `settings/*`, `alarm-names` | P2-* | §8 #33, FR-17, 24, 28, 31, 35–38, 40–46, 70 | Each route: 1 happy path + 1 validation (400) + auth (401) + role (403 where applicable) | 4 | P0 |
| P4-T02 | Worker tests for FR-01, FR-07–09 (tick skip while running, label resolution, status recording, label refresh throttle) | — | §8 #33, FR-01, 07–09 | 4 new tests in `apps/worker/src` | 1 | P1 |
| P4-T03 | Make fixture-dependent tests fail (not skip) in CI when `tests/fixtures`/`TEST_DATABASE_URL` are missing; keep skip locally | — | §8 #32, NFR-41 | CI job fails on missing fixtures; local run still skips with warning | 0.5 | P1 |
| P4-T04 | CI pipeline (GitHub Actions): lint, typecheck, unit, integration against Postgres service (`alarms_test`), Playwright smoke, Docker build | P4-T03 | NFR-41–43 | Green pipeline on main; < 15 min | 1.5 | P1 |

### Phase 5 — Client-side hourly processing (D-10)

Goal: keep FR-47…FR-64 behaviour identical for the user while moving download → unrar → parse → enrich → export off the server. No report data is stored on the server or on the device's disk; everything lives in memory for the session.

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
|---|---|---|---|---|---|---|
| P5-T01 | Server: `GET /api/v1/hourly-reports/{id}/attachment` — fetch the Gmail attachment, enforce `HOURLY_MAX_RAR_MB`/`HOURLY_MAX_XLSX_MB`, stream raw bytes with `Content-Type`/`Content-Length`; keep `GET /hourly-reports` (list) and label refresh. Add `GET …/xlsx` variant that unrars server-side and streams the first `.xlsx` (for D-11 mobile) | P3-T01 | FR-47–FR-52, NFR-09 | Integration tests: 200 + correct length; 413 over limit; 409 when no attachment; memory of `web` stays < 150 MB during a 40 MB RAR stream | 1.5 | P0 |
| P5-T02 | Extract browser-safe hourly logic into `packages/core/hourly` (parse, enrich, normalize, diff, clockInvalid, column mapping) with zero Node imports; existing server tests re-pointed to it | — | FR-53–FR-56, FR-61 | All current hourly unit tests pass against the new entry point; `tsc` with `lib: ["dom"]` succeeds | 1 | P0 |
| P5-T03 | Web Worker pipeline in `apps/web`: fetch attachment → `node-unrar-js` (WASM) → SheetJS → `packages/core/hourly` → post rows to UI; progress events; cancel on navigation; all buffers released after processing | P5-T01, P5-T02 | FR-50–FR-57 | 40k-row report processes in < 15 s on a mid-range Android (Chrome), < 5 s on laptop; UI stays responsive; no `File System Access` / download used | 2.5 | P0 |
| P5-T04 | Reference data on device: Site Master + normalizations fetched via existing `GET /site-master` / `GET /hourly-normalizations`, cached in IndexedDB with `updatedAt` ETag; invalidated on 304 miss | P5-T02 | FR-56, FR-66, FR-68 | Second load of a report makes no site-master request; editing a site invalidates cache within one list refresh | 1 | P1 |
| P5-T05 | Remove server-side `hourlyCache`, `/hourly-reports/{id}/process`, `/rows`, `/diff`, server `exportXlsx` for hourly; keep `/hourly-reports` list and the two attachment routes; delete related env (`HOURLY_CACHE_MIN`, `maxEntries`) and tests | P5-T03 | §8 #25, #26, #30 | No `unrar` call path left in `apps/web` except the `/xlsx` variant; Docker image RAM target met (≤ 4 GB host) | 1 | P1 |
| P5-T06 | Client export & share: Excel (SheetJS in worker, incl. `clockInvalid` column), copy as table, image (`html2canvas` existing), Web Share on mobile; diff/compare computed client-side from two processed reports | P5-T03 | FR-59–FR-64, §8 #27, #29 | e2e (Playwright, desktop + 390 px): export matches server export golden file row-for-row; compare works from any list page | 2 | P1 |
| P5-T07 | Hourly mobile card layout below `md` and remaining Site Master inline-edit fields (nodality, VIP, power source, battery, notes) | P5-T03 | §8 #28, #31, NFR-37, FR-67 | Playwright at 390 px shows cards; edit VIP → badge updates on `/alarms` | 2 | P2 |
| P5-T08 | Fallback & limits: if WASM unsupported (old browser) show "process on a laptop" message; cap in-memory reports at 3 per session; clear on logout | P5-T03 | NFR-08 | Unit tests for eviction; manual test on Safari iOS 16 | 0.5 | P2 |

### Phase 6 — Documentation sync

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
|---|---|---|---|---|---|---|
| P6-T01 | Update CLAUDE.md: roles (VIEWER/OPERATOR/ADMIN), data model fields, full route list, `parseMessage` location, Phase 7 checkbox, test counts, section numbering, "As built" vs §14 | P3-T03 | §8 #6–#11 | Review diff against code; OpenAPI spec is the route source | 1 | P1 |
| P6-T02 | Architecture doc `docs/ARCHITECTURE.md` (component diagram, request flow, worker cycle, data model §5, env §6, client-side hourly flow) | P1-T06, P5-T05 | §1, §5, §6 | Reviewed by second engineer | 1 | P2 |

### Phase 7 — React Native mobile app (`apps/mobile`, D-11/D-12)

Scope: the two daily-use screens (alarms, hourly reports) plus login; admin screens stay web-only. The app consumes `/api/v1` with bearer tokens and reuses `packages/core` unchanged.

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
|---|---|---|---|---|---|---|
| P7-T01 | Scaffold `apps/mobile` (Expo, TypeScript, pnpm workspace, Metro config for `packages/core`); CI builds via EAS (preview profile) | P3-T01, P3-T07 | CLAUDE.md §13 | `pnpm --filter mobile start` runs; import from `@alarm/core` resolves; EAS preview build on both OSs | 1.5 | P1 |
| P7-T02 | Auth: login screen → `POST /auth/login` → JWT in `expo-secure-store`; auto-refresh/logout on 401; office label shown | P7-T01, P3-T04 | FR-25–FR-27, NFR-20 | Token never in AsyncStorage; expired token → login screen; VIEWER sees no admin entry points | 1.5 | P1 |
| P7-T03 | Alarms: active/cleared lists with filters, 30 s/60 s polling, site badges (VIP/nodality), notification badge from `/notifications` | P7-T02 | FR-30–FR-34, FR-43–FR-46, NFR-06 | Same counts as web for the same filters (contract test); offline shows last data + stale banner | 2.5 | P1 |
| P7-T04 | Hourly: list from `/hourly-reports`; fetch `…/xlsx` (server unrar per D-11a) into memory; SheetJS + `packages/core/hourly` parse/enrich on device (chunked, off the UI frame); filters, sheet tabs | P7-T01, P5-T01, P5-T02 | FR-47–FR-58 | 40k rows parsed < 20 s on mid-range Android; no network needed after fetch; row values identical to web for the same report | 3 | P1 |
| P7-T05 | Reference data in `expo-sqlite` (Site Master, normalizations) with `updatedAt` sync, same policy as P5-T04 | P7-T04 | FR-56, FR-66, FR-68 | Works offline after first sync | 1 | P2 |
| P7-T06 | Export & share & cleanup: Excel via SheetJS → temp file → `expo-sharing`; image via `react-native-view-shot`; compare with previous report on device; **temp files deleted in `finally` after the share sheet closes**; in-memory reports cleared on logout | P7-T04 | FR-59–FR-64 | After share, `FileSystem.cacheDirectory` contains no report files; export matches web golden file | 2 | P1 |
| P7-T07 | LAN networking: HTTPS to Caddy (D-06) or ATS `NSAllowsLocalNetworking` for HTTP; configurable server URL screen | P7-T02 | NFR-38 | App connects on the NOC LAN on both OSs | 0.5 | P1 |
| P7-T08 | Store/enterprise distribution docs: EAS internal distribution (Android APK + iOS ad-hoc/TestFlight); runbook section | P7-T06 | — | A NOC phone installs the build from the documented link | 1 | P2 |


---

## 6. Dependency graph (critical path)

```
P0-T01 ─┬─ P0-T02 ─ P1-T01 ─┬─ P1-T03 ─ P3-T06
        │                   ├─ P1-T04 ─ P1-T06 ─ P1-T07 (M1)
        │                   └─ P1-T05
        └─ D-05 ─ P2-T01 ─┬─ P2-T02
                          ├─ P2-T09
                          └─ P3-T05
P3-T01 ─ P3-T02 ─┬─ P3-T03 ─ P6-T01
                 └─ P3-T04 ─ P3-T05 ─ P3-T07 / P3-T08
P2-* ─ P4-T01 ─ P4-T03 ─ P4-T04 (M4)
P5-T01 ─ P5-T03 ─ P5-T05 / P5-T06 (after M3 for /api/v1)
P3-T07 ─ P7-T01 ─ P7-T02 ─ P7-T03 / P7-T04 ─ P7-T06 (after P5-T01, P5-T02)
```

Critical path: P0-T01 → P2-T01 → P3-T04 → P3-T05 → P4-T01 → P4-T04.

---

## 7. Risks, assumptions, missing information

### Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R-01 | Office scoping of the matching engine (§8 #13) may be *intended* (alarms moving between labels). Changing it alters pairing results. | High — wrong clears | D-05 must be answered by NOC before P2-T01; task starts with a failing test and a data check on production `raw_messages` |
| R-02 | Reprocess after P2-T01 may re-pair historical alarms differently | Medium | Run reprocess on a DB copy, diff `alarms` before/after, review with NOC |
| R-03 | Extraction to `apps/api` (D-01 b) duplicates NextAuth session handling and doubles scope | High schedule | Recommend D-01(a); revisit when a real second client exists |
| R-04 | Gmail OAuth token expiry / quota during backfill | Medium | Already handled (FR-05, FR-06); add runbook step for token refresh (P1-T06) |
| R-05 | Caddy TLS on a LAN without public DNS | Low | Internal CA or self-signed with trust install; documented in P1-T03 |
| R-06 | `unrar` from Debian non-free licensing in the image | Low | Confirm acceptable; `node-unrar-js` fallback exists (FR-51) |
| R-07 | Single `web` replica assumption (lockout counters, idempotency map) | Low — hourly cache no longer exists on the server | Documented constraint; if a second replica is ever needed, move the two small maps to PostgreSQL tables, not Redis |
| R-09 | Client-side parsing on weak phones (CPU/RAM) may be slow or crash on very large RARs | Medium | Web Worker + chunked parsing; size caps enforced on the server (P5-T01); laptop fallback message (P5-T08); mobile uses server-unrarred XLSX (D-11a) |
| R-10 | Each user re-processes the same report (no shared cache) → N× Gmail attachment downloads | Low | Attachments are ~ MBs on a LAN; Gmail quota is per-project and far above NOC usage; monitor via worker status |
| R-11 | `node-unrar-js` WASM compatibility (RAR5, multi-volume, Safari iOS) | Medium | Spike in P5-T03 against real NOC fixtures from `tests/fixtures`; server `/xlsx` route is the fallback |
| R-12 | Mobile app maintenance (two OS builds, store policies) | Medium | Expo/EAS; admin features stay web-only to keep the app small |
| R-08 | Test DB (`alarms_test`) not available in CI | Medium | P4-T04 provisions a Postgres service container |

### Assumptions

- A-01 One engineer, full-time; estimates are engineering effort only (no PM/QA overhead beyond the buffer).
- A-02 Production runs on one Docker host on the NOC LAN (per §1); no cloud, no Kubernetes.
- A-03 The uncommitted working-tree changes are intended and will be committed as-is (P0-T02).
- A-04 Existing behaviour that is tested (31 engine tests, parser, hourly suites) is the specification; where code and CLAUDE.md disagree, code wins unless a decision says otherwise.
- A-05 `ALARM_TZ` stays `Africa/Cairo`; DST handling in `time.ts` is correct (26 parser tests).

### Missing information (to collect at P0-T01)

| ID | Question | Needed for |
|---|---|---|
| Q-01 | Is cross-office matching intended or a bug? | D-05, P2-T01, P2-T03 |
| Q-02 | Are there (or will there be) non-browser API consumers — scripts, dashboards, a mobile app? | D-01, P3-T07 |
| Q-03 | Hosting constraints: TLS certificate source on the LAN; who owns the Docker host? | P1-T03 |
| Q-04 | Backup retention and off-host copy requirement? | P1-T04 |
| Q-05 | Should `RECTIFIER` really map to POWER (seed) — explains §8 #34? | P2-T11 |
| Q-06 | Is the 50,000-row export cap and 500 page size acceptable for NOC usage? | P2-T06 |
| Q-07 | Will more than one NOC office use the system concurrently (affects whether office switching stays admin-global)? | FR-40, D-05 |
| Q-08 | Access to production `raw_messages` sample for reprocess diff (R-02)? | P2-T01 |
| Q-09 | Which phones does the NOC use (Android/iOS, model/year)? Needed to validate the client-side parsing budget | P5-T03, P7-T04 |
| Q-10 | Distribution for the mobile app: internal (APK/TestFlight) or public stores? Apple developer account available? | P7-T08 |
| Q-11 | Must the mobile app work when the server is unreachable (true offline unrar → D-11b)? | D-11 |

---

## 8. Effort summary and priorities

| Phase | Tasks | P0 | P1 | P2 | P3 | Est. days |
|---|---|---|---|---|---|---|
| 0 | 2 | 2 | — | — | — | 1 |
| 1 | 7 | 3 | 3 | 1 | — | 6.5 |
| 2 | 11 | 1 | 5 | 5 | — | 7 |
| 3 | 8 | 1 | 4 | 1 | 2 | 9.5 (a) / 14.5 (b) |
| 4 | 4 | 1 | 3 | — | — | 7 |
| 5 | 8 | 3 | 3 | 2 | — | 11.5 |
| 6 | 2 | — | 1 | 1 | — | 2 |
| 7 | 8 | — | 6 | 2 | — | 13 |
| **Total** | **50** | | | | | **≈ 57 (a) / 62 (b) + 20 % buffer → 57–72 (without Phase 7: 44–56)** |

Suggested first sprint (10 days): P0-T01, P0-T02, P1-T01–T04, P1-T06, P1-T07, P2-T01, P2-T04, P2-T05 → **M1 and half of M2**.

---

## 9. Out of scope / backlog (not planned, listed for traceability)

- PWA manifest, service worker, web push, `PushSubscription`/`NotificationPref` models, `cloudflared` (CLAUDE.md §13; §8 #12). `apps/mobile` is now Phase 7.
- Redis: **not planned at all** (D-04). Multi-replica `web` would use PostgreSQL tables instead.
- Gmail push notifications (Pub/Sub watch) replacing the 1-minute poll.
- Persisting body fields `neName`, `startTime`, `alarmNumber`, `kind` (§8 #15) and populating the `sites` table (§8 #16) — no requirement consumes them today.

---

## 10. Approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner (NOC) | | ☐ approve ☐ changes | |
| Tech lead | | ☐ approve ☐ changes | |

Implementation starts only after both approvals and the answers to Q-01…Q-08 are recorded.

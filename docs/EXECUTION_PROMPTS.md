# Execution prompts for `docs/PROJECT_PLAN.md` v2

Prompts written for a coding agent (Claude Code or similar) working inside the repository. One prompt per task or small task group, in plan order. Run them in separate sessions or clear context between phases; always start a session with the bootstrap prompt.

Conventions:
- Replace `<…>` placeholders before sending.
- Every prompt ends with the same three guard rails; keep them, they are what stops scope creep.
- Review the diff after each prompt before sending the next one. The agent must not start a task whose dependency (see plan §6) is not merged.

---

## 0. Session bootstrap (paste first, every session)

```
You are working in the Alarm Filter monorepo (Node 20, pnpm 9.15.9, Next.js 14, Prisma/PostgreSQL 16, node-cron worker).

Read, in this order, before doing anything:
1. REQUIREMENTS.md — the as-built spec (FR-xx, NFR-xx, §8 gaps). It is the source of truth for behaviour.
2. docs/PROJECT_PLAN.md v2 — phases, task IDs, dependencies, acceptance criteria, decisions D-01…D-12.
3. docs/ARCHITECTURE.md — components, flows, deployment.
4. docs/DECISIONS.md — answers to D-xx / Q-xx (if it exists; if not, stop and ask me for the answers the task needs).
5. CLAUDE.md and RUNBOOK.md.

Rules for this whole session:
- Work only on the task ID I give you. Do not touch other plan items, even if you notice a problem; list it under "Observations" at the end instead.
- Preserve existing business rules (FR-10…FR-24 engine, FR-27 roles, FR-53…FR-56 hourly parsing) exactly unless the task says otherwise. Existing tests must stay green.
- Every change starts with a failing test when the task has acceptance tests; run `pnpm test` (and the integration suite against TEST_DATABASE_URL when relevant) before you report done.
- Do not add dependencies, env vars, routes or features not named in the task. If you believe one is required, stop and ask.
- Work on branch `feat/<task-id>` (one branch per task). Conventional commit messages, task ID in the subject.
- Finish with a report in this format:
  ## <task-id> — done / blocked
  Files changed · Tests added/updated (names) · Commands run and results · Acceptance checklist from the plan with ✔/✘ · Observations (out-of-scope findings) · Questions.
Confirm you have read the four documents and tell me the current test counts before I give you the task.
```

---

## Phase 0 — Decisions and baseline

### P0-T01 (human task, no agent)
Fill `docs/DECISIONS.md` with answers to D-01…D-12 and Q-01…Q-14 from the plan and architecture docs. Template prompt if you want the agent to create the skeleton:

```
Task P0-T01 (skeleton only). Create docs/DECISIONS.md with one row per decision D-01…D-12 and one per question Q-01…Q-14 from docs/PROJECT_PLAN.md §3/§7 and docs/ARCHITECTURE.md §9: columns ID · Question/Decision · Options · Answer (empty) · Decided by · Date. Do not fill any answer. No other files.
```

### P0-T02
```
Task P0-T02. The working tree has uncommitted changes (SiteMaster.phone column, migration 20261014000000_site_phone, per-category hourly images). On branch feat/P0-T02:
1. Review the diff and summarise it to me before committing.
2. Verify the migration applies on a fresh database (`prisma migrate reset --force` against TEST_DATABASE_URL) and that siteMaster.test.ts and the full suite pass.
3. Commit as-is in logical commits (schema+migration, images, tests). Do not refactor.
Acceptance: migration applies on empty DB; all tests green; branch pushed.
```

---

## Phase 1 — Deployability

### P1-T01 + P1-T02
```
Tasks P1-T01 and P1-T02 (depends on P0-T02 merged).
P1-T01: add a `web` service to docker-compose.yml using apps/web/Dockerfile: depends_on migrate (condition: service_completed_successfully), healthcheck GET /api/health every 30s, OAuth credentials.json/token.json mounted read-only at the same paths the worker uses, runs as the non-root `node` user, port 3000 exposed on the compose network only (no host publish yet — the proxy comes in P1-T03).
P1-T02: complete .env.example with every variable listed in REQUIREMENTS.md §6 for web and worker, with the default the code uses and a one-line comment each. Do not change any default in code.
Acceptance: `docker compose up -d` → web healthy; login works; /api/health returns 200 with worker freshness; a fresh clone with .env.example copied to .env boots without missing-env errors.
Report the exact compose and env diffs.
```

### P1-T03
```
Task P1-T03 (depends on P1-T01; requires D-06 = Caddy and Q-03 answered in docs/DECISIONS.md — stop if not).
Add a `proxy` service (caddy:2) as the only service publishing a port (443). Caddyfile: TLS per Q-03 (<internal CA | self-signed | …>), reverse_proxy to web:3000, rate limit /api/auth/* and /api/v1/auth/login to 10 req/min per IP. Remove any host port from `web`.
Acceptance: HTTPS reachable on the LAN; Web Share and clipboard image copy work in Chrome on a phone (secure context); the 11th login attempt within a minute returns 429. Add a short section to RUNBOOK.md on certificate installation.
```

### P1-T04
```
Task P1-T04 (depends on P1-T01; D-07 approved).
Add a `backup` service: daily `pg_dump -Fc` of the app database to ./backups (host volume), 14-day retention, plus scripts/restore.sh that restores a dump into an empty database. Document the restore test in RUNBOOK.md.
Acceptance: a dump file appears after a manual run; restoring it into an empty DB reproduces the `alarms` row count; procedure documented. No change to application code.
```

### P1-T05
```
Task P1-T05 (depends on P1-T01). Create docker-compose.dev.yml: bind-mount apps/* and packages/*, run `next dev` for web and `tsx watch` for worker, publish db on 127.0.0.1:5432 only. Document usage in README (P1-T06 will expand it).
Acceptance: editing a page hot-reloads; worker restarts on change; production compose file unchanged.
```

### P1-T06
```
Task P1-T06 (depends on P1-T01…T04). Write README.md: purpose, architecture summary with a link to docs/ARCHITECTURE.md, quick start (prod and dev compose), env table generated from .env.example, roles, troubleshooting. Finish the RUNBOOK "Phase 8" section: deploy, upgrade, migrate, backup/restore, Gmail token refresh, reprocess.
Acceptance: a new engineer can deploy from the docs alone on a clean VM in under an hour — simulate this by following your own README step by step in a fresh clone and fix every gap you hit. Do not change code.
```

### P1-T07
```
Task P1-T07 (depends on P1-T01…T06 merged). Prepare release v1.0.0: CHANGELOG.md from merged commits, dry-run `prisma migrate deploy` against a copy of <production dump path>, confirm it is idempotent (second run is a no-op), then tag v1.0.0. Report the migration dry-run output verbatim.
```

---

## Phase 2 — Business-rule correctness

### P2-T01 (blocked until Q-01 / D-05 is answered)
```
Task P2-T01. docs/DECISIONS.md says D-05 = <scope matching by office | keep global>. Stop if it is empty.
Step 1 (always): write a failing engine test "a Clear received in office A never closes an alarm active in office B" covering findAlarm, findActiveAlarms, findAlarmByConsec, findOrphanClears, resetWindow and the pending-message query.
Step 2: if D-05 = scope by office, make the repository functions in packages/db take `office` and pass it from the worker; otherwise mark the test as documenting intended global behaviour (test.skip with the decision ID in the name) and stop.
Acceptance: new test passes; the existing reprocess determinism test (run twice, identical alarms) still passes; all 31 engine tests green. Then run reprocess on a copy of <production dump> and attach a before/after diff of the alarms table (counts per category and per office) — do not interpret it, I will review with the NOC (R-02).
```

### P2-T02 + P2-T03
```
Tasks P2-T02 and P2-T03 (depend on P2-T01).
P2-T02: write a test reproducing REQUIREMENTS.md §8 #17 (body-less Clear matched by latest-active fallback to an alarm that has a consecNbr). If confirmed, restrict the fallback to alarms without consecNbr, consistent with FR-20. Record the outcome in docs/DECISIONS.md under §8 #17.
P2-T03: PUT /api/rules re-classification scope per D-05 — either office-scoped unless `?office=*` by ADMIN, or global; add the integration test for the chosen behaviour and document it in the route's JSDoc.
Acceptance: tests named in the plan rows pass; no other engine behaviour changes.
```

### P2-T04 + P2-T05 + P2-T06 + P2-T07
```
Tasks P2-T04…P2-T07 (independent; one commit each).
P2-T04 /api/users: PATCH/DELETE on unknown id → 404 (not 500); block any self-role change that lowers the caller's role. Tests: unknown id → 404; admin changing self to OPERATOR → 400.
P2-T05 dateParam: interpret YYYY-MM-DD as local midnight in ALARM_TZ (Africa/Cairo) consistently with FR-37 localDay. Unit test: 2026-10-14 → 2026-10-13T21:00:00Z; cleared list and export use it.
P2-T06 /api/export: decide with me first — honour page/pageSize or remove them from the schema (plan default: remove). Keep the 50,000-row cap; test >50,000 rows → 413.
P2-T07: keep GET /api/site-master readable by any role (FR-67) but gate the /settings/site-master page server-side to ADMIN via middleware. Test: VIEWER → redirect/403; API GET still 200.
Acceptance: each test in the plan rows; all existing tests green.
```

### P2-T08 + P2-T09 + P2-T11
```
Tasks P2-T08, P2-T09, P2-T11.
P2-T08 GMAIL_LABELS: make behaviour and docs agree (plan default: document as "first entry = default label"); add a worker test for label resolution.
P2-T09 notification feed: alarms recreated by reprocess must not reappear as unread; implement the least invasive option (compare against alarmTime or stamp reprocessed rows — propose which before coding). Test: after reprocess, previously seen alarms are not unread.
P2-T11: investigate §8 #34 (RECTIFIER shown as OTHER in the dev DB): compare the rules table with the seed and write the root cause in docs/DECISIONS.md. Do NOT add a "reset to defaults" feature.
P2-T10 is superseded by Phase 5 — skip it.
```

---

## Phase 3 — REST API v1 (requires D-01 and D-02 answered)

### P3-T01
```
Task P3-T01. D-01 = <a: Next.js Route Handlers | b: apps/api Fastify>. 
If (a): add `/api/v1/:path*` as the canonical prefix (Next.js rewrite or shared handler export), keep `/api/*` working with a `Deprecation` header, and point the web UI client at /api/v1.
If (b): scaffold apps/api (Fastify + Prisma + the same zod schemas) and move handlers one domain at a time, starting with /health and /auth, keeping the old routes until parity.
Acceptance: the entire existing integration suite passes against /api/v1; old paths return identical bodies plus the deprecation header. Do not change any response shape in this task (that is P3-T02).
```

### P3-T02 + P3-T04
```
Tasks P3-T02 and P3-T04 (depend on P3-T01).
P3-T02: introduce the uniform error envelope { error: { code, message, details? } }; map zod flattened errors into details; keep every existing HTTP status (400/401/403/404/409/413/422/429). Update the UI error handling so toasts are unchanged. Snapshot tests per status.
P3-T04: one declarative requireRole(minRole) middleware applied per route; remove per-handler ad-hoc checks. Add a table-driven test: every protected route × {VIEWER, OPERATOR, ADMIN} → expected 200/403, derived from the role column in REQUIREMENTS.md §3.
Acceptance: table test passes for all routes listed in REQUIREMENTS.md §3; no handler reads the session directly anymore.
```

### P3-T03 + P3-T05
```
Tasks P3-T03 and P3-T05.
P3-T03: generate OpenAPI 3.1 from the zod schemas (zod-to-openapi), serve /api/v1/openapi.json and a Swagger UI route for ADMIN only. Every route in REQUIREMENTS.md §3 must appear with its minimum role in the description. Validate the spec in CI.
P3-T05 (depends on P2-T01 and P3-T04): office-scope middleware resolving system_status.officeLabel once per request and injecting it into the request context; handlers must not read officeLabel directly; explicit `?office=*` allowed only for ADMIN. Integration tests for scoped reads on alarms, stats, export, notifications.
```

### P3-T06
```
Task P3-T06 (depends on P1-T03). Login hardening: per-email failure counter in an in-memory map (5 failures → 15-minute lockout, 429/423 with Retry-After), explicit `secret` in authOptions, fail boot loudly if NEXTAUTH_SECRET is missing. No Redis (D-04). Tests: 6th bad password → locked; boot without secret → clear error. Document the single-replica constraint in RUNBOOK.
```

### P3-T07 + P3-T08 (only if Q-02 says there are non-browser consumers, or before Phase 7)
```
Tasks P3-T07 and P3-T08.
P3-T07: API tokens — POST /api/v1/auth/tokens (ADMIN) returns a token once; store only a hash; bearer auth path through the same requireRole middleware; DELETE to revoke. Tests: token can GET /alarms; revoked token → 401. Needed by the mobile app (Phase 7).
P3-T08: Idempotency-Key header on PUT /rules, POST /site-master/import, POST /reprocess with a 24h in-memory map; replay returns the cached 2xx without re-executing. Tests for replay and for expiry.
```

---

## Phase 4 — Test coverage and CI

### P4-T01
```
Task P4-T01 (after Phase 2 merged). Add integration tests for every route in REQUIREMENTS.md §8 #33 that has none: alarms?status=cleared, export, stats/daily, stats/top-sites, health, rules, reprocess, users, notifications, me/*, settings/*, alarm-names. For each: one happy path, one validation 400, one 401, and one 403 where a minimum role exists. Use the existing test DB helpers; do not change application code except to fix a bug the test exposes — if you find one, stop and report it with the failing test before fixing.
Report the before/after test counts.
```

### P4-T02 + P4-T03 + P4-T04
```
Tasks P4-T02…P4-T04.
P4-T02: worker tests for FR-01 (tick skipped while a run is active), FR-07 (label resolution incl. OFFICE_LABEL_PARENTS), FR-08 (status recording), FR-09 (label refresh throttle).
P4-T03: when CI=true, fixture-dependent tests must fail (not skip) if tests/fixtures or TEST_DATABASE_URL is missing; locally keep the skip with a warning.
P4-T04: GitHub Actions workflow: lint, typecheck, unit, integration with a postgres:16 service (alarms_test), Playwright smoke, Docker build for web and worker. Target < 15 minutes; cache pnpm store.
Acceptance: pipeline green on main; CI fails on a deliberately removed fixture (prove it in a throwaway commit, then revert).
```

---

## Phase 5 — Client-side hourly processing (requires D-10 approved; Q-13 answered)

### P5-T01 + P5-T02
```
Tasks P5-T01 and P5-T02 (depend on P3-T01).
P5-T01: add GET /api/v1/hourly-reports/{id}/attachment — fetch the Gmail attachment and stream raw bytes with Content-Type/Content-Length; enforce HOURLY_MAX_RAR_MB and HOURLY_MAX_XLSX_MB (defaults per docs/DECISIONS.md Q-13); 409 when no attachment, 413 over limit. Also add GET …/xlsx that unrars server-side (existing unrar path) and streams the first .xlsx — this route exists only for the mobile app (D-11a). Keep /hourly-reports list and label refresh unchanged. Integration tests for 200/409/413 and a memory check that web stays under 150 MB while streaming a 40 MB RAR.
P5-T02: move the browser-safe hourly logic (parse, enrich, normalize, diff, clockInvalid, column mapping) into packages/core/hourly with zero Node imports; re-point existing hourly unit tests to it. Acceptance: tests unchanged and green; `tsc` with lib ["dom"] succeeds for that entry point.
Do not remove the server-side processing routes yet (P5-T05).
```

### P5-T03 + P5-T04
```
Tasks P5-T03 and P5-T04 (depend on P5-T01, P5-T02).
P5-T03: Web Worker pipeline in apps/web: fetch attachment → node-unrar-js (WASM) → SheetJS → packages/core/hourly → postMessage rows with progress; cancel on navigation; release buffers after processing; never write to disk or trigger a download for processing. First do a spike against the real fixtures in tests/fixtures and report WASM compatibility (RAR5, multi-volume) before building the full pipeline (R-11).
P5-T04: reference data on device — fetch GET /site-master and /hourly-normalizations with If-None-Match/ETag, cache in IndexedDB keyed by updatedAt, invalidate on change.
Acceptance: 40k-row fixture processes in < 15 s on <NOC phone model from Q-09> (Chrome) and < 5 s on a laptop; UI stays responsive; second load makes no site-master request; row values identical to the current server output for the same report (write a golden-file comparison test).
```

### P5-T05 + P5-T06
```
Tasks P5-T05 and P5-T06 (depend on P5-T03 with the golden-file test green).
P5-T05: remove server-side hourlyCache, /hourly-reports/{id}/process, /rows, /diff and the server hourly exportXlsx; keep /hourly-reports list and the two attachment routes; delete HOURLY_CACHE_MIN and maxEntries from env, .env.example, RUNBOOK and tests. Confirm no unrar call path remains in apps/web except the /xlsx route.
P5-T06: client export and share — Excel via SheetJS in the worker (include the clockInvalid column, §8 #27), copy as table, image via the existing html2canvas path, Web Share on mobile; compare/diff computed client-side from two processed reports and reachable from any list page (§8 #29).
Acceptance: Playwright (desktop and 390 px) — export matches the pre-removal server golden file row for row; compare works from page 2.
```

### P5-T07 + P5-T08
```
Tasks P5-T07 and P5-T08.
P5-T07: hourly mobile card layout below md (reuse renderCard from data-table.tsx); Site Master inline edit for nodality, VIP, power source, battery, notes using the existing PUT /site-master/{code}. e2e at 390 px; edit VIP → badge updates on /alarms.
P5-T08: if WebAssembly is unavailable show a "process this report on a laptop" message; keep at most 3 processed reports in memory per session; clear them on logout. Unit tests for eviction; manual check on Safari iOS 16 noted in the report.
```

---

## Phase 6 — Documentation sync

```
Tasks P6-T01 and P6-T02 (after Phase 5 merged).
P6-T01: update CLAUDE.md to match the code — roles VIEWER/OPERATOR/ADMIN, data model fields, full /api/v1 route list taken from the generated OpenAPI spec (never hand-typed), parseMessage location, Phase 7 checkbox, test counts, section numbering, "As built" vs §14. 
P6-T02: refresh docs/ARCHITECTURE.md to reflect what was actually built (keep the [C]/[R]/[A] tags, flip approved items to [C]); add the client-side hourly flow as implemented.
Acceptance: a reviewer diffing CLAUDE.md against the code finds no stale statement; no code changes.
```

---

## Phase 7 — React Native mobile app (requires D-11, D-12, Q-09…Q-11 answered; P3-T07 and P5-T01/T02 merged)

### P7-T01 + P7-T02
```
Tasks P7-T01 and P7-T02.
P7-T01: scaffold apps/mobile with Expo (latest stable SDK), TypeScript, as a pnpm workspace; Metro config resolving packages/core; EAS preview profile for Android and iOS; `pnpm --filter mobile start` works and `import { parseHourlyReport } from '@alarm/core/hourly'` resolves.
P7-T02: login screen → POST /api/v1/auth/login → JWT in expo-secure-store (never AsyncStorage); API client with bearer header; on 401 clear token and return to login; show office label; hide every admin entry point for VIEWER/OPERATOR. Configurable server URL screen (P7-T07) can be included here.
Acceptance per plan rows; no admin screens.
```

### P7-T03
```
Task P7-T03 (depends on P7-T02). Alarms screens: active and cleared lists with the same filters as the web, polling 30 s / 60 s, site badges (VIP, nodality), notification badge from /notifications. Add a contract test that, for the same filters, the app's counts equal the web's against the test DB. Offline: show last data with a stale banner.
```

### P7-T04 + P7-T05
```
Tasks P7-T04 and P7-T05 (depend on P5-T01, P5-T02).
P7-T04: hourly list from /hourly-reports; fetch /hourly-reports/{id}/xlsx into memory (server unrar, D-11a — no RAR handling on device); parse with SheetJS + packages/core/hourly in chunks off the UI frame; filters and sheet tabs.
P7-T05: reference data in expo-sqlite with the same updatedAt sync policy as P5-T04; works offline after first sync.
Acceptance: 40k rows parsed < 20 s on <Q-09 phone>; no network needed after fetch; row values identical to web for the same report (reuse the golden file).
```

### P7-T06 + P7-T07 + P7-T08
```
Tasks P7-T06…P7-T08.
P7-T06: export Excel via SheetJS → file in FileSystem.cacheDirectory → expo-sharing; image via react-native-view-shot; compare with previous report on device. The temp file must be deleted in a finally block after the share sheet closes, and all in-memory reports cleared on logout. Test: after sharing, cacheDirectory contains no report files.
P7-T07: LAN networking — HTTPS to Caddy, or if Q-03 says no TLS, iOS ATS NSAllowsLocalNetworking exception documented.
P7-T08: EAS internal distribution (Android APK, iOS ad-hoc/TestFlight per Q-10) and a RUNBOOK section a NOC phone can follow to install.
```

---

## Cross-cutting prompts

### Pre-merge review (run on every branch)
```
Review branch feat/<task-id> against docs/PROJECT_PLAN.md row <task-id> and REQUIREMENTS.md. Check: (1) every acceptance criterion has a test or a documented manual check; (2) no business rule outside the task changed — diff packages/core and the engine tests specifically; (3) no new dependency/env/route beyond the task; (4) docs touched where the task says so. Output a checklist with ✔/✘ and the exact lines you are unsure about. Do not modify files.
```

### Phase gate
```
We are at milestone M<n>. List every task of Phase <n> from docs/PROJECT_PLAN.md with its branch, merge status, and acceptance status from the pre-merge reviews. Then run the full test suite and `docker compose up` on a clean checkout and report the result. State plainly whether the exit criterion in plan §4 is met. Do not start the next phase.
```

### When the agent is blocked
```
You are blocked on <question>. Do not guess. Write the question into docs/DECISIONS.md under the relevant D-xx/Q-xx with the options you see and the consequence of each, commit only that file, and stop.
```

# Alarm Filter — Mobile Network Alarm Email Processor (Local / Docker)

## 1. Purpose
A web system that reads mobile-network alarm emails from Gmail, classifies them
(Down / Power / Other), matches each alarm with its later "Clear" email, and shows:
- **Alarm page**: alarms still active (no Clear received yet)
- **Clear page**: alarms that received a Clear (with duration)
- **Dashboard**: statistics

Runs **locally on one machine with Docker Compose**, accessed by colleagues over the
LAN at `http://<host-ip>:3000`. No cloud services except Gmail API itself. Zero cost.

## 2. Working Rules (read every session)
- Language: **TypeScript everywhere** (Node 20). No Python.
- Everything runs in Docker. Do not install Postgres or pnpm globally on the host.
  Local dev may use `pnpm` inside the repo, but the deliverable is `docker compose up`.
- Before any command that destroys data (`docker compose down -v`, `prisma migrate
  reset`, dropping tables) → show the command and ASK first.
- Never ask the user for passwords, tokens or secrets in chat. Use `.env` (gitignored).
- `credentials.json`, `token.json`, `.env`, `data/` are in `.gitignore`. Never commit them.
- Write tests for the parser and the matching engine BEFORE building the UI.
- Keep "## 11. Current Status" at the bottom of this file updated after every phase.
- Prefer small, reviewable steps. Explain what changed after each step in 3–5 lines.

## 3. Stack
| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces: `apps/worker`, `apps/web`, `packages/core`, `packages/db` |
| Worker | Node 20 long-running process, `node-cron` every 1 min, in-process lock + `pg_advisory_xact_lock`; exposes `GET /health` on :4000 |
| Web + API | Next.js 14 (App Router), API = Route Handlers under `app/api/*`, `next start` on :3000, `HOSTNAME=0.0.0.0` |
| DB | PostgreSQL 16 container, data in named volume `pgdata`; Prisma ORM |
| Auth | NextAuth (Credentials provider), JWT sessions, roles `viewer` / `admin` |
| UI | React + Tailwind + shadcn/ui, TanStack Table, Recharts |
| Excel export | `exceljs` |
| Gmail | `googleapis` npm, OAuth2 Desktop client; `token.json` mounted read-only into worker |
| Backups | `backup` container: daily `pg_dump` to `./backups/`, keep 30 days |
| Tests | Vitest |
| Orchestration | `docker-compose.yml` (prod) + `docker-compose.dev.yml` (hot reload) |

## 4. Docker Layout
```
docker-compose.yml
  db       postgres:16-alpine, volume pgdata, healthcheck pg_isready
  migrate  one-shot: prisma migrate deploy + seed (depends_on db healthy)
  worker   build apps/worker, restart: unless-stopped, mounts ./token.json:ro
  web      build apps/web, ports 3000:3000, restart: unless-stopped
  backup   alpine + postgres-client, cron 02:00 pg_dump → ./backups
```
- All services on one network; only `web` (3000) is published. `db` is not exposed.
- Images: multi-stage, `node:20-alpine`, non-root user, `.dockerignore` present.
- `web` uses Next.js `output: 'standalone'` to keep the image small.
- Healthchecks on db, web (`/api/health`) and worker (`/health`).
- `docker-compose.dev.yml` overrides: bind-mount source, `pnpm dev`, `next dev`.

## 5. Email Format
Alarm subject example:
```
S_D_N_BTS O&M LINK FAILURE on #451_S_BH-KOM-AZIZA_0D36DE# at |08-OCT-2026 11:01:03 |
```
**Confirmed from 300 real samples (2026-10-11, `samples/subjects.txt`):**
- **Clear = prefix `CLEARED_`** on the otherwise identical alarm subject. 85/85 clears use it;
  "clear" never appears anywhere else.
  `CLEARED_S_D_N_FENCE GATE ALARM on #SRAN_..._0732DE# at |11-OCT-2026 15:49:55 |`
- **A Clear carries the ORIGINAL alarm time, not the clear time.** Its subject time equals the
  alarm's subject time (seen with clears for alarms from 31-AUG / 24-SEP / 30-SEP).
  ⇒ the clear time must come from the Clear email's Gmail `internalDate` (`receivedAt`).
- Name prefixes seen: `S_D_N_` (most) and `D_S_`. Kept as part of `alarmName`.
- Some names are vendor-truncated (`SHELTER DOO`, `AIR CONDITIO`); the alarm and its Clear are
  truncated identically, so they are kept verbatim.
- Some names carry a `;Default System Time` suffix → split into `nameSuffix`, excluded from key.
- **Second format (32% of mail):** `Huawei Alram Notify New alarm: <NE>/<alarm>/<severity>`
  e.g. `...: Hossary-RNC27/UMTS Cell Unavailable/Major`. No time, NE is an RNC/BSC (not a
  site), and no Clear form was seen in the samples. Parsed as `format: "HUAWEI"`,
  `alarmTime: null`. **Decision (user, 2026-10-11): store in `raw_messages` only — the engine
  does not create alarms from them** until a Huawei clear format is seen.
- **ALARM_TZ = `Africa/Cairo`** (confirmed by user 2026-10-11; DST-aware, UTC+3 in summer).

Parser (`packages/core/src/parser.ts`, `parseSubject(subject, { timeZone })`) extracts:
| Field | Rule |
|---|---|
| `isClear` | subject starts with `CLEARED_` (case-insensitive) |
| `alarmName` | text before ` on #`, minus `CLEARED_` and minus any `;…` suffix (trimmed) |
| `nameSuffix` | text after `;` in the name, or null |
| `site` | text between `#` and `#` |
| `alarmTime` | text between `|` and `|`, format `DD-MON-YYYY HH:mm:ss`, wall-clock in `ALARM_TZ` (`Africa/Cairo`, confirmed), stored as UTC. For a Clear this is the original alarm's time |
| `alarmKey` | `${alarmName}||${site}` — **never includes time** |

Unparseable subjects → stored in `raw_messages` with `parse_error`, never dropped.
`corepack pnpm parse:samples` runs the parser over all samples and lists failures.

## 6. Classification Rules
Stored in table `rules` (editable in UI). Seed:
- **DOWN**: `LINK FAILURE`, `BTS DOWN`, `CELL UNAVAILABLE`, `SITE DOWN`, `UNREACHABLE`, `NODE DOWN`
- **POWER**: `MAINS`, `AC FAIL`, `BATTERY`, `RECTIFIER`, `DC LOW`, `GENERATOR`, `POWER`
- **OTHER**: anything else
Match on `alarmName`, case-insensitive, first rule by `priority` wins.

## 7. Matching Engine (core logic — must be fully tested)
Runs for every new message, ordered by `alarmTime` then `receivedAt`.

**A. Alarm message (`isClear = false`)**
1. Alarm with same `alarmKey` AND same `alarmTime` exists → duplicate, ignore.
2. ACTIVE alarm with same `alarmKey` and OLDER `alarmTime` exists →
   close it: `status=CLEARED`, `clearType=AUTO_SUPERSEDED`, `clearTime=newAlarmTime`,
   then create the new alarm as ACTIVE.
3. Else → create new ACTIVE alarm.

**B. Clear message (`isClear = true`)**
1. Find ACTIVE alarm with same `alarmKey`. The Clear subject carries the original alarm's
   time (confirmed, §5): prefer the alarm whose `alarmTime` equals it; otherwise take the
   latest active.
2. Found → `status=CLEARED`, `clearType=EMAIL`, `clearTime = Clear email receivedAt`
   (Gmail `internalDate` — the subject time is NOT the clear time),
   `durationMin = clearTime - alarmTime`.
3. Not found → insert into `orphan_clears`. Never silently drop.

**C. Idempotency & safety**
- Dedupe on `gmailId` in `raw_messages`.
- Worker: in-process `running` flag + `pg_advisory_xact_lock(42)` per run.
- `alarmTime` comes from the subject, NOT the email received time. The ONLY exception is
  `clearTime` of an EMAIL clear, which is the Clear email's `receivedAt` (user decision
  2026-10-11, because Clear subjects repeat the alarm time).
- HUAWEI-format messages are stored in `raw_messages` but never create alarms (§5).
- `reprocess(days)` rebuilds alarms from `raw_messages` deterministically; running it
  twice yields identical results.
- Gmail sync: `users.history.list` from `SystemStatus.lastHistoryId`; on first run or
  `404 historyId too old` fall back to `messages.list` with `after:`.
- Process at most 200 messages per run; the next minute continues.

**D. Implemented edge-case rules** (`packages/core/src/engine.ts`, decided in Phase 4):
- Ordering within a batch: `alarmTime`, then alarms before Clears, then `receivedAt`, then
  `gmailId` — so a Clear delivered before its alarm in the same batch still matches.
- Clear whose exact `alarmKey`+`alarmTime` alarm exists but is already CLEARED → `stale_clear`,
  no-op (prevents the "latest active" fallback from closing a newer alarm; duplicate Clears).
- Alarm arriving when an orphan Clear with the same key + subject time exists → orphan is
  consumed, alarm created CLEARED/EMAIL with the orphan's clearTime; older actives superseded.
- Older alarm arriving after a newer ACTIVE one (same key) → created already CLEARED /
  AUTO_SUPERSEDED at the newer alarm's time (never two ACTIVE alarms per key).
- `durationMin` = rounded minutes, clamped at ≥ 0.
- `reprocess(days)`: since = now − days; delete alarms with alarmTime ≥ since, reopen alarms
  whose clearTime ≥ since, delete orphan clears whose raw message is in the window, then
  re-run all raw messages received ≥ since. Verified idempotent (memory + real Postgres).

Required test cases (Vitest, in `packages/core`):
1. Normal alarm → Clear 1 hour later
2. Alarm → Clear 1 day later
3. Alarm → same alarm with newer time (AUTO_SUPERSEDED) → Clear for the new one
4. Exact duplicate alarm email
5. Clear with no matching active alarm (orphan)
6. Out-of-order delivery (Clear email arrives before alarm email)
7. Subject that does not parse

## 8. Database Schema (Prisma)
```
RawMessage   id, gmailId @unique, subject, receivedAt, parseError?, processedAt?
Alarm        id, alarmKey, alarmName, site, category(DOWN|POWER|OTHER),
             alarmTime, status(ACTIVE|CLEARED), clearTime?, durationMin?,
             clearType?(EMAIL|AUTO_SUPERSEDED), createdAt
             @@unique([alarmKey, alarmTime]) @@index([status, category]) @@index([site])
OrphanClear  id, alarmKey, subject, clearTime, rawMessageId
Rule         id, pattern, category, priority
Site         site @id, region?, owner?
User         id, email @unique, passwordHash, role(VIEWER|ADMIN)
SystemStatus id=1, lastHistoryId, lastRunAt, lastError?, lastRunMessages, reprocessDays?
```

## 9. API (Next.js Route Handlers)
- `GET /api/alarms/active?category&site&region&minHours&page`
- `GET /api/alarms/cleared?from&to&category&site&page`
- `GET /api/stats/summary` → active counts per category, MTTR per category, last run
- `GET /api/stats/daily?days=30`
- `GET /api/stats/top-sites?limit=10`
- `GET /api/export?status=active|cleared&...` → .xlsx
- `GET|PUT /api/rules` (admin)
- `POST /api/reprocess?days=7` (admin) → sets `SystemStatus.reprocessDays`; worker picks it up
- `GET /api/health` → db ok + worker lastRunAt age

## 10. UI Pages
1. `/alarms` — active table; filters category/site/region in URL; live "age" column
   (30s); rows older than `ALERT_HOURS` (default 4) highlighted; auto-refresh 60s.
2. `/cleared` — cleared table; date range; duration; clearType badge; Excel export.
3. `/dashboard` — counters per category, 30-day stacked bar, top-10 sites, MTTR,
   status bar "last sync X min ago" (red if > 5 min or `lastError`).
4. `/settings` — rules editor, users (admin only).
English UI, numbers LTR.

## 11. Environment (.env.example)
```
POSTGRES_USER=alarm
POSTGRES_PASSWORD=change-me
POSTGRES_DB=alarms
DATABASE_URL=postgresql://alarm:change-me@db:5432/alarms
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://<host-ip>:3000
ADMIN_EMAIL=admin@local
ADMIN_PASSWORD=
ALARM_TZ=Africa/Cairo
ALERT_HOURS=4
GMAIL_QUERY=            # optional Gmail search filter, e.g. from:alarms@vendor.com
```

## 12. Current Status
- [x] Phase 0 — repo, tooling, Docker skeleton (db healthy on Docker 29.8.2 / WSL2)
- [x] Phase 1 — Gmail OAuth + sample fetch (token.json saved; 300 samples in samples/subjects.txt)
- [x] Phase 2 — parser + tests (26 tests, 300/300 samples parse; ALARM_TZ=Africa/Cairo
      confirmed; clearTime = Clear receivedAt; Huawei = store only)
- [x] Phase 3 — Prisma schema + db container (init migration applied, 13 rules seeded;
      admin user is created on the next `docker compose run --rm migrate` once
      ADMIN_PASSWORD is set in .env)
- [x] Phase 4 — matching engine + tests (20 engine tests incl. the 7 required + reprocess
      idempotency; PrismaAlarmRepository verified by integration test on compose db)
- [ ] Phase 5 — worker container (node-cron)
- [ ] Phase 6 — Next.js API + auth
- [ ] Phase 7 — UI pages
- [ ] Phase 8 — full compose, backups, LAN access, 24h parallel run, RUNBOOK
Notes:
- pnpm is NOT installed globally (§2). Run it via corepack: `corepack pnpm <cmd>`
  (version pinned by `packageManager` in root package.json). `pnpm dlx` is broken on this
  host (Windows cache ENOENT) — use `npx` for one-off generators.
- Host has Node 24; Docker images will target Node 20 per §3. Node 20 reached EOL in
  April 2026 — decide before Phase 5 whether to move images to `node:22-alpine`/`node:24-alpine`.
- `next.config.mjs` emits `output: 'standalone'` everywhere except native Windows builds
  (needs symlink privilege); the Docker (Linux) build always gets standalone.
- DB tables are snake_case (`raw_messages`, `alarms`, `orphan_clears`, `rules`, `sites`,
  `users`, `system_status`). Extra indexes beyond §8: raw_messages.receivedAt (reprocess),
  orphan_clears.alarmKey, rules.priority. Rule priority: lower number = checked first.
- Seed is idempotent: rules only inserted when the table is empty; admin created once, never
  overwritten. New migrations: edit schema, then
  `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`
  (needs a shadow DB) or `prisma migrate dev` against the dev-override db on 127.0.0.1:5432.
- DB integration test (`packages/db/src/repository.test.ts`) runs only when
  `TEST_DATABASE_URL` is set (db exposed on 127.0.0.1:5432 via docker-compose.dev.yml); it
  works inside a rolled-back transaction, so it leaves no rows.
- Gmail access uses `@googleapis/gmail` + `google-auth-library` (same API as `googleapis`,
  far smaller — keeps the worker image < 200MB). Scope: gmail.readonly.
- Gmail account: de.alarms@mobi-egypt.com (Workspace). OAuth app is in Testing mode with this
  account as a test user. Testing-mode refresh tokens expire after 7 days → before Phase 8
  publish the app (or set User type = Internal) so the worker doesn't lose access weekly.
- samples/ is gitignored (real network data). 300 msgs = only ~40 min of mail; a second
  subject format exists ("Huawei Alram Notify New alarm: ...") — handle in Phase 2.

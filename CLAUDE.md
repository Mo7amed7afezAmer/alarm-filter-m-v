/53+# Alarm Filter — Mobile Network Alarm Email Processor (Local / Docker)

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

**Email body (confirmed from 200 real bodies, label `dn-kafr-eldawar`, 2026-10-11)** —
`packages/core/src/body.ts`, `parseMessage(subject, body)`:
```
############NEW ALARM###########          (Clear: ############CLEARENCE ALARM###########)
ALARM NAME:        WCDMA CELL OUT OF USE   (each value is on the line after its label)
ALARM_START_TIME:  11-OCT-2026 21:02:49    (= subject time)
NE_name: RNC66 · Alarm_Number 7771 · ALARM_SITE: U_S_BH-MHLT-KYL_3830DE
cell name :        A_BH-MHLT-KYL_3_24313_S (only when ALARM_Device = cell)
ALARM_Device:      cell | MRBTS | site
CONSEC_NBR:        2291814
```
- **`CONSEC_NBR` is unique per alarm and the Clear carries the SAME number** (89/89 unique,
  79/79 clears matched). User rule (2026-10-11): the same subject (name + time) arriving
  again with a different body = a NEW alarm (e.g. another cell) — never a duplicate.
- With a body: `alarmKey = name||site||cellName` (cell only when present) and identity =
  `consecNbr`. Without a parseable body: subject rules only (key = name||site).
- Non-alarm mail in the label (e.g. "Nokia … Alarms Update Report") → parse_error, kept.

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

**E. CONSEC_NBR identity (added 2026-10-11, overrides A.1 / B.1 when the body has it):**
- Alarm with a `consecNbr` already stored → duplicate; otherwise it is a new alarm even if
  another alarm has the same subject/key-without-cell/time.
- Clear with `consecNbr` → closes exactly the alarm with that number; already closed →
  `stale_clear`; not found → orphan (stores `consecNbr`). NO "latest active" fallback.
- Orphan consumption matches by `consecNbr` when present.
- **No AUTO_SUPERSEDED for alarms with `consecNbr`** (user rule 2026-10-11, case
  NE3SWS on BH-KANAYES-VLG 22:47:39 #2300397 vs 22:50:40 #1113627011): same name + site at a
  new time, with or without a cell, is an independent alarm closed ONLY by its own Clear.
  A.2 superseding applies only to body-less alarms (and never touches alarms with consecNbr).

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
RawMessage   id, gmailId @unique, subject, receivedAt, body?, parseError?, processedAt?
Alarm        id, alarmKey, alarmName, site, category(DOWN|POWER|OTHER),
             alarmTime, status(ACTIVE|CLEARED), clearTime?, durationMin?,
             clearType?(EMAIL|AUTO_SUPERSEDED), consecNbr? @unique, cellName?, device?, createdAt
             @@index([alarmKey, alarmTime]) @@index([status, category]) @@index([site])
             (alarmKey+alarmTime was @@unique until 2026-10-11 — two cells can share it)
OrphanClear  id, alarmKey, subject, clearTime, rawMessageId, consecNbr?
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
GMAIL_LABELS=dn-kafr-eldawar   # comma-separated labels the worker reads (search form); empty = all mail
```

## 13. Mobile (PWA first, Expo optional)
**PWA (Phase 9):** Next.js app becomes installable: `manifest.json`, icons, service
worker via Serwist, offline shell for /alarms. Web Push via `web-push` (VAPID keys in
`.env`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).

**Remote access (Phase 10):** `cloudflared` container in docker-compose.yml using a
tunnel token (`CLOUDFLARE_TUNNEL_TOKEN` in .env) → `https://<subdomain>`; port 3000 stays
LAN-only. Access restricted by app login (and Cloudflare Access if available).

**Expo app (Phase 11, optional):** `apps/mobile` (Expo SDK 51, expo-router, TypeScript)
sharing types from `packages/core`. Auth via `POST /api/auth/token` (Bearer JWT, 30 days,
revocable). Push via Expo Push API. Distribution: APK for Android, TestFlight for iOS
(requires paid Apple developer account).

**Schema additions:**
```
PushSubscription  id, userId, platform(WEB|EXPO), endpoint (web) / expoToken,
                  keys? (p256dh, auth), createdAt, lastUsedAt
NotificationPref  userId @id, categories[], regions[], quietFrom?, quietTo?,
                  notifyNewDown bool, notifyOverdue bool
```

**Notification rules (run by worker after each sync):**
- New ACTIVE alarm with category DOWN → notify subscribers whose prefs match.
- ACTIVE alarm crossing `ALERT_HOURS` → one "overdue" notification per alarm, once.
- Batch: if > 3 events in one run → single summary notification ("5 new alarms").
- Respect quiet hours; drop subscriptions that return 404/410.

**Mobile screens:** Active list (oldest first, category color, pull-to-refresh,
site search) · Alarm detail (related messages, duration) · Cleared (last 24h) ·
Dashboard (3 counters + last sync) · Settings (notification prefs).

**API additions:** `POST /api/auth/token`, `POST|DELETE /api/push/subscribe`,
`GET|PUT /api/notifications/prefs`, `GET /api/alarms/:id`.

## 14. Hourly Reports (Nokia Down & Environmental, RAR attachment) — STATELESS
Emails under Gmail label `Hourly Update` carry a `.rar` with `NSN Update_Output.xlsx`.
**Alarm rows are never stored.** Processing is on demand, in memory, with a short cache.
The only persisted data: `SiteMaster` (enrichment) and `HourlyNormalization` (value fixes).

**Pipeline (apps/api services/hourly):**
1. `listReports()`: Gmail messages with label `Hourly Update` and an attachment →
   {gmailId, receivedAt, sender, fileName, fileSize}. No download.
2. `process(gmailId)`: download via `users.messages.attachments.get` → temp dir →
   validate (`.rar`, magic `52 61 72 21 1A 07`, ≤ 25 MB; after extraction ≤ 100 MB,
   ≤ 20 files, no `..`/absolute paths, exactly one .xlsx) → `unrar x -o+` →
   read sheets with exceljs → dedupe across `*_Down` sheets on
   (Distinguished Name, Alarm Text, Alarm Time), collecting `technologies[]` →
   join `SiteMaster` on Site Code → normalize → rows JSON → LRU cache
   (key gmailId, 30 min, max 20) → `finally` delete temp dir.
3. `rows(gmailId, filters)` and `export(gmailId, filters)` serve from cache; if the
   cache is cold, process() runs again transparently.
4. `diff(a, b)`: process both, return new / disappeared rows (by site+alarmName+dn).
Never execute anything from the archive. Never keep extracted files.

**Extraction requirement:** official `unrar` package (non-free). `p7zip`, `unrar-free`
and 7-Zip 23 FAIL on this RAR5 ("Unsupported Method"). Dockerfile:
`apt-get install -y unrar` (multiverse/non-free enabled); fallback `node-unrar-js`.

**File format (confirmed from a real sample):** sheets `All`, `2G_Down`, `3G_Down`,
`4G_Down`, `5G_Down`, `Environmental`, `HW`; same 14 columns, header in row 1:
Alarm Number | Alarm Type | Alarm Time | Alarm Text | Distinguished Name |
Object Class | Name | Site Name | Site Code | Site Address | Diagnostic Info |
User Additional Information | Supplementary Information | Related DN's
- Use the categorized sheets, not `All` (`All` adds ~740 TRX rows with empty sites).
- `Environmental`: real alarm is `Supplementary Information` (Alarm Text is constant).
- region = last 2 chars of Site Code (DE, UP, AL, SI, CA, RE).
- Flag Alarm Time year < 2020 as `clockInvalid`, keep the row.

**Output row (what the UI/export shows — matches the user's Excel):**
```
alarmTime | alarmText | name | siteName | code | office* | nodality* | vip* | siteType* |
powerSource* | battery* | supplementaryInfo | region | technologies | sheet | clockInvalid
```
`*` from SiteMaster; empty when the code is unknown (show a count of unmatched codes).
Rows colored by office in UI and export; default sort office, then alarmTime desc.

**Normalization (table `HourlyNormalization`, seed):** collapse double spaces, trim,
upper-case; `MAIN POWER CUTTOFF`/`MAIN POWER  CUT OFF` → `MAIN POWER CUT OFF`,
`SHELTER DOO` → `SHELTER DOOR`, `DAMNHOUR` → `DAMANHOUR`, `TEMPRATURE` → `TEMPERATURE`.

**Category (for the category filter only, not stored):** `*_Down` → DOWN;
Environmental with RECTIFIER|MAIN POWER|BATTERY|GENERATOR|SURGE → POWER; else OTHER.

**Schema:**
```
SiteMaster           code @id, siteName?, office, nodality?, vip bool, siteType?,
                     powerSource?, battery?, region?, notes?, updatedAt
HourlyNormalization  id, field, from, to
```
Import SiteMaster from an uploaded xlsx (sheet `SiteMaster`, columns Code, Site Name,
Office, Nodality, VIP, Site type, Power Source, Battery) — admin only; re-import upserts;
one file per office is fine (template: tests/fixtures/SiteMaster_KafrElDawar.xlsx).

**API (/api/v1):**
```
GET  /hourly-reports?from&to&page                     list from Gmail
POST /hourly-reports/{gmailId}/process                202 → poll GET status
GET  /hourly-reports/{gmailId}/status
GET  /hourly-reports/{gmailId}/rows?sheet&region&office&alarm&siteType&category&from&to&q&page
GET  /hourly-reports/{gmailId}/export?...same filters&columns=   xlsx
GET  /hourly-reports/diff?a=&b=
POST /site-master/import   GET /site-master   PUT /site-master/{code}   admin
GET|PUT /hourly-normalizations                                           admin
```

**UI `/hourly`:** reports list (time, sender, file, size, Process button, cache
state); results table with filters (sheet, region, office, alarm, site type, category,
time range, search by code/name), column chooser, office colors, filters in URL,
Export Excel reproducing the visible table; Compare view for two reports.
Mobile: list + read-only table with the same filters.

**Env:** `HOURLY_MAX_RAR_MB=25`, `HOURLY_MAX_EXTRACT_MB=100`, `HOURLY_CACHE_MIN=30`.

**As built (Phase 12, 2026-10-13) — built on Route Handlers, no separate api service:**
- Pure pipeline in `packages/core/src/hourly/` (validate, extract, parse, enrich, normalize,
  filter, diff, exportXlsx, siteMaster). `@alarm/core` re-exports only the browser-safe part;
  the server part is `@alarm/core/hourly`. exceljs / node-unrar-js are *optional peer* deps
  of core so the worker image does not grow.
- Server in `apps/web`: `lib/gmail.ts` (list + attachment, worker's OAuth files;
  `HOURLY_GMAIL_MOCK_DIR` serves local .rar files), `lib/hourlyCache.ts` (LRU + in-flight
  promise + status, **per Next.js instance**), `lib/hourly.ts`; routes under
  `app/api/hourly-reports/**`, `app/api/site-master/**`, `app/api/hourly-normalizations`
  (paths without `/v1`), all `runtime = "nodejs"`, responses `{data, meta}` / `{error}`.
- Roles: new `OPERATOR` (viewer < operator < admin). Process = operator; Site Master and
  normalizations = admin. A report nobody processed yet returns 409 to viewers; once
  processed, a cold cache re-processes transparently for everyone.
- Extraction: headers listed with node-unrar-js first (pre-check), then `unrar x -o+ -p- -y`
  when the binary exists, else node-unrar-js; post-check on disk; temp dir removed in finally.
- `apps/web/Dockerfile` uses `node:20-bookworm-slim` (deviation from §4 Alpine): Alpine has
  no `unrar` package; Debian non-free has `unrar` 6.21 (verified).
- The /hourly page loads all rows of a report (rows API, pages of 500) and filters/sorts in
  the browser with the same core functions; export goes through the API with the same
  filters + visible columns. Report list paging is `page`, mapped to Gmail page tokens.
- Deviations found in the real files: Environmental *Alarm Text* is NOT constant (EXTERNAL
  AL n, FIRE ALARM, … in a minority of rows) — alarmName is still Supplementary Information,
  falling back to Alarm Text when empty. Normalization rules replace whole words, and an
  `alarmName` rule also fixes Alarm Text / Supplementary Information.
- Fixture counts (tests/fixtures/NSN Update_Output.rar, 13-OCT-2026 ~07:00): data rows
  2G_Down 529, 3G_Down 434, 4G_Down 438, 5G_Down 2, Environmental 1394, HW 35; 856 unique
  Down rows after dedupe (181 SYNCHRONIZATION rows merged across 2G/3G/4G); 2,285 rows total.
  The counts in the task brief (743/499/469/3/1289/45) belong to a different report.
  SiteMaster fixture: 138 rows, 0970DE three times → 136 imported, 2 skipped.

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
- [x] Phase 5 — worker container (node-cron; healthy, ~200 msgs/min backfilling 24h; image
      144MB on disk — `docker images` shows ~242MB because it counts the base image's npm layer)
- [x] Phase 6 — Next.js API + auth (all §9 routes, zod, NextAuth JWT roles, exceljs;
      7 integration tests on alarms_test; login page at /login)
- [ ] Phase 7 — UI pages
- [ ] Phase 8 — full compose, backups, LAN access, 24h parallel run, RUNBOOK
      (RUNBOOK.md started with the hourly section; `apps/web/Dockerfile` exists but `web` is
      not in docker-compose.yml yet — it must mount token.json + credentials.json read-only)
- [ ] Phase 9 — PWA + web push
- [ ] Phase 10 — Cloudflare Tunnel remote access
- [ ] Phase 11 — Expo mobile app (optional)
- [x] Phase 12 — Hourly reports (stateless, §14 "As built"): /hourly, /hourly/[gmailId],
      /hourly/compare, /settings/site-master. Verified 2026-10-13: vitest 151 tests incl. 7
      hourly route tests on alarms_test, and the Playwright smoke (`corepack pnpm test:e2e`,
      ~5 min — dev-mode cold compiles). e2e DB seeding runs in a child node process
      (`e2e/db.mjs`): importing ESM `@alarm/core/hourly` through Playwright's loader hangs.
      `apps/web/Dockerfile` not built yet.
Notes:
- pnpm is NOT installed globally (§2). Run it via corepack: `corepack pnpm <cmd>`
  (version pinned by `packageManager` in root package.json). `pnpm dlx` is broken on this
  host (Windows cache ENOENT) — use `npx` for one-off generators.
- Host has Node 24; Docker images use `node:20-alpine` per §3 — user decision 2026-10-11
  to keep it despite Node 20 being EOL since April 2026 (revisit if security updates matter).
- `next.config.mjs` emits `output: 'standalone'` everywhere except native Windows builds
  (needs symlink privilege); the Docker (Linux) build always gets standalone.
- DB tables are snake_case (`raw_messages`, `alarms`, `orphan_clears`, `rules`, `sites`,
  `users`, `system_status`). Extra indexes beyond §8: raw_messages.receivedAt (reprocess),
  orphan_clears.alarmKey, rules.priority. Rule priority: lower number = checked first.
- Seed is idempotent: rules only inserted when the table is empty; admin created once, never
  overwritten. New migrations: edit schema, then
  `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`
  (needs a shadow DB) or `prisma migrate dev` against the dev-override db on 127.0.0.1:5432.
- Integration tests (`packages/db/src/repository.test.ts`, `apps/web/app/api/api.integration.test.ts`)
  run only when `TEST_DATABASE_URL` is set and must point at the separate **`alarms_test`**
  database (created + migrated in Phase 6), never at `alarms`.
- Local dev: ALWAYS start compose with both files
  (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d ...`). Plain
  `docker compose up` recreates db without the 127.0.0.1:5432 port and `pnpm dev` loses the DB.
  `apps/web/.env.local` (gitignored, generated from `.env`) points the dev server at it.
- API: every route except `/api/health` and `/api/auth/*` requires a session (401 JSON);
  `/api/rules` and `/api/reprocess` require ADMIN (403). Pages are guarded by `middleware.ts`
  (redirect to /login). `PUT /api/rules` replaces all rules and re-classifies existing alarms.
  MTTR = avg durationMin of EMAIL clears only (AUTO_SUPERSEDED excluded), last 30 days.
  `/api/health` is 200 whenever the DB answers (worker staleness reported in the body).
- Classification gap seen on real data: OTHER dominates because seed rules don't match
  `BCCH MISSING`, `WCDMA BASE STATION OUT OF USE`, `NE3SWS AGENT NOT RESPONDING…` — ask the
  user whether these should be DOWN (editable in /settings once Phase 7 is done).
- Worker (`apps/worker`): mounts BOTH token.json and credentials.json read-only (refreshing
  the access token needs the client secret). Sync never advances `lastHistoryId` until every
  discovered message is stored, so the 200/run cap can't lose mail. First run / expired
  history → messages.list for the last `INITIAL_BACKFILL_HOURS` (24). `GMAIL_QUERY` only
  applies to that fallback listing (history.list has no query). /health is 503 only when
  runs stop (> 5 min); a Gmail error shows in `lastError` but stays 200 to avoid restart loops.
- 2026-10-11 body/label change: worker fetches `format: full`, stores the plain-text body in
  `raw_messages.body`, and reads only `GMAIL_LABELS` (history.list per labelId +
  messages.list `(label:a OR label:b)`). User approved wiping raw_messages/alarms/orphan_clears
  (9,188 / 2,516 rows) and re-syncing; rules + users kept. More labels: user to send names.
- **Office selection (2026-10-12, user request):** offices = Gmail labels under `DN/` and `DS/`
  (DN: Damanhour, Dumiat, Kafr ElDawar, Kafr ElSheikh, Mansoura, Port Said, Tanta; DS: Benha,
  Dyrb Negm, Faqous, Huawei, Sadat, Shebin, Zagazig). The worker refreshes the list into
  `system_status.availableLabels` every 10 min (`OFFICE_LABEL_PARENTS`, default `DN,DS`).
  An admin picks ONE in /settings → `system_status.officeLabel`; the worker reads only that
  label, and when it differs from `syncedLabel` it backfills 24h for the new label.
  `raw_messages/alarms/orphan_clears.office` tag every row; every page/stat/export is scoped
  to the selected office (history per office is kept). `GMAIL_LABELS` is only the fallback
  before an office is chosen. Header shows the office pill.
- **Notifications (2026-10-12, user request):** in-site only (user choice; browser pop-ups
  need HTTPS on the LAN). Event = NEW alarm. Per-user prefs in `users.notifyPrefs`
  (`packages/core/src/notify.ts`: enabled, sound, categories, alarmNames (exact), sites
  (substring); OR within a filter, AND across, empty = any; default DOWN only). Feed is
  computed on read: alarms with `createdAt` in the last 24h in the selected office matching
  prefs; unread = `createdAt > users.notificationsSeenAt` (first time: last 30 min). Bell
  polls `/api/notifications` every 30s → badge, beep (WebAudio), pop-up card, "(n)" tab title.
  Prefs page `/notifications` (every user). Caveat: `reprocess` recreates alarms (new
  createdAt) → they can show up again as unread once.
- **Hidden alarm types (2026-10-12, user request):** admin hides whole categories and/or exact
  alarm names in /settings ("Displayed alarm types") → `system_status.displayFilter`
  `{hiddenCategories, hiddenAlarmNames}`, global (all users, all offices). `lib/visibility.ts`
  `alarmScope()` = office AND not hidden; used by every alarm list, stat (incl. raw-SQL daily
  chart via `alarmScopeSql()`), export and the notification feed. User filters are AND-ed on
  top, so they cannot un-hide. Data is still ingested/matched; pages show an amber
  "N alarm types hidden" note. `/api/alarm-names?all=1` includes hidden names (with `hidden`).
- **Personal hidden types (2026-10-12, user request):** every user can also hide types from
  THEIR pages only → `users.displayPrefs` (same shape), edited on `/preferences` (renamed from
  /notifications, which redirects; header link "My preferences"). `alarmScope(userId)` merges
  admin + personal; all routes pass `Number(session.user.id)`. Personal hiding also filters
  that user's notification feed. Admin-hidden types show as locked in the personal editor
  (shared component `components/types-visibility-editor.tsx`, mode admin|personal).
- After a schema change, RESTART `next dev` — a running dev server keeps the old Prisma client
  in memory ("Unknown field … on model SystemStatus").
- On Windows, `prisma generate` fails with EPERM while `next dev` holds the query-engine DLL —
  stop the dev server first.
- Gmail access uses `@googleapis/gmail` + `google-auth-library` (same API as `googleapis`,
  far smaller — keeps the worker image < 200MB). Scope: gmail.readonly.
- Gmail account: de.alarms@mobi-egypt.com (Workspace). OAuth app is in Testing mode with this
  account as a test user. Testing-mode refresh tokens expire after 7 days → before Phase 8
  publish the app (or set User type = Internal) so the worker doesn't lose access weekly.
- samples/ is gitignored (real network data). 300 msgs = only ~40 min of mail; a second
  subject format exists ("Huawei Alram Notify New alarm: ...") — handle in Phase 2.

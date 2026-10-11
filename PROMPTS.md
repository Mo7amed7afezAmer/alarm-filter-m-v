# Claude Code — Step-by-Step Prompts (Local Docker)

Do the manual prep first, then paste one prompt per phase. Review the result before
moving on. Start every new session with the "Session opener".

---

## Manual prep (you, not Claude Code)
1. Pick the host machine (Windows 10/11, Linux or Mac) that will stay on 24/7.
   Disable sleep. Give it a fixed LAN IP.
2. Install **Docker Desktop** (Windows/Mac) or Docker Engine + Compose plugin (Linux).
   Verify: `docker compose version`.
3. Install Node 20 LTS + pnpm + Git (for development and Claude Code only).
4. Google Cloud: create project `alarm-filter` (no billing needed for Gmail API alone)
   → enable **Gmail API** → OAuth consent screen (External, add your Gmail as test user)
   → Credentials → OAuth client **Desktop app** → download as `credentials.json`.
5. Folder `alarm-filter/` containing `CLAUDE.md` and `credentials.json`.
6. Open Claude Code in that folder.

---

## Session opener (every session)
```
Read CLAUDE.md fully. Check "## 12. Current Status" and the git log, summarize where we
are in 5 lines, then continue from the first unchecked phase. Do not skip phases.
```

---

## Phase 0 — Repo, tooling, Docker skeleton
```
Read CLAUDE.md. Set up the pnpm monorepo in §3: apps/worker, apps/web (Next.js 14,
App Router, TypeScript, Tailwind, shadcn/ui, output: 'standalone'), packages/core
(pure TS, no I/O), packages/db (Prisma).
Add .gitignore (credentials.json, token.json, .env*, data/, backups/, node_modules,
.next, dist), .dockerignore, .env.example from §11, eslint + prettier, vitest at root.
Create docker-compose.yml with the db service only for now (postgres:16-alpine,
volume pgdata, healthcheck) and docker-compose.dev.yml. Add a Makefile or package
scripts: up, down, logs, dev, test, build.
Run `docker compose up -d db` and confirm the healthcheck passes. git init + first
commit. Show me the tree.
```

## Phase 1 — Gmail OAuth + samples
```
Create scripts/gmail-auth.ts: OAuth2 Desktop flow with credentials.json
(access_type=offline, prompt=consent), prints the consent URL, receives the code on
localhost, saves token.json with refresh_token.
Create scripts/fetch-samples.ts: reads the last 300 message subjects + dates (respect
GMAIL_QUERY if set) and writes samples/subjects.txt as "ISO date | subject".
Run gmail-auth.ts and give me the URL to approve. After I approve, run fetch-samples.ts
and report: total, how many contain "Clear", 10 examples of each type.
```

## Phase 2 — Parser + tests
```
Study samples/subjects.txt. Implement packages/core/src/parser.ts per CLAUDE.md §5.
Confirm from the real samples where the word "Clear" appears and whether Clear subjects
carry the original alarm time — update CLAUDE.md §5 with what you find.
Write Vitest tests for every distinct subject shape plus the unparseable case. Run the
parser over all samples and list every subject that fails. Ask me to confirm ALARM_TZ;
do not guess.
```

## Phase 3 — Database
```
Create the Prisma schema in packages/db exactly as CLAUDE.md §8 with indexes.
Write seed.ts: rules from §6 and one admin user from ADMIN_EMAIL / ADMIN_PASSWORD
(never print the password).
Add the `migrate` one-shot service to docker-compose.yml (prisma migrate deploy +
seed, depends_on db healthy). Copy .env.example to .env with a generated
POSTGRES_PASSWORD and NEXTAUTH_SECRET; tell me to set ADMIN_PASSWORD myself.
Run `docker compose run --rm migrate`, then show the tables. Commit.
```

## Phase 4 — Matching engine + tests
```
Implement packages/core/src/engine.ts implementing CLAUDE.md §7 (A, B, C) as pure
functions over a repository interface, so it is testable without a DB. Then implement
the Prisma-backed repository in packages/db.
Write the 7 required test cases plus any edge case you think matters. All tests must
pass. Implement reprocess(days) and test that running it twice gives identical
results. Commit.
```

## Phase 5 — Worker container
```
Build apps/worker as a long-running Node process: node-cron every minute, in-process
`running` flag, pg_advisory_xact_lock(42) per run, Gmail sync via history.list with
fallback, max 200 messages per run, writes SystemStatus (lastRunAt, lastError,
lastRunMessages), honours SystemStatus.reprocessDays then clears it.
Expose GET /health on :4000 returning lastRunAt age and lastError.
Dockerfile: multi-stage node:20-alpine, non-root, image < 200MB. Mount ./token.json
read-only. Add the worker service to docker-compose.yml with restart: unless-stopped
and a healthcheck.
Run `docker compose up -d --build worker`, wait two minutes, show `docker compose logs
worker` and the row counts in raw_messages and alarms. Commit.
```

## Phase 6 — API + auth
```
In apps/web implement the Route Handlers in CLAUDE.md §9 with Prisma, pagination and
zod validation. NextAuth Credentials provider, JWT, roles; protect admin routes.
Excel export with exceljs. /api/health must report db + worker lastRunAt age.
Integration tests for /api/alarms/active and /api/stats/summary against the compose
db. Run locally with `pnpm dev` and show sample responses. Commit.
```

## Phase 7 — UI
```
Build the four pages in CLAUDE.md §10 with shadcn/ui, TanStack Table and Recharts.
Alarms: live age column (30s), highlight > ALERT_HOURS, filters in URL, refresh 60s.
Cleared: date range picker, clearType badge, export button.
Dashboard: counters, 30-day stacked bar, top-10 sites, MTTR, "last sync" bar red
after 5 min or on lastError.
Settings: rules editor and users (admin). Clean, fast, no heavy animations.
Run the dev server, walk me through each page, fix console errors. Commit.
```

## Phase 8 — Full compose, backups, LAN, verification
```
Add the web service (standalone build, HOSTNAME=0.0.0.0, ports 3000:3000, healthcheck
/api/health) and the backup service (daily 02:00 pg_dump to ./backups, keep 30 days).
Run `docker compose down && docker compose up -d --build` from scratch and confirm all
services healthy. Tell me the firewall rule needed for port 3000 on my OS.
Write scripts/verify.ts: for the last 24h compare Gmail alarm/clear counts with
raw_messages and alarms, print mismatches. Run it.
Write RUNBOOK.md: install, start/stop, update (git pull → compose up --build), logs,
backups and restore, re-authorize Gmail (re-run gmail-auth then restart worker),
reprocess, how to reach the site from other PCs, Docker Desktop auto-start on boot.
Update CLAUDE.md §12. Commit.
```

---

## Useful follow-up prompts
```
A Clear with this exact subject was not matched: "<paste subject>". Explain why, fix
parser or engine, add a regression test, then trigger reprocess for the last 3 days
and show the result.
```
```
The dashboard shows "last sync 12 min ago". Check `docker compose ps`, worker logs and
SystemStatus.lastError. Propose the fix before applying it.
```
```
Disk usage of the pgdata volume and ./backups — show it and suggest an archive policy
for raw_messages older than 90 days without breaking reprocess.
```
```
Produce a one-page onboarding note for colleagues: URL, login, what each page shows,
and who to call when the status bar is red.
```

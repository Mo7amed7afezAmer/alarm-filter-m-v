# Runbook

Operational notes for the Alarm Filter stack. (The full Phase 8 runbook — compose, backups,
LAN access — is still to be written; this file starts with the hourly reports.)

## Hourly reports (`/hourly`, CLAUDE.md §14)

**What it does.** Lists the mails under the Gmail label `Hourly Update`, and on demand
downloads one `.rar` attachment, extracts the single `NSN Update_Output.xlsx`, reads the
sheets 2G/3G/4G/5G_Down, Environmental and HW, joins Site Master and shows the rows.
**No alarm row is ever stored.** Results live in an in-process cache of the `web` container
(20 reports, `HOURLY_CACHE_MIN` = 30 min); a restart only means "process again".

**Roles.** viewer: read processed reports · operator: also *Process* · admin: also Site Master
import/edit and normalization rules (Settings → Site Master).

### unrar (official, non-free)

The reports are RAR5 with a method that `unrar-free`, `p7zip` and 7-Zip 23 cannot unpack
("Unsupported Method"). The **official RarLab `unrar`** is required:

- `apps/web/Dockerfile` is based on `node:20-bookworm-slim` (not Alpine — Alpine has no
  `unrar` package) and installs `unrar` from Debian **non-free**:
  `sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources`
  then `apt-get install -y unrar`. The build prints `UNRAR 6.x freeware` as a check.
- Check a running container: `docker compose exec web unrar | head -1`.
- Without the binary (e.g. `pnpm dev` on Windows) extraction falls back to **node-unrar-js**
  (WASM build of the same RarLab code). Archive headers are always listed with node-unrar-js
  first (size / entry / path checks before anything is written).
- Override the binary path with `HOURLY_UNRAR_BIN`.

**Plain .xlsx attachments** (mail without a RAR) are processed directly: `.xlsx` extension,
ZIP signature, ≤ `HOURLY_MAX_RAR_MB`, declared uncompressed size ≤ `HOURLY_MAX_EXTRACT_MB`.

**Safety checks for .rar** (any failure → report shows *Failed* with the reason in the tooltip):
`.rar` extension, RAR signature `52 61 72 21 1A 07`, ≤ `HOURLY_MAX_RAR_MB` (25);
≤ 20 entries, ≤ `HOURLY_MAX_EXTRACT_MB` (100) declared and on disk, no `..` / absolute
paths / links, exactly one `.xlsx`. Extraction happens in a fresh temp dir that is deleted
in `finally`; nothing from the archive is executed.

### Configuration (.env)

| Variable | Default | |
|---|---|---|
| `HOURLY_GMAIL_LABEL` | `Hourly Update` | Gmail label to list |
| `HOURLY_MAX_RAR_MB` | 25 | attachment size limit |
| `HOURLY_MAX_EXTRACT_MB` | 100 | extracted size limit |
| `HOURLY_CACHE_MIN` | 30 | cache TTL per processed report |
| `HOURLY_GMAIL_MOCK_DIR` | — | dev/demo: serve the `.rar` / `.xlsx` files of a folder instead of Gmail |
| `HOURLY_UNRAR_BIN` | `unrar` | path to the official binary |

Gmail access uses the same `token.json` + `credentials.json` as the worker (read-only scope);
the `web` container must mount them read-only at `/app/secrets/` (or set
`GOOGLE_TOKEN_PATH` / `GOOGLE_CREDENTIALS_PATH`).

### Site Master

Settings → **Site Master** → *Import* an `.xlsx` with a sheet `SiteMaster` and the columns
Code, Site Name, Office, Nodality, VIP, Site type, Power Source, Battery (template:
`tests/fixtures/SiteMaster_KafrElDawar.xlsx`). Re-import upserts by Code; one file per office
is fine. Duplicate / invalid codes are listed as *skipped*. Office and site type can be
edited inline. Any change clears the hourly cache so reports pick it up.

The footer of a report shows how many site codes are **not** in Site Master — those rows
have no office (no color) and sort last.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Report *Failed: Not a .rar attachment* / *RAR signature* | The mail carries something else — check the mail in Gmail. |
| *Failed: unrar exit …* | Corrupt / password-protected archive, or unrar missing in the image (`docker compose exec web unrar`). |
| *Archive expands to … MB* | Raise `HOURLY_MAX_EXTRACT_MB` only if the report really grew. |
| *Sheet … is missing column(s)* | Vendor changed the report layout — update `packages/core/src/hourly/parse.ts`. |
| Viewer sees "not processed yet" | An operator/admin has to press *Process* once; afterwards viewers can open it, cold cache re-processes automatically. |
| List empty | Label name (`HOURLY_GMAIL_LABEL`) or Gmail token expired (Testing-mode tokens last 7 days). |

### Local demo without Gmail

```bash
HOURLY_GMAIL_MOCK_DIR=../../tests/fixtures corepack pnpm --filter @alarm/web dev
```

or the launch config `web-hourly-mock` (port 3100, separate `.next-mock` build dir).

### Tests

```bash
corepack pnpm test                                   # unit tests (core pipeline on the real fixtures)
TEST_DATABASE_URL=postgresql://…/alarms_test corepack pnpm test   # + route tests
TEST_DATABASE_URL=postgresql://…/alarms_test corepack pnpm test:e2e  # Playwright smoke (:3200)
```

The fixtures in `tests/fixtures/` are real network data and are **gitignored**; tests that
need them are skipped when they are absent. First Playwright run: `npx playwright install chromium`.

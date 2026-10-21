-- 2026-10-20: the worker reads the whole mailbox and stores every message's labels; offices
-- are resolved per alarm (Site Master, else mail label); users belong to an office.

ALTER TABLE "raw_messages" ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "raw_messages" SET "labels" = ARRAY["office"] WHERE "office" IS NOT NULL;

ALTER TABLE "alarms" ADD COLUMN "mailOffice" TEXT, ADD COLUMN "siteCode" TEXT;
UPDATE "alarms" SET "mailOffice" = "office";
-- Same rule as siteCodeOf(): last "_" segment when it looks like a site code.
UPDATE "alarms"
SET "siteCode" = upper(regexp_replace(trim("site"), '^.*_', ''))
WHERE upper(regexp_replace(trim("site"), '^.*_', '')) ~ '^[0-9A-Z]{3,6}[A-Z]{2}$';
CREATE INDEX "alarms_siteCode_idx" ON "alarms"("siteCode");

ALTER TABLE "orphan_clears" ADD COLUMN "mailOffice" TEXT;
UPDATE "orphan_clears" SET "mailOffice" = "office";

ALTER TABLE "users" ADD COLUMN "office" TEXT;
-- Existing admins administered everything → super admins. Everyone keeps the office that was
-- selected system-wide (super admins: as their current view).
UPDATE "users" SET "role" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN';
UPDATE "users" SET "office" = (SELECT "officeLabel" FROM "system_status" WHERE "id" = 1);

-- Force one 24h backfill of the whole mailbox (labels are now read from every message).
UPDATE "system_status" SET "syncedLabel" = NULL;

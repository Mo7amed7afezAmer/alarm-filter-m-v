-- AlterTable
ALTER TABLE "raw_messages" ADD COLUMN     "office" TEXT;

-- AlterTable
ALTER TABLE "alarms" ADD COLUMN     "office" TEXT;

-- AlterTable
ALTER TABLE "orphan_clears" ADD COLUMN     "office" TEXT;

-- AlterTable
ALTER TABLE "system_status" ADD COLUMN     "availableLabels" JSONB,
ADD COLUMN     "officeLabel" TEXT,
ADD COLUMN     "syncedLabel" TEXT;

-- CreateIndex
CREATE INDEX "raw_messages_office_idx" ON "raw_messages"("office");

-- CreateIndex
CREATE INDEX "alarms_office_status_idx" ON "alarms"("office", "status");

-- Data: everything stored so far came from the only label used until now.
UPDATE "raw_messages" SET "office" = 'DN/Kafr ElDawar' WHERE "office" IS NULL;
UPDATE "alarms" SET "office" = 'DN/Kafr ElDawar' WHERE "office" IS NULL;
UPDATE "orphan_clears" SET "office" = 'DN/Kafr ElDawar' WHERE "office" IS NULL;
UPDATE "system_status" SET "officeLabel" = 'DN/Kafr ElDawar', "syncedLabel" = 'DN/Kafr ElDawar' WHERE "officeLabel" IS NULL;

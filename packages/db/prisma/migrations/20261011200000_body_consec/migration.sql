-- DropIndex
DROP INDEX "alarms_alarmKey_alarmTime_key";

-- AlterTable
ALTER TABLE "raw_messages" ADD COLUMN     "body" TEXT;

-- AlterTable
ALTER TABLE "alarms" ADD COLUMN     "cellName" TEXT,
ADD COLUMN     "consecNbr" TEXT,
ADD COLUMN     "device" TEXT;

-- AlterTable
ALTER TABLE "orphan_clears" ADD COLUMN     "consecNbr" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "alarms_consecNbr_key" ON "alarms"("consecNbr");

-- CreateIndex
CREATE INDEX "alarms_alarmKey_alarmTime_idx" ON "alarms"("alarmKey", "alarmTime");

-- CreateIndex
CREATE INDEX "orphan_clears_consecNbr_idx" ON "orphan_clears"("consecNbr");

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notificationsSeenAt" TIMESTAMP(3),
ADD COLUMN     "notifyPrefs" JSONB;

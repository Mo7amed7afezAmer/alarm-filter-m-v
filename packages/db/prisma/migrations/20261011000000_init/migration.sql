-- CreateEnum
CREATE TYPE "Category" AS ENUM ('DOWN', 'POWER', 'OTHER');

-- CreateEnum
CREATE TYPE "AlarmStatus" AS ENUM ('ACTIVE', 'CLEARED');

-- CreateEnum
CREATE TYPE "ClearType" AS ENUM ('EMAIL', 'AUTO_SUPERSEDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'ADMIN');

-- CreateTable
CREATE TABLE "raw_messages" (
    "id" SERIAL NOT NULL,
    "gmailId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "parseError" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "raw_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarms" (
    "id" SERIAL NOT NULL,
    "alarmKey" TEXT NOT NULL,
    "alarmName" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "alarmTime" TIMESTAMP(3) NOT NULL,
    "status" "AlarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "clearTime" TIMESTAMP(3),
    "durationMin" INTEGER,
    "clearType" "ClearType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orphan_clears" (
    "id" SERIAL NOT NULL,
    "alarmKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "clearTime" TIMESTAMP(3) NOT NULL,
    "rawMessageId" INTEGER NOT NULL,

    CONSTRAINT "orphan_clears_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" SERIAL NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "priority" INTEGER NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "site" TEXT NOT NULL,
    "region" TEXT,
    "owner" TEXT,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("site")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_status" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastHistoryId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastRunMessages" INTEGER NOT NULL DEFAULT 0,
    "reprocessDays" INTEGER,

    CONSTRAINT "system_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_messages_gmailId_key" ON "raw_messages"("gmailId");

-- CreateIndex
CREATE INDEX "raw_messages_receivedAt_idx" ON "raw_messages"("receivedAt");

-- CreateIndex
CREATE INDEX "alarms_status_category_idx" ON "alarms"("status", "category");

-- CreateIndex
CREATE INDEX "alarms_site_idx" ON "alarms"("site");

-- CreateIndex
CREATE UNIQUE INDEX "alarms_alarmKey_alarmTime_key" ON "alarms"("alarmKey", "alarmTime");

-- CreateIndex
CREATE INDEX "orphan_clears_alarmKey_idx" ON "orphan_clears"("alarmKey");

-- CreateIndex
CREATE INDEX "rules_priority_idx" ON "rules"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "orphan_clears" ADD CONSTRAINT "orphan_clears_rawMessageId_fkey" FOREIGN KEY ("rawMessageId") REFERENCES "raw_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

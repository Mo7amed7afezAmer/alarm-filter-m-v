-- Hourly reports (CLAUDE.md §14): site enrichment + value normalizations. Additive only.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'OPERATOR';

-- CreateTable
CREATE TABLE "site_master" (
    "code" TEXT NOT NULL,
    "siteName" TEXT,
    "office" TEXT NOT NULL,
    "nodality" TEXT,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "siteType" TEXT,
    "powerSource" TEXT,
    "battery" TEXT,
    "region" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_master_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "hourly_normalizations" (
    "id" SERIAL NOT NULL,
    "field" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,

    CONSTRAINT "hourly_normalizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_master_office_idx" ON "site_master"("office");

-- CreateIndex
CREATE UNIQUE INDEX "hourly_normalizations_field_from_key" ON "hourly_normalizations"("field", "from");

-- Gmail connection made from /settings/gmail (OAuth client + refresh token). Additive only.
CREATE TABLE "gmail_account" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "email" TEXT,
    "refreshToken" TEXT,
    "scope" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedBy" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckMsg" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gmail_account_pkey" PRIMARY KEY ("id")
);

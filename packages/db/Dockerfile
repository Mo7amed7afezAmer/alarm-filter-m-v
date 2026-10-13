# One-shot migrate image: `prisma migrate deploy` + seed. Build context = repo root.
FROM node:20-alpine
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

# Workspace manifests first for layer caching (all are needed for --frozen-lockfile).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @alarm/db

COPY packages/db packages/db
# seed.ts imports the §14 normalization seed from core source (pure TS, run by tsx).
COPY packages/core/src packages/core/src
RUN pnpm --filter @alarm/db exec prisma generate && chown -R node:node /app

USER node
WORKDIR /app/packages/db
# Call the binaries directly: avoids corepack re-downloading pnpm at runtime as the node user.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/tsx prisma/seed.ts"]

# Worker image. Build context = repo root.

# ---- build: install, compile core/db/worker, produce a pruned prod bundle in /out ----
FROM node:20-alpine AS build
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @alarm/worker...

COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/worker apps/worker
RUN pnpm --filter @alarm/core build \
 && pnpm --filter @alarm/db build \
 && pnpm --filter @alarm/worker build

# Self-contained prod node_modules (workspace packages copied in), then generate the Prisma
# client into it (pnpm deploy reinstalls, so the generated client must be recreated).
RUN pnpm --filter @alarm/worker deploy --prod /out \
 && cp -r packages/db/prisma /out/prisma \
 && cd /out && /app/packages/db/node_modules/.bin/prisma generate --schema prisma/schema.prisma \
 && rm -rf /out/src /out/prisma/migrations /out/tsconfig*.json

# Size trim (< 200MB target): Prisma CLI engines and wasm/edge runtimes are unused at runtime;
# the generated client keeps its own musl query engine in node_modules/.prisma/client.
RUN rm -rf /out/node_modules/.pnpm/@prisma+engines@* \
           /out/node_modules/.pnpm/@prisma+fetch-engine@* \
           /out/node_modules/.pnpm/@prisma+get-platform@* \
 && find /out/node_modules/.pnpm -path '*@prisma/client/runtime/*' \
      \( -name '*.wasm' -o -name '*edge*' -o -name '*wasm*' -o -name 'react-native*' \) -delete \
 && find /out/node_modules -name '*.map' -delete

# ---- runtime ----
FROM node:20-alpine
# npm/corepack/yarn are not needed to run `node dist/index.js`.
RUN apk add --no-cache openssl \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]

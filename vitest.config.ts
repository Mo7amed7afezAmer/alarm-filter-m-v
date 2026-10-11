import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // apps/web uses the "@/..." import alias.
    alias: { "@": fileURLToPath(new URL("./apps/web", import.meta.url)) },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/worker/src/**/*.test.ts",
      "apps/web/{app,lib}/**/*.test.ts",
    ],
    environment: "node",
    // Integration tests hit Postgres and can exceed the 5s/10s defaults on a busy dev box
    // (dev server compiling, browser open). Unit tests finish in milliseconds either way.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

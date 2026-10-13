import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone is what the Docker image runs. Native Windows builds skip it because copying
  // pnpm's symlinked node_modules needs symlink privilege (Developer Mode).
  output: process.platform === "win32" ? undefined : "standalone",
  // Trace workspace packages (packages/*) from the monorepo root into the standalone bundle.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
    // Loaded from node_modules at runtime, never bundled: node-unrar-js reads its .wasm next
    // to its own files; exceljs is large and CommonJS.
    serverComponentsExternalPackages: ["node-unrar-js", "exceljs"],
  },
  transpilePackages: ["@alarm/core"],
};

export default nextConfig;

import { execFileSync } from "node:child_process";
import path from "node:path";
import { PASSWORD_FILE } from "./shared";

export default async function globalTeardown() {
  execFileSync(process.execPath, [path.join(__dirname, "db.mjs"), "teardown", PASSWORD_FILE], {
    stdio: "inherit",
    env: process.env,
  });
}
